import { z } from "zod";

const isoDate = z.iso.datetime();

export const paymentCreateSchema = z.object({
  contractId: z.string().min(1, "请选择合同"),
  invoiceId: z.string().optional(),
  amount: z.number().positive("金额必须大于 0"),
  receivedAt: isoDate,
  method: z.enum(["BANK_TRANSFER", "CHECK", "CASH", "WECHAT", "ALIPAY", "OTHER"]),
  bankRefNo: z.string().max(50).optional(),
  bankName: z.string().max(50).optional(),
  remark: z.string().max(500).optional()
});

export const paymentActionSchema = z.object({
  action: z.enum(["confirm", "reconcile", "refund", "cancel"]),
  bankRefNo: z.string().max(50).optional(),
  reason: z.string().max(500).optional()
});

export type PaymentCreateInput = z.infer<typeof paymentCreateSchema>;
export type PaymentActionInput = z.infer<typeof paymentActionSchema>;

// 回款列表 query:导出供 use-list-request 反射出 KNOWN_KEYS, 也供 app/api/payments/route.ts 用
export const paymentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
  status: z.string().optional(),
  contractId: z.string().optional(),
  invoiceId: z.string().optional(),
});
