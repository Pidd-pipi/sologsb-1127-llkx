/** 整改状态 */
export type RectifyStatus = '待整改' | '已整改' | '复发';

export const RECTIFY_STATUSES: RectifyStatus[] = ['待整改', '已整改', '复发'];

/** 整改条目责任单位的一次变更轨迹（由点位养护单位移交触发） */
export interface UnitChange {
  /** 变更前责任单位 */
  fromUnit: string;
  /** 变更后责任单位 */
  toUnit: string;
  /** 移交日期 YYYY-MM-DD */
  date: string;
  /** 移交原因 */
  reason: string;
}

/** 整改跟踪条目 */
export interface RectifyPlan {
  id: string;
  pointId: string;
  /** 整改要求 */
  requirement: string;
  /** 当前责任单位（移交后未整改/复发条目跟随到新单位，已完成条目保留原单位） */
  unit: string;
  /** 整改期限 YYYY-MM-DD */
  deadline: string;
  /** 复检日期 YYYY-MM-DD，未复检为空字符串 */
  recheckDate: string;
  status: RectifyStatus;
  /** 责任单位变更轨迹（按时间正序）；落单后未发生过变更为空数组，兼容历史记录缺省 */
  unitChanges?: UnitChange[];
  createdAt: string;
}

export type RectifyPlanDraft = Omit<RectifyPlan, 'id' | 'createdAt'>;

/** 按状态与期限分组后的清单结构 */
export interface RectifyGroup {
  key: string;
  title: string;
  items: RectifyPlan[];
}
