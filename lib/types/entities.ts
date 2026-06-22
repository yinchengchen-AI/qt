// 详情页的实体类型。字段名跟 list 路由 / detail 路由的 Prisma select 保持一致。
// 这里只覆盖 ProDescriptions 实际访问的字段；其他字段以 Record<string, unknown> 兜底。

export type AttachmentSnapshot = {
  id: string;
  name: string;
  url?: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
};

export type InstallmentPhase = {
  phase: string;
  amount: number;
  dueDate?: string;
  condition?: string;
};

// 合同交付物: 服务方承诺的成果(报告 / 证书 / 培训材料 等).
// 列表由前端编辑器维护, 存为 Contract.deliverables (JSONB).
// 详情页与回款"关联交付物"展示用.
export type DeliverableItem = {
  id: string;
  name: string;
  type?: string;
  dueDate?: string;
  quantity?: number;
  unit?: string;
  remark?: string;
};

export type Contract = {
  id: string;
  contractNo: string;
  customerId: string;
  customerName: string;
  title: string;
  serviceType: string;
  signDate: string;
  startDate: string;
  endDate: string;
  totalAmount: string;
  taxRate: string;
  taxAmount: string;
  amountExcludingTax: string;
  paymentMethod: string;
  status: string;
  attachments: AttachmentSnapshot[];
  installmentPlan: InstallmentPhase[] | null;
  // 合同交付物清单; 不存时为空数组 (服务层兜底)
  deliverables: DeliverableItem[];
  // 签订人 / 负责人: 后端 getContract 直接透出 Prisma 字段, 用于"交付物附件管理"权限判断
  // (useCanManageContractDeliverables: admin / 签订人 / 负责人 三者之一)
  signerId: string;
  ownerUserId: string;
  reviewComment: string | null;
  reviewerId: string | null;
  reviewAt: string | null;
  reviewLogs: ContractReviewLog[];
  // 负责人姓名 (后端 list/get 投影, 前端展示用)
  ownerName?: string;
  ownerEmployeeNo?: string;
};

export type ContractReviewLog = {
  id: string;
  action: string;          // SUBMIT | APPROVE | REJECT | WITHDRAW
  comment: string | null;
  at: string;              // ISO
  reviewerId: string;
  reviewerName: string;
};

export type Invoice = {
  id: string;
  invoiceNo: string | null;
  customerId: string;
  customerName: string;
  contractId: string;
  contractNo: string;
  invoiceType: string;
  amount: string;
  taxAmount: string;
  amountExcludingTax: string;
  taxRate: string;
  applyDate: string;
  expectedIssueDate: string | null;
  actualIssueDate: string | null;
  titleType: string;
  titleName: string;
  taxNo: string | null;
  bankName: string | null;
  bankAccount: string | null;
  address: string | null;
  phone: string | null;
  remark: string | null;
  status: string;
  attachments: AttachmentSnapshot[];
  invoice: Invoice | null;
  // 关联合同"上下文"(后端 getPayment / listPayments 已带出); 详情页"关联合同"展示合同号/标题/客户/服务类型/金额
  // 列表场景合同号/标题/服务类型用于"合同"列渲染; 不含 deliverables — 交付物仅在合同管理侧展示
  contract?: {
    contractNo: string;
    title?: string | null;
    customerName?: string | null;
    serviceType?: string | null;
    totalAmount?: string | null;
    status?: string | null;
    paymentMethod?: string | null;
    signDate?: string | null;
  } | null;
};

export type Payment = {
  id: string;
  paymentNo: string;
  contractId: string;
  contractNo: string;
  customerId: string;
  customerName: string;
  invoiceId: string | null;
  invoiceNo: string | null;
  amount: string;
  receivedAt: string;
  method: string;
  bankRefNo: string | null;
  bankName: string | null;
  remark: string | null;
  status: string;
  // 登记人 / 对账人,后端存的是 userId,前端用 useUserName 转姓名
  recorderUserId: string;
  reconcileUserId: string | null;
  reconciledAt: string | null;
  invoice: Invoice | null;
  // 关联合同"上下文"(后端 getPayment / listPayments 已带出); 详情页"关联合同"展示合同号/标题/客户/服务类型/金额
  // 列表场景合同号/标题/服务类型用于"合同"列渲染; 不含 deliverables — 交付物仅在合同管理侧展示
  contract?: {
    contractNo: string;
    title?: string | null;
    customerName?: string | null;
    serviceType?: string | null;
    totalAmount?: string | null;
    status?: string | null;
    paymentMethod?: string | null;
    signDate?: string | null;
  } | null;
};

export type Customer = {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  unifiedSocialCreditCode: string | null;
  customerType: string;
  industry: string | null;
  scale: string | null;
  sourceChannel: string | null;
  status: string;
  contactName: string | null;
  contactTitle: string | null;
  contactPhone: string;
  province: string;
  city: string;
  district: string | null;
  address: string | null;
  town: string | null;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
};
