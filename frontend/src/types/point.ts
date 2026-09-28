/** 设施类型（六个枚举值，与提示词一致） */
export type FacilityType =
  | '缘石坡道'
  | '盲道'
  | '无障碍电梯'
  | '轮椅坡道'
  | '无障碍卫生间'
  | '低位服务台';

export const FACILITY_TYPES: FacilityType[] = [
  '缘石坡道',
  '盲道',
  '无障碍电梯',
  '轮椅坡道',
  '无障碍卫生间',
  '低位服务台',
];

/** 行政区（北京市主要城区） */
export const DISTRICTS = ['东城区', '西城区', '朝阳区', '海淀区', '丰台区', '石景山区'] as const;

export type District = (typeof DISTRICTS)[number];

/** 养护单位 */
export const MAINTAIN_UNITS = [
  '市政道路养护一所',
  '市政道路养护二所',
  '轨道交通运营部',
  '园林绿化服务中心',
  '城管委设施科',
] as const;

/** 设施点位 */
export interface AccessPoint {
  id: string;
  /** 点位编号，例：WZ-2024-001 */
  code: string;
  name: string;
  facilityType: FacilityType;
  lng: number;
  lat: number;
  district: string;
  /** 所在道路或建筑 */
  location: string;
  /** 建成年代 */
  builtYear: number;
  /** 当前养护单位（随最近一次移交更新） */
  maintainUnit: string;
  createdAt: string;
  updatedAt: string;
}

export type AccessPointDraft = Omit<AccessPoint, 'id' | 'createdAt' | 'updatedAt'>;

/** 责任单位移交记录：点位养护单位变更的审计轨迹 */
export interface UnitTransfer {
  id: string;
  pointId: string;
  /** 移交前责任单位（首次登记单位或上一任养护单位） */
  fromUnit: string;
  /** 移交后责任单位（点位当前养护单位） */
  toUnit: string;
  /** 移交日期 YYYY-MM-DD */
  date: string;
  /** 移交原因 */
  reason: string;
  createdAt: string;
}

export type UnitTransferDraft = Pick<UnitTransfer, 'pointId' | 'fromUnit' | 'toUnit' | 'date' | 'reason'>;
