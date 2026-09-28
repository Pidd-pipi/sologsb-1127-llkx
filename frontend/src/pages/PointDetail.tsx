import { useMemo, useState } from 'react';
import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Divider,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Timeline,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, SaveOutlined, ReloadOutlined, SwapOutlined, HistoryOutlined } from '@ant-design/icons';
import { Link, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import MapPanel from '../components/common/MapPanel';
import MeasureInput from '../components/common/MeasureInput';
import StatusBadge from '../components/common/StatusBadge';
import FacilityIcon from '../components/common/FacilityIcon';
import EmptyState from '../components/common/EmptyState';
import { usePointStore } from '../stores/pointStore';
import { MAINTAIN_UNITS } from '../types/point';
import { OCCUPIED_LEVELS, type Inspection, type OccupiedLevel } from '../types/inspection';
import type { RectifyPlan } from '../types/rectify';
import { judgeInspection } from '../utils/routeCheck';
import { addDays, isOverdue, todayStr } from '../utils/format';

interface InlineInspection {
  date: string;
  inspector: string;
  slope: number;
  clearWidth: number;
  hasHandrail: boolean;
  tactileContinuous: boolean;
  occupied: OccupiedLevel;
  problem: string;
}

interface TransferForm {
  toUnit: string;
  date: string;
  reason: string;
}

/** 移交记录的悬浮说明：从点位移交轨迹拼出责任变迁 */
function transferTooltip(history: { date: string; fromUnit: string; toUnit: string }[]): string {
  const lines = history
    .slice()
    .reverse()
    .map((t) => `${t.date} ${t.fromUnit} → ${t.toUnit}`);
  return `责任移交轨迹（共 ${history.length} 次）：\n${lines.join('\n')}`;
}

export default function PointDetail() {
  const { id = '' } = useParams();
  const { message } = App.useApp();
  const points = usePointStore((s) => s.points);
  const inspections = usePointStore((s) => s.inspections);
  const rectifies = usePointStore((s) => s.rectifies);
  const loaded = usePointStore((s) => s.loaded);
  const addInspection = usePointStore((s) => s.addInspection);
  const addRectify = usePointStore((s) => s.addRectify);

  const point = useMemo(() => points.find((p) => p.id === id), [points, id]);
  const history = useMemo(
    () =>
      inspections
        .filter((i) => i.pointId === id)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [inspections, id],
  );
  const plans = useMemo(
    () =>
      rectifies.filter((r) => r.pointId === id).sort((a, b) => (a.deadline < b.deadline ? -1 : 1)),
    [rectifies, id],
  );
  const transfers = usePointStore((s) => s.transfers);
  const transferUnit = usePointStore((s) => s.transferUnit);
  const transferHistory = useMemo(
    () =>
      transfers
        .filter((t) => t.pointId === id)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [transfers, id],
  );

  const [form, setForm] = useState<InlineInspection>(() => ({
    date: todayStr(),
    inspector: '督导员 李维',
    slope: 2.5,
    clearWidth: 150,
    hasHandrail: true,
    tactileContinuous: true,
    occupied: '无',
    problem: '',
  }));
  const [saving, setSaving] = useState(false);

  const [transferOpen, setTransferOpen] = useState(false);
  const [transferForm, setTransferForm] = useState<TransferForm>({
    toUnit: '',
    date: todayStr(),
    reason: '',
  });
  const [transferSaving, setTransferSaving] = useState(false);

  const openTransfer = () => {
    if (!point) return;
    setTransferForm({
      toUnit: MAINTAIN_UNITS.find((u) => u !== point.maintainUnit) ?? MAINTAIN_UNITS[0],
      date: todayStr(),
      reason: '',
    });
    setTransferOpen(true);
  };

  const handleTransfer = async () => {
    if (!point) return;
    if (!transferForm.toUnit) {
      message.warning('请选择新责任单位');
      return;
    }
    if (transferForm.toUnit === point.maintainUnit) {
      message.warning('新责任单位与当前养护单位相同，无需调整');
      return;
    }
    if (!transferForm.date) {
      message.warning('请选择移交日期');
      return;
    }
    if (!transferForm.reason.trim()) {
      message.warning('请填写移交原因');
      return;
    }
    setTransferSaving(true);
    try {
      await transferUnit({
        pointId: point.id,
        fromUnit: point.maintainUnit,
        toUnit: transferForm.toUnit,
        date: transferForm.date,
        reason: transferForm.reason,
      });
      message.success(`责任单位已调整为 ${transferForm.toUnit}，未整改与复发条目已同步跟进`);
      setTransferOpen(false);
    } catch (e) {
      message.error(`责任单位调整失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTransferSaving(false);
    }
  };

  const judgement = useMemo(
    () =>
      judgeInspection({
        slope: form.slope,
        clearWidth: form.clearWidth,
        hasHandrail: form.hasHandrail,
        tactileContinuous: form.tactileContinuous,
        occupied: form.occupied,
      }),
    [form],
  );

  if (!loaded) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
        <div style={{ marginTop: 12 }}>
          <Typography.Text type="secondary">正在读取本地点位数据…</Typography.Text>
        </div>
      </div>
    );
  }

  if (!point) {
    return (
      <EmptyState
        title={`未找到点位 ${id}`}
        description="该点位可能已被删除，请返回总览重新选择"
        extra={
          <Link to="/">
            <Button type="primary">返回核验总览</Button>
          </Link>
        }
      />
    );
  }

  const handleSaveInspection = async () => {
    setSaving(true);
    try {
      await addInspection({
        pointId: point.id,
        date: form.date || todayStr(),
        inspector: form.inspector.trim() || '未署名督导员',
        slope: form.slope,
        clearWidth: form.clearWidth,
        hasHandrail: form.hasHandrail,
        tactileContinuous: form.tactileContinuous,
        occupied: form.occupied,
        conclusion: judgement.conclusion,
        problem: form.problem.trim(),
      });
      message.success(`已新增核验记录（${judgement.conclusion}）`);
      setForm((cur) => ({ ...cur, problem: '', date: todayStr() }));
    } catch (e) {
      message.error(`核验记录保存失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateRectify = async () => {
    try {
      await addRectify({
        pointId: point.id,
        requirement: judgement.conclusion === '合格' ? '保持现状，纳入下一轮复核' : judgement.reasons.join('；'),
        unit: point.maintainUnit,
        deadline: addDays(todayStr(), 30),
        recheckDate: '',
        status: '待整改',
      });
      message.success('已生成整改条目');
    } catch (e) {
      message.error(`整改条目创建失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const inspectionColumns: ColumnsType<Inspection> = [
    { title: '核验日期', dataIndex: 'date', width: 120, sorter: (a, b) => (a.date < b.date ? -1 : 1) },
    { title: '核验人', dataIndex: 'inspector', width: 130 },
    { title: '坡度', dataIndex: 'slope', width: 80, render: (v: number) => `${v}%` },
    { title: '净宽', dataIndex: 'clearWidth', width: 90, render: (v: number) => `${v} cm` },
    { title: '扶手', dataIndex: 'hasHandrail', width: 70, render: (v: boolean) => (v ? '有' : '无') },
    {
      title: '盲道',
      dataIndex: 'tactileContinuous',
      width: 80,
      render: (v: boolean) => (v ? '连续' : '断续'),
    },
    { title: '占用情况', dataIndex: 'occupied', width: 100 },
    {
      title: '结论',
      dataIndex: 'conclusion',
      width: 110,
      render: (v: string) => <StatusBadge value={v} kind="conclusion" />,
    },
    {
      title: '问题描述',
      dataIndex: 'problem',
      ellipsis: true,
      render: (v: string) => v || <Typography.Text type="secondary">无</Typography.Text>,
    },
  ];

  const rectifyColumns: ColumnsType<RectifyPlan> = [
    { title: '整改要求', dataIndex: 'requirement', ellipsis: true },
    {
      title: '责任单位',
      dataIndex: 'unit',
      width: 200,
      render: (unit: string, row) => {
        const isOldUnit = unit !== point.maintainUnit;
        return (
          <Space size={4} wrap>
            <span data-testid={`rectify-unit-${row.id}`}>{unit}</span>
            {isOldUnit && (
              <Tooltip title={`该条目责任单位为原养护单位；点位已于 ${transferHistory[transferHistory.length - 1]?.date} 移交至 ${point.maintainUnit}，已完成条目保留原责任单位`}>
                <Tag color="default">原单位</Tag>
              </Tooltip>
            )}
            {transferHistory.length > 0 && !isOldUnit && (
              <Tooltip
                title={
                  <span style={{ whiteSpace: 'pre-line' }}>{transferTooltip(transferHistory)}</span>
                }
              >
                <Tag color="blue">已移交</Tag>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: '整改期限',
      dataIndex: 'deadline',
      width: 130,
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
  ];

  const latest = history[0];

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <Space size={10} align="center">
            <FacilityIcon type={point.facilityType} size={26} />
            <h1 className="gb-page-title" data-testid="point-name">
              {point.name}
            </h1>
            <StatusBadge value={latest?.conclusion ?? '未核验'} kind="conclusion" bordered />
          </Space>
          <Typography.Text type="secondary">
            {point.code} · {point.district} · {point.location || '未填写所在道路或建筑'}
          </Typography.Text>
        </div>
        <Space>
          <Link to="/map">
            <Button>在地图中查看</Button>
          </Link>
          <Link to="/points/new">
            <Button type="primary" icon={<PlusOutlined />}>
              登记新点位
            </Button>
          </Link>
        </Space>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <MapPanel points={[point]} selectedId={point.id} height={380} title="点位定位与周边" />
        </Col>
        <Col xs={24} lg={10}>
          <Card title="点位属性" size="small">
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="点位编号">{point.code}</Descriptions.Item>
              <Descriptions.Item label="设施类型">
                <FacilityIcon type={point.facilityType} withLabel />
              </Descriptions.Item>
              <Descriptions.Item label="行政区">{point.district}</Descriptions.Item>
              <Descriptions.Item label="所在道路或建筑">{point.location || '—'}</Descriptions.Item>
              <Descriptions.Item label="建成年代">{point.builtYear} 年</Descriptions.Item>
              <Descriptions.Item label="养护单位">
                <Space size={6} wrap>
                  <span data-testid="point-maintain-unit">{point.maintainUnit}</span>
                  {transferHistory.length > 0 && (
                    <Tooltip
                      title={
                        <span style={{ whiteSpace: 'pre-line' }}>
                          {transferTooltip(transferHistory)}
                        </span>
                      }
                    >
                      <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                        已移交 {transferHistory.length} 次
                      </Tag>
                    </Tooltip>
                  )}
                  <Button
                    size="small"
                    type="link"
                    icon={<SwapOutlined />}
                    onClick={openTransfer}
                    data-testid="adjust-unit"
                    style={{ padding: 0, height: 'auto' }}
                  >
                    责任单位调整
                  </Button>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="经纬度">
                {point.lng.toFixed(6)}, {point.lat.toFixed(6)}
              </Descriptions.Item>
              <Descriptions.Item label="核验次数">{history.length} 次</Descriptions.Item>
            </Descriptions>
          </Card>

          <Card
            size="small"
            style={{ marginTop: 16 }}
            title={
              <Space size={6}>
                <HistoryOutlined />
                <span>责任移交记录</span>
              </Space>
            }
            extra={
              <Button size="small" type="primary" ghost icon={<SwapOutlined />} onClick={openTransfer} data-testid="adjust-unit-card">
                调整
              </Button>
            }
          >
            {transferHistory.length ? (
              <Timeline
                items={[...transferHistory].reverse().map((t) => ({
                  color: 'blue',
                  children: (
                    <div data-testid={`transfer-item-${t.id}`}>
                      <Space size={6} wrap>
                        <Typography.Text strong>{t.date}</Typography.Text>
                        <Typography.Text delete type="secondary">
                          {t.fromUnit}
                        </Typography.Text>
                        <Typography.Text type="secondary">→</Typography.Text>
                        <Typography.Text strong>{t.toUnit}</Typography.Text>
                      </Space>
                      <div>
                        <Typography.Text type="secondary" className="gb-muted">
                          移交原因：{t.reason}
                        </Typography.Text>
                      </div>
                    </div>
                  ),
                }))}
              />
            ) : (
              <Typography.Text type="secondary">
                暂无移交记录，责任单位自登记以来未变更。
              </Typography.Text>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={14}>
          <Card
            title="核验历史"
            size="small"
            extra={
              <Typography.Text type="secondary" className="gb-muted">
                共 {history.length} 条
              </Typography.Text>
            }
          >
            {history.length ? (
              <Table<Inspection>
                rowKey="id"
                size="small"
                pagination={{ pageSize: 5, hideOnSinglePage: true }}
                dataSource={history}
                columns={inspectionColumns}
              />
            ) : (
              <EmptyState title="暂无核验记录" description="在右侧录入实测值即可生成第一条记录" compact />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card title="就地新增核验" size="small">
            <Form layout="vertical">
              <Row gutter={12}>
                <Col xs={24} md={12}>
                  <MeasureInput
                    label="坡度"
                    value={form.slope}
                    onChange={(v) => setForm((c) => ({ ...c, slope: v }))}
                    unit="%"
                    pass={5}
                    fail={8}
                    direction="max"
                    min={0}
                    max={100}
                    hint="纵坡不应大于 5%，超过 8% 判定不合格"
                  />
                </Col>
                <Col xs={24} md={12}>
                  <MeasureInput
                    label="净宽"
                    value={form.clearWidth}
                    onChange={(v) => setForm((c) => ({ ...c, clearWidth: v }))}
                    unit="cm"
                    pass={120}
                    fail={90}
                    direction="min"
                    min={0}
                    max={500}
                    step={1}
                    hint="净宽不应小于 120cm，小于 90cm 判定不合格"
                  />
                </Col>
                <Col xs={12} md={8}>
                  <Form.Item label="扶手">
                    <Switch
                      checked={form.hasHandrail}
                      onChange={(v) => setForm((c) => ({ ...c, hasHandrail: v }))}
                      checkedChildren="有"
                      unCheckedChildren="无"
                      data-testid="detail-switch-handrail"
                    />
                  </Form.Item>
                </Col>
                <Col xs={12} md={8}>
                  <Form.Item label="盲道连续">
                    <Switch
                      checked={form.tactileContinuous}
                      onChange={(v) => setForm((c) => ({ ...c, tactileContinuous: v }))}
                      checkedChildren="连续"
                      unCheckedChildren="断续"
                      data-testid="detail-switch-tactile"
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item label="被占用情况">
                    <Select
                      value={form.occupied}
                      onChange={(v) => setForm((c) => ({ ...c, occupied: v }))}
                      options={OCCUPIED_LEVELS.map((o) => ({ value: o, label: o }))}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item label="核验人">
                    <Input
                      id="detail-inspector"
                      value={form.inspector}
                      onChange={(e) => setForm((c) => ({ ...c, inspector: e.target.value }))}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item label="结论建议">
                    <Space data-testid="detail-suggested-conclusion">
                      <StatusBadge value={judgement.conclusion} kind="conclusion" bordered />
                      <Typography.Text type="secondary" className="gb-muted">
                        {judgement.reasons[0]}
                      </Typography.Text>
                    </Space>
                  </Form.Item>
                </Col>
                <Col span={24}>
                  <Form.Item label="问题描述">
                    <Input.TextArea
                      id="detail-problem"
                      rows={2}
                      value={form.problem}
                      onChange={(e) => setForm((c) => ({ ...c, problem: e.target.value }))}
                      placeholder="记录实测中发现的问题"
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Space>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  loading={saving}
                  onClick={handleSaveInspection}
                  data-testid="save-inspection"
                >
                  保存核验
                </Button>
                <Button icon={<ReloadOutlined />} onClick={handleCreateRectify} data-testid="gen-rectify">
                  生成整改条目
                </Button>
              </Space>
            </Form>
          </Card>
        </Col>
      </Row>

      <Card title="整改跟踪" size="small" style={{ marginTop: 16 }}>
        <Divider style={{ margin: '0 0 12px' }} />
        {plans.length ? (
          <Table<RectifyPlan> rowKey="id" size="small" pagination={false} dataSource={plans} columns={rectifyColumns} />
        ) : (
          <EmptyState
            title="暂无整改条目"
            description="核验结论为不合格时会自动生成整改条目"
            extra={
              <Button onClick={handleCreateRectify} data-testid="empty-gen-rectify">
                手动生成整改条目
              </Button>
            }
            compact
          />
        )}
      </Card>

      <Modal
        title="责任单位调整"
        open={transferOpen}
        onCancel={() => setTransferOpen(false)}
        onOk={handleTransfer}
        confirmLoading={transferSaving}
        okText="确认移交"
        cancelText="取消"
        destroyOnClose
        data-testid="transfer-modal"
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            点位：{point.name}（{point.code}）
            <br />
            当前责任单位：{point.maintainUnit}
          </Typography.Text>
          <div>
            <Typography.Text>
              新责任单位 <span style={{ color: '#cf1322' }}>*</span>
            </Typography.Text>
            <Select
              style={{ width: '100%', marginTop: 4 }}
              value={transferForm.toUnit || undefined}
              onChange={(v) => setTransferForm((c) => ({ ...c, toUnit: v }))}
              options={MAINTAIN_UNITS.filter((u) => u !== point.maintainUnit).map((u) => ({
                value: u,
                label: u,
              }))}
              placeholder="选择接手的养护单位"
              data-testid="transfer-unit-select"
            />
          </div>
          <div>
            <Typography.Text>
              移交日期 <span style={{ color: '#cf1322' }}>*</span>
            </Typography.Text>
            <div style={{ marginTop: 4 }}>
              <DatePicker
                style={{ width: '100%' }}
                value={transferForm.date ? dayjs(transferForm.date) : null}
                onChange={(d) =>
                  setTransferForm((c) => ({ ...c, date: d ? d.format('YYYY-MM-DD') : '' }))
                }
                allowClear={false}
                data-testid="transfer-date"
              />
            </div>
          </div>
          <div>
            <Typography.Text>
              移交原因 <span style={{ color: '#cf1322' }}>*</span>
            </Typography.Text>
            <Input.TextArea
              rows={3}
              style={{ marginTop: 4 }}
              value={transferForm.reason}
              onChange={(e) => setTransferForm((c) => ({ ...c, reason: e.target.value }))}
              placeholder="如：按片区养护边界调整，该路段设施统一划归新单位接管"
              data-testid="transfer-reason"
            />
          </div>
          <Typography.Text type="secondary" className="gb-muted">
            保存后：点位养护单位更新为新单位；本点位「待整改 / 复发」条目的责任单位同步跟进，
            后续逾期统计计入新单位；已完成条目保留原责任单位；变更前后均可在点位与整改清单追溯。
          </Typography.Text>
        </Space>
      </Modal>
    </div>
  );
}
