import { create } from 'zustand';
import { db, ensureSeed } from '../db';
import type { AccessPoint, AccessPointDraft } from '../types/point';
import type { Inspection, InspectionDraft } from '../types/inspection';
import type { RectifyPlan, RectifyPlanDraft, UnitChange } from '../types/rectify';
import type { UnitTransfer, UnitTransferDraft } from '../types/transfer';
import { makeId, toPlain, todayStr } from '../utils/format';

interface PointState {
  points: AccessPoint[];
  inspections: Inspection[];
  rectifies: RectifyPlan[];
  unitTransfers: UnitTransfer[];
  loading: boolean;
  loaded: boolean;
  error: string;
  load: () => Promise<void>;
  addPoint: (draft: AccessPointDraft) => Promise<AccessPoint>;
  addInspection: (draft: InspectionDraft) => Promise<Inspection>;
  addRectify: (draft: RectifyPlanDraft) => Promise<RectifyPlan>;
  updateRectify: (id: string, patch: Partial<RectifyPlan>) => Promise<void>;
  /** 登记养护单位移交：点位落到新单位，未整改/复发条目跟随，已完成条目保留原单位 */
  transferUnit: (draft: UnitTransferDraft) => Promise<UnitTransfer>;
  getPoint: (id: string) => AccessPoint | undefined;
  inspectionsOf: (pointId: string) => Inspection[];
  rectifiesOf: (pointId: string) => RectifyPlan[];
  transfersOf: (pointId: string) => UnitTransfer[];
}

/** 移交记录排序：移交日期晚的在前，同日期按登记时间 */
function sortTransfers(list: UnitTransfer[]): UnitTransfer[] {
  return [...list].sort((a, b) =>
    a.transferDate === b.transferDate
      ? a.createdAt < b.createdAt
        ? 1
        : -1
      : a.transferDate < b.transferDate
        ? 1
        : -1,
  );
}

export const usePointStore = create<PointState>((set, get) => ({
  points: [],
  inspections: [],
  rectifies: [],
  unitTransfers: [],
  loading: false,
  loaded: false,
  error: '',

  load: async () => {
    set({ loading: true, error: '' });
    try {
      await ensureSeed();
      const [points, inspections, rectifies, unitTransfers] = await Promise.all([
        db.points.toArray(),
        db.inspections.toArray(),
        db.rectifies.toArray(),
        db.unitTransfers.toArray(),
      ]);
      set({
        points: points.sort((a, b) => a.code.localeCompare(b.code)),
        inspections: inspections.sort((a, b) => (a.date < b.date ? 1 : -1)),
        rectifies: [...rectifies].sort((a, b) => (a.deadline < b.deadline ? -1 : 1)),
        unitTransfers: sortTransfers(unitTransfers),
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
    // 结论为不合格时自动生成整改条目，形成闭环；责任单位始终按点位最新养护单位落单
    if (inspection.conclusion === '不合格') {
      const exists = get().rectifies.some(
        (r) => r.pointId === inspection.pointId && r.status !== '已整改',
      );
      if (!exists) {
        const point = get().points.find((p) => p.id === inspection.pointId);
        await get().addRectify({
          pointId: inspection.pointId,
          requirement: `按 ${inspection.date} 核验结论整改：${inspection.problem || '坡度、净宽或占用问题'}`,
          unit: point?.maintainUnit || '待指派责任单位',
          deadline: todayStr(),
          recheckDate: '',
          status: '待整改',
          unitChanges: [],
        });
      }
    }
    return inspection;
  },

  addRectify: async (draft) => {
    const plan: RectifyPlan = toPlain({
      unitChanges: [],
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
    if (!point) throw new Error('点位不存在或已删除');
    const fromUnit = point.maintainUnit;
    const toUnit = draft.toUnit.trim();
    if (!toUnit) throw new Error('请选择接收养护单位');
    if (toUnit === fromUnit) throw new Error('接收养护单位与当前养护单位相同，无需调整');
    if (!draft.transferDate) throw new Error('请填写移交日期');
    if (!draft.reason.trim()) throw new Error('请填写移交原因');

    const transfer: UnitTransfer = toPlain({
      ...draft,
      toUnit,
      reason: draft.reason.trim(),
      fromUnit,
      id: makeId('trf'),
      createdAt: new Date().toISOString(),
    });
    const change: UnitChange = {
      fromUnit,
      toUnit,
      date: draft.transferDate,
      reason: draft.reason.trim(),
    };

    // 未整改与复发条目跟随到新单位；已完成条目保留原责任单位，仅更新未关闭条目
    const followPlans = get()
      .rectifies.filter((r) => r.pointId === draft.pointId && r.status !== '已整改')
      .map((r) => ({
        ...r,
        unit: toUnit,
        unitChanges: [...(r.unitChanges ?? []), change],
      }));
    const updatedAt = new Date().toISOString();

    await db.transaction(
      'rw',
      db.points,
      db.rectifies,
      db.unitTransfers,
      async () => {
        await db.points.update(draft.pointId, { maintainUnit: toUnit, updatedAt });
        await db.unitTransfers.put(transfer);
        if (followPlans.length) {
          await db.rectifies.bulkPut(toPlain(followPlans));
        }
      },
    );

    set((s) => ({
      points: s.points.map((p) =>
        p.id === draft.pointId ? { ...p, maintainUnit: toUnit, updatedAt } : p,
      ),
      unitTransfers: sortTransfers([...s.unitTransfers, transfer]),
      rectifies: s.rectifies.map((r) => followPlans.find((f) => f.id === r.id) ?? r),
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
    sortTransfers(get().unitTransfers.filter((t) => t.pointId === pointId)),
}));
