import { z } from "zod";

// =====================================================
// 银行流水导入
// =====================================================

export const bankTransactionImportSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1, "至少导入一行数据"),
});

export type BankTransactionImportInput = z.infer<typeof bankTransactionImportSchema>;

// =====================================================
// 银行流水查询
// =====================================================

export const bankTransactionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  matchStatus: z.string().optional(),
  keyword: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  minAmount: z.coerce.number().optional(),
  maxAmount: z.coerce.number().optional(),
});

export type BankTransactionListQuery = z.infer<typeof bankTransactionListQuerySchema>;

// =====================================================
// 匹配操作
// =====================================================

export const matchActionSchema = z.object({
  action: z.enum(["auto-match", "confirm-match", "manual-match", "unmatch", "ignore"]),
  paymentId: z.string().optional(),
});

export type MatchActionInput = z.infer<typeof matchActionSchema>;

export const batchMatchSchema = z.object({
  transactionIds: z.array(z.string()).optional(),
});

export type BatchMatchInput = z.infer<typeof batchMatchSchema>;

// =====================================================
// 差异处理
// =====================================================

export const discrepancyListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().optional(),
  severity: z.string().optional(),
});

export type DiscrepancyListQuery = z.infer<typeof discrepancyListQuerySchema>;

export const resolveDiscrepancySchema = z.object({
  resolution: z.string().min(1, "请填写处理结果").max(1000),
});

export type ResolveDiscrepancyInput = z.infer<typeof resolveDiscrepancySchema>;

// =====================================================
// 规则配置
// =====================================================

export const reconciliationRuleSchema = z.object({
  name: z.string().min(1, "规则名称不能为空").max(100),
  priority: z.number().int().min(0).max(999).default(0),
  conditions: z.record(z.string(), z.unknown()),
  action: z.enum(["AUTO_MATCH", "SUGGEST_MATCH", "FLAG_REVIEW"]),
});

export const reconciliationRuleUpdateSchema = reconciliationRuleSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type ReconciliationRuleInput = z.infer<typeof reconciliationRuleSchema>;
export type ReconciliationRuleUpdateInput = z.infer<typeof reconciliationRuleUpdateSchema>;
