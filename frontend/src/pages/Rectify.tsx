import { useMemo, useState } from 'react';
import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CheckOutlined, ReloadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import StatusBadge from '../components/common/StatusBadge';
import EmptyState from '../components/common/EmptyState';
import UnitCell from '../components/common/UnitCell';
import { useInspectionFilter } from '../hooks/useInspectionFilter';
import { usePointStore } from '../stores/pointStore';
import { DISTRICTS, FACILITY_TYPES } from '../types/point';
import { RECTIFY_STATUSES, type RectifyPlan, type RectifyStatus } from '../types/rectify';
import { isOverdue, todayStr } from '../utils/format';

interface RecheckDraft {
  status: RectifyStatus;
  recheckDate: string;
  note: string;
}

export default function Rectify() {
  const { message } = App.useApp();
  const { filter, setFilter, resetFilter, pendingRectifies, pointMap } = useInspectionFilter();
  const rectifies = usePointStore((s) => s.rectifies);
  const unitTransfers = usePointStore((s) => s.unitTransfers);
  const updateRectify = usePointStore((s) => s.updateRectify);
  const [statusFilter, setStatusFilter] = useState<RectifyStatus | ''>('');
  const [editing, setEditing] = useState<RectifyPlan | null>(null);
  const [draft, setDraft] = useState<RecheckDraft>({ status: '已整改', recheckDate: todayStr(), note: '' });
  const [saving, setSaving] = useState(false);

  const scoped = useMemo(
    () => rectifies.filter((r) => pointMap.has(r.pointId)),
    [rectifies, pointMap],
  );

  const visible = useMemo(
    () => (statusFilter ? scoped.filter((r) => r.status === statusFilter) : scoped),
    [scoped, statusFilter],
  );

  /** 每个点位最近一次移交记录（不晚于今天），用于复检重新落单时按最新养护单位修正 */
  const latestTransferByPoint = useMemo(() => {
    const today = todayStr();
    const map = new Map<string, (typeof unitTransfers)[number]>();
    for (const t of unitTransfers) {
      if (t.transferDate > today) continue;
      const cur = map.get(t.pointId);
      if (!cur || cur.transferDate < t.transferDate) map.set(t.pointId, t);
    }
    return map;
  }, [unitTransfers]);

  const groups = useMemo(() => {
    const overdue = visible
      .filter((r) => isOverdue(r.deadline, r.status))
      .sort((a, b) => (a.deadline < b.deadline ? -1 : 1));
    const pending = visible
      .filter((r) => r.status === '待整改' && !isOverdue(r.deadline, r.status))
      .sort((a, b) => (a.deadline < b.deadline ? -1 : 1));
    const relapse = visible.filter((r) => r.status === '复发');
    const done = visible
      .filter((r) => r.status === '已整改')
      .sort((a, b) => (a.recheckDate < b.recheckDate ? 1 : -1));
    return [
      { key: 'overdue', title: '逾期未整改（置顶）', items: overdue, danger: true },
      { key: 'pending', title: '整改期限内', items: pending, danger: false },
      { key: 'relapse', title: '复检复发', items: relapse, danger: true },
      { key: 'done', title: '已整改完成', items: done, danger: false },
    ].filter((g) => g.items.length > 0);
  }, [visible]);

  const openRecheck = (row: RectifyPlan) => {
    setEditing(row);
    setDraft({ status: '已整改', recheckDate: todayStr(), note: '' });
  };

  const handleRecheck = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const requirement = draft.note.trim()
        ? `${editing.requirement}｜复检说明：${draft.note.trim()}`
        : editing.requirement;
      const patch: Partial<RectifyPlan> = {
        status: draft.status,
        recheckDate: draft.recheckDate || todayStr(),
        requirement,
      };
      // 复检后仍需继续跟踪（复发/待整改）：责任单位按点位最新养护单位落单，
      // 不能因为条目历史责任单位把单位改回去；已整改条目保留落单时单位。
      if (draft.status !== '已整改') {
        const point = pointMap.get(editing.pointId);
        const latestUnit = point?.maintainUnit ?? editing.unit;
        if (latestUnit !== editing.unit) {
          const transfer = latestTransferByPoint.get(editing.pointId);
          patch.unit = latestUnit;
          patch.unitChanges = [
            ...(editing.unitChanges ?? []),
            transfer && transfer.toUnit === latestUnit
              ? {
                  fromUnit: editing.unit,
                  toUnit: latestUnit,
                  date: transfer.transferDate,
                  reason: transfer.reason,
                }
              : {
                  fromUnit: editing.unit,
                  toUnit: latestUnit,
                  date: draft.recheckDate || todayStr(),
                  reason: '复检重新落单，按点位最新养护单位修正责任单位',
                },
          ];
        }
      }
      await updateRectify(editing.id, patch);
      message.success('复检结果已登记');
      setEditing(null);
    } catch (e) {
      message.error(`复检登记失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnsType<RectifyPlan> = [
    {
      title: '点位',
      width: 220,
      render: (_, row) => {
        const p = pointMap.get(row.pointId);
        return p ? <Link to={`/points/${p.id}`}>{p.name}</Link> : row.pointId;
      },
    },
    {
      title: '行政区',
      width: 100,
      render: (_, row) => pointMap.get(row.pointId)?.district ?? '—',
    },
    { title: '整改要求', dataIndex: 'requirement', ellipsis: true },
    {
      title: '责任单位',
      dataIndex: 'unit',
      width: 230,
      render: (_: string, row) => (
        <UnitCell plan={row} currentUnit={pointMap.get(row.pointId)?.maintainUnit} />
      ),
    },
    {
      title: '整改期限',
      dataIndex: 'deadline',
      width: 140,
      sorter: (a, b) => (a.deadline < b.deadline ? -1 : 1),
      render: (d: string, row) =>
        isOverdue(d, row.status) ? (
          <Space size={4}>
            {d}
            <Tag color="error">逾期</Tag>
          </Space>
        ) : (
          d
        ),
    },
    {
      title: '复检日期',
      dataIndex: 'recheckDate',
      width: 120,
      render: (v: string) => v || <Typography.Text type="secondary">未复检</Typography.Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => <StatusBadge value={v} kind="rectify" />,
    },
    {
      title: '操作',
      width: 120,
      render: (_, row) => (
        <Button size="small" type="primary" ghost onClick={() => openRecheck(row)} data-testid={`recheck-${row.id}`}>
          登记复检
        </Button>
      ),
    },
  ];

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <h1 className="gb-page-title">整改清单</h1>
          <Typography.Text type="secondary">
            按状态与期限分组，逾期条目置顶；登记复检结果后自动回流到点位详情。
          </Typography.Text>
        </div>
        <Space wrap>
          <Select
            placeholder="行政区"
            style={{ width: 130 }}
            allowClear
            value={filter.district || undefined}
            onChange={(v) => setFilter({ district: v ?? '' })}
            options={DISTRICTS.map((d) => ({ value: d, label: d }))}
          />
          <Select
            placeholder="设施类型"
            style={{ width: 150 }}
            allowClear
            value={filter.facilityType || undefined}
            onChange={(v) => setFilter({ facilityType: v ?? '' })}
            options={FACILITY_TYPES.map((t) => ({ value: t, label: t }))}
          />
          <Select
            placeholder="整改状态"
            style={{ width: 140 }}
            allowClear
            value={statusFilter || undefined}
            onChange={(v) => setStatusFilter((v as RectifyStatus) ?? '')}
            options={RECTIFY_STATUSES.map((s) => ({ value: s, label: s }))}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              resetFilter();
              setStatusFilter('');
            }}
          >
            重置
          </Button>
        </Space>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 8 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Typography.Text type="secondary">整改条目总数</Typography.Text>
            <div style={{ fontSize: 24, fontWeight: 600 }} data-testid="rectify-total">
              {scoped.length}
            </div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Typography.Text type="secondary">待整改（含逾期）</Typography.Text>
            <div style={{ fontSize: 24, fontWeight: 600, color: '#d46b08' }} data-testid="rectify-pending">
              {pendingRectifies.length}
            </div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Typography.Text type="secondary">已整改</Typography.Text>
            <div style={{ fontSize: 24, fontWeight: 600, color: '#389e0d' }}>
              {scoped.filter((r) => r.status === '已整改').length}
            </div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Typography.Text type="secondary">逾期条目</Typography.Text>
            <div style={{ fontSize: 24, fontWeight: 600, color: '#cf1322' }} data-testid="rectify-overdue">
              {scoped.filter((r) => isOverdue(r.deadline, r.status)).length}
            </div>
          </Card>
        </Col>
      </Row>

      {groups.length ? (
        groups.map((g) => (
          <Card
            key={g.key}
            size="small"
            style={{ marginTop: 16 }}
            title={
              <Space size={8}>
                <span>{g.title}</span>
                <Tag color={g.danger ? 'error' : 'default'}>{g.items.length}</Tag>
              </Space>
            }
            data-testid={`group-${g.key}`}
          >
            <Table<RectifyPlan>
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={g.items}
              columns={columns}
              rowClassName={(row) => (isOverdue(row.deadline, row.status) ? 'gb-overdue-row' : '')}
            />
          </Card>
        ))
      ) : (
        <EmptyState
          title="没有匹配的整改条目"
          description="调整行政区、设施类型或状态筛选后再试"
          extra={
            <Button onClick={() => { resetFilter(); setStatusFilter(''); }}>
              <CheckOutlined /> 清空筛选
            </Button>
          }
        />
      )}

      <Modal
        title={editing ? `登记复检 · ${pointMap.get(editing.pointId)?.name ?? editing.pointId}` : '登记复检'}
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        onOk={handleRecheck}
        confirmLoading={saving}
        okText="保存复检结果"
        destroyOnClose
      >
        {editing ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Typography.Text type="secondary">
              整改要求：{editing.requirement}
              <br />
              责任单位：{editing.unit} · 期限：{editing.deadline}
            </Typography.Text>
            <div>
              <Typography.Text>复检结论</Typography.Text>
              <Select
                style={{ width: '100%', marginTop: 4 }}
                value={draft.status}
                onChange={(v) => setDraft((c) => ({ ...c, status: v }))}
                options={[
                  { value: '已整改', label: '已整改（达标）' },
                  { value: '复发', label: '复发（再次不达标）' },
                  { value: '待整改', label: '待整改（继续跟踪）' },
                ]}
              />
            </div>
            <div>
              <Typography.Text>复检日期</Typography.Text>
              <DatePicker
                style={{ width: '100%', marginTop: 4 }}
                value={draft.recheckDate ? dayjs(draft.recheckDate) : null}
                onChange={(d) => setDraft((c) => ({ ...c, recheckDate: d ? d.format('YYYY-MM-DD') : todayStr() }))}
              />
            </div>
            <div>
              <Typography.Text>复检说明</Typography.Text>
              <Input.TextArea
                rows={3}
                style={{ marginTop: 4 }}
                value={draft.note}
                onChange={(e) => setDraft((c) => ({ ...c, note: e.target.value }))}
                placeholder="如：已清退占用、坡道重做完成，实测坡度 4.2%"
              />
            </div>
          </Space>
        ) : null}
      </Modal>
    </div>
  );
}
