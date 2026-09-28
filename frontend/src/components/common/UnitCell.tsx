import { Popover, Space, Tag, Timeline, Typography } from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import type { RectifyPlan } from '../../types/rectify';

interface UnitCellProps {
  plan: RectifyPlan;
  /** 点位当前养护单位；传入后可标记「已非当前单位」的已完成条目 */
  currentUnit?: string;
}

/**
 * 整改清单 / 点位详情整改表格统一使用的责任单位单元格：
 * 展示当前责任单位；发生过移交时提供变更轨迹气泡，
 * 使责任变更在整改清单侧同样可查。
 */
export default function UnitCell({ plan, currentUnit }: UnitCellProps) {
  const changes = plan.unitChanges ?? [];
  const originalUnit = changes.length ? changes[0].fromUnit : '';
  const moved = Boolean(originalUnit && originalUnit !== plan.unit);
  const outdated = Boolean(currentUnit && currentUnit !== plan.unit);

  const content =
    changes.length > 0 ? (
      <Timeline
        style={{ marginTop: 12, marginBottom: 0, maxWidth: 340 }}
        items={changes.map((c) => ({
          children: (
            <div>
              <Typography.Text strong>
                {c.fromUnit} → {c.toUnit}
              </Typography.Text>
              <div>
                <Typography.Text type="secondary">{c.date}</Typography.Text>
              </div>
              <Typography.Text type="secondary">{c.reason}</Typography.Text>
            </div>
          ),
        }))}
      />
    ) : (
      <Typography.Text type="secondary">该条目落单后未发生过责任单位移交。</Typography.Text>
    );

  return (
    <Space size={4} wrap data-testid={`unit-cell-${plan.id}`}>
      <span>{plan.unit}</span>
      {moved ? (
        <Tag color="blue" style={{ marginInlineStart: 0 }}>
          原 {originalUnit}
        </Tag>
      ) : null}
      {outdated && !moved ? <Tag>已非当前单位</Tag> : null}
      <Popover
        title="责任单位变更记录"
        content={content}
        placement="topLeft"
        trigger={['click']}
      >
        <HistoryOutlined
          style={{ color: '#1677ff', cursor: 'pointer' }}
          data-testid={`unit-history-${plan.id}`}
          aria-label="查看责任单位变更记录"
        />
      </Popover>
    </Space>
  );
}
