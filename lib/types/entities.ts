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
  reviewComment: string | null;
  reviewerId: string | null;
  reviewAt: string | null;
  reviewLogs: ContractReviewLog[];
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
  allocations: PaymentAllocation[];
};

export type Project = {
  id: string;
  projectNo: string;
  contractId: string;
  contractNo: string;
  contract: { contractNo: string; customerName: string } | null;
  name: string;
  serviceScope: string;
  status: string;
  startDate: string;
  endDate: string;
  budgetAmount: string | null;
  managerUserId: string | null;
  managerName: string | null;
  customerId: string;
  customerName: string;
  attachments: AttachmentSnapshot[];
  progressLogs: { id: string; projectId: string; userId: string; percent: number; remark: string; at: string }[];
};

export type PaymentAllocation = {
  id: string;
  invoiceId: string;
  projectId: string;
  amount: string;
  remark: string | null;
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
  attachments: AttachmentSnapshot[];
  invoice: Invoice | null;
  allocations: PaymentAllocation[];
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
  address: string | null;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
};
