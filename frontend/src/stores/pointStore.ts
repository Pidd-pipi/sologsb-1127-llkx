import { create } from 'zustand';
import { db, ensureSeed } from '../db';
import type { AccessPoint, AccessPointDraft, UnitTransfer, UnitTransferDraft } from '../types/point';
import type { Inspection, InspectionDraft } from '../types/inspection';
import type { RectifyPlan, RectifyPlanDraft } from '../types/rectify';
import { makeId, toPlain, todayStr } from '../utils/format';

interface PointState {
  points: AccessPoint[];
  inspections: Inspection[];
  rectifies: RectifyPlan[];
  transfers: UnitTransfer[];
  loading: boolean;
  loaded: boolean;
  error: string;
  load: () => Promise<void>;
  addPoint: (draft: AccessPointDraft) => Promise<AccessPoint>;
  addInspection: (draft: InspectionDraft) => Promise<Inspection>;
  addRectify: (draft: RectifyPlanDraft) => Promise<RectifyPlan>;
  updateRectify: (id: string, patch: Partial<RectifyPlan>) => Promise<void>;
  /**
   * 调整点位责任单位：
   * 写入一条移交记录、更新点位当前养护单位，
   * 并把该点位「待整改 / 复发」条目的责任单位同步到新单位；
   * 已整改条目保留原责任单位不动。
   */
  transferUnit: (draft: UnitTransferDraft) => Promise<UnitTransfer>;
  getPoint: (id: string) => AccessPoint | undefined;
  inspectionsOf: (pointId: string) => Inspection[];
  rectifiesOf: (pointId: string) => RectifyPlan[];
  transfersOf: (pointId: string) => UnitTransfer[];
}

export const usePointStore = create<PointState>((set, get) => ({
  points: [],
  inspections: [],
  rectifies: [],
  transfers: [],
  loading: false,
  loaded: false,
  error: '',

  load: async () => {
    set({ loading: true, error: '' });
    try {
      await ensureSeed();
      const [points, inspections, rectifies, transfers] = await Promise.all([
        db.points.toArray(),
        db.inspections.toArray(),
        db.rectifies.toArray(),
        db.transfers.toArray(),
      ]);
      set({
        points: points.sort((a, b) => a.code.localeCompare(b.code)),
        inspections: inspections.sort((a, b) => (a.date < b.date ? 1 : -1)),
        rectifies: [...rectifies].sort((a, b) => (a.deadline < b.deadline ? -1 : 1)),
        transfers: [...transfers].sort((a, b) => (a.date < b.date ? 1 : -1)),
        loading: false,
        loaded: true,
      });
    } catch (e) {
      set({ loading: false, loaded: true, error: e instanceof Error ? e.message : String(e) });
    }
  },

  addPoint: async (draft) => {
    const now = new Date().toISOString();
    const point: AccessPoint = toPlain({
      ...draft,
      id: makeId('pt'),
      createdAt: now,
      updatedAt: now,
    });
    await db.points.put(point);
    set((s) => ({ points: [...s.points, point].sort((a, b) => a.code.localeCompare(b.code)) }));
    return point;
  },

  addInspection: async (draft) => {
    const inspection: Inspection = toPlain({
      ...draft,
      id: makeId('ins'),
      createdAt: new Date().toISOString(),
    });
    await db.inspections.put(inspection);
    set((s) => ({
      inspections: [inspection, ...s.inspections].sort((a, b) => (a.date < b.date ? 1 : -1)),
    }));
    // 结论为不合格时自动生成整改条目，形成闭环
    if (inspection.conclusion === '不合格') {
      const exists = get().rectifies.some(
        (r) => r.pointId === inspection.pointId && r.status !== '已整改',
      );
      if (!exists) {
        // 始终按点位当前养护单位落单，不能沿用历史条目的旧单位
        const currentUnit = get().points.find((p) => p.id === inspection.pointId)?.maintainUnit;
        await get().addRectify({
          pointId: inspection.pointId,
          requirement: `按 ${inspection.date} 核验结论整改：${inspection.problem || '坡度、净宽或占用问题'}`,
          unit: currentUnit || '待指派责任单位',
          deadline: todayStr(),
          recheckDate: '',
          status: '待整改',
        });
      }
    }
    return inspection;
  },

  addRectify: async (draft) => {
    const plan: RectifyPlan = toPlain({
      ...draft,
      id: makeId('rct'),
      createdAt: new Date().toISOString(),
    });
    await db.rectifies.put(plan);
    set((s) => ({
      rectifies: [...s.rectifies, plan].sort((a, b) => (a.deadline < b.deadline ? -1 : 1)),
    }));
    return plan;
  },

  updateRectify: async (id, patch) => {
    const plain = toPlain(patch);
    await db.rectifies.update(id, plain);
    set((s) => ({
      rectifies: s.rectifies.map((r) => (r.id === id ? { ...r, ...plain } : r)),
    }));
  },

  transferUnit: async (draft) => {
    const point = get().points.find((p) => p.id === draft.pointId);
    if (!point) throw new Error('未找到点位，无法调整责任单位');
    if (draft.fromUnit !== point.maintainUnit) {
      throw new Error('责任单位已被他人调整，请刷新后重试');
    }
    if (!draft.toUnit || draft.toUnit === draft.fromUnit) {
      throw new Error('请选择与当前不同的新责任单位');
    }
    if (!draft.date) throw new Error('请填写移交日期');
    if (!draft.reason.trim()) throw new Error('请填写移交原因');

    const now = new Date().toISOString();
    const transfer: UnitTransfer = toPlain({
      ...draft,
      reason: draft.reason.trim(),
      id: makeId('trf'),
      createdAt: now,
    });
    const updatedPoint: AccessPoint = { ...point, maintainUnit: draft.toUnit, updatedAt: now };

    // 同事务完成：移交记录、点位当前单位、未整改/复发条目跟新；已完成条目不动
    const affected = get().rectifies.filter(
      (r) => r.pointId === point.id && r.status !== '已整改',
    );
    await db.transaction('rw', db.points, db.rectifies, db.transfers, async () => {
      await db.transfers.put(transfer);
      await db.points.update(point.id, { maintainUnit: draft.toUnit, updatedAt: now });
      for (const r of affected) {
        if (r.unit !== draft.toUnit) {
          await db.rectifies.update(r.id, { unit: draft.toUnit });
        }
      }
    });

    const affectedIds = new Set(affected.map((r) => r.id));
    set((s) => ({
      transfers: [...s.transfers, transfer].sort((a, b) => (a.date < b.date ? 1 : -1)),
      points: s.points.map((p) => (p.id === point.id ? updatedPoint : p)),
      rectifies: s.rectifies.map((r) =>
        affectedIds.has(r.id) ? { ...r, unit: draft.toUnit } : r,
      ),
    }));
    return transfer;
  },

  getPoint: (id) => get().points.find((p) => p.id === id),

  inspectionsOf: (pointId) =>
    get()
      .inspections.filter((i) => i.pointId === pointId)
      .sort((a, b) => (a.date < b.date ? 1 : -1)),

  rectifiesOf: (pointId) =>
    get()
      .rectifies.filter((r) => r.pointId === pointId)
      .sort((a, b) => (a.deadline < b.deadline ? -1 : 1)),

  transfersOf: (pointId) =>
    get()
      .transfers.filter((t) => t.pointId === pointId)
      .sort((a, b) => (a.date < b.date ? 1 : -1)),
}));
