// 报表中心统一中文标签映射
// 供前端展示、Excel 导出、PDF 打印共用,保证各出口术语一致

export const REPORT_PERIOD_LABELS: Record<string, string> = {
  MONTH: "月报",
  QUARTER: "季报",
  YEAR: "年报",
  CUSTOM: "自定义",
};

export const REPORT_TYPE_LABELS: Record<string, string> = {
  FINANCIAL: "财务经营报表",
  BUSINESS: "业务经营报表",
  PERFORMANCE: "员工业绩报表",
  CUSTOM: "自定义组合报表",
};

export const REPORT_STATUS_LABELS: Record<string, string> = {
  READY: "就绪",
  PENDING: "生成中",
  FAILED: "失败",
  STALE: "过期",
};

// 数据字段 -> 中文表头/标签
// 覆盖 statistics.ts 各聚合函数返回的字段名
export const REPORT_COLUMN_LABELS: Record<string, string> = {
  // 通用
  id: "ID",
  key: "键",
  code: "编号",
  name: "名称",
  date: "日期",
  month: "月份",
  region: "区域",
  district: "区",
  town: "镇街",
  scale: "规模",
  customerType: "客户类型",

  // 金额
  total: "合计",
  totalAmount: "总金额",
  contractAmount: "合同额",
  invoiceAmount: "开票额",
  paymentAmount: "回款额",
  unpaidAmount: "未回款额",
  totalReceivable: "应收总额",
  over90Amount: "90天以上应收",
  invoiceTotal: "开票合计",
  paymentTotal: "回款合计",
  remaining: "剩余未收",

  // 比率
  invoiceRate: "开票率",
  paymentRate: "回款率",
  over90Ratio: "90天以上占比",

  // 计数/天数
  contractCount: "合同数",
  invoiceCount: "发票数",
  paymentCount: "回款笔数",
  customerCount: "客户数",
  ownerCount: "业务人员数",
  daysSinceSign: "签订后天数",
  daysOverdue: "逾期天数",

  // 员工业绩
  userId: "用户ID",
  employeeNo: "工号",

  // 账龄维度
  bucket0_30: "0-30天",
  bucket31_60: "31-60天",
  bucket61_90: "61-90天",
  bucket90: "90天以上",

  // 账龄行
  invoiceId: "发票ID",
  invoiceNo: "发票号",
  customerId: "客户ID",
  customerName: "客户名称",
  contractId: "合同ID",
  contractNo: "合同编号",
  ownerUserId: "负责人ID",
  ownerName: "负责人",
  bucket: "账龄段",
  status: "状态",
  basisUsed: "基准",
  hasDunning: "是否催收",
  latestDunningStatus: "最新催收状态",
  latestDunningAt: "最新催收时间",
};

/** 取字段中文标签,无映射时原样返回 */
export function reportColumnLabel(key: string): string {
  return REPORT_COLUMN_LABELS[key] ?? key;
}

/** 取周期中文标签 */
export function reportPeriodLabel(periodType: string): string {
  return REPORT_PERIOD_LABELS[periodType] ?? periodType;
}

/** 取状态中文标签 */
export function reportStatusLabel(status: string): string {
  return REPORT_STATUS_LABELS[status] ?? status;
}

/** 取报表类型中文标签 */
export function reportTypeLabel(type: string): string {
  return REPORT_TYPE_LABELS[type] ?? type;
}
