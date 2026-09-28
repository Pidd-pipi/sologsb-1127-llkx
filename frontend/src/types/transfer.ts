/**
 * 责任单位移交记录
 * 养护单位之间移交设施时，点位详情登记一条移交记录；
 * 点位当前养护单位取 AccessPoint.maintainUnit，本表保留每次变更前后的单位与原因。
 */
export interface UnitTransfer {
  id: string;
  pointId: string;
  /** 移交前养护单位 */
  fromUnit: string;
  /** 移交后养护单位 */
  toUnit: string;
  /** 移交日期 YYYY-MM-DD */
  transferDate: string;
  /** 移交原因 */
  reason: string;
  createdAt: string;
}

/** 登记移交时由前端提供，fromUnit 从事务内点位当前值解析，防止前端篡改 */
export type UnitTransferDraft = Omit<UnitTransfer, 'id' | 'createdAt' | 'fromUnit'>;
