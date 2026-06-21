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
  action: z.enum(["confirm", "reconcile", "refund", "cancel", "allocate"]),
  bankRefNo: z.string().max(50).optional(),
  reason: z.string().max(500).optional(),
  allocations: z.array(z.object({
    invoiceId: z.string().nullable().optional(),
    projectId: z.string().nullable().optional(),
    // P1-5: 单条分配金额必须 > 0, 0 或负数无业务意义且会被 service 端合计校验绕过
    amount: z.number().positive("分配金额必须大于 0")
  })).optional()
});

export type PaymentCreateInput = z.infer<typeof paymentCreateSchema>;
export type PaymentActionInput = z.infer<typeof paymentActionSchema>;
