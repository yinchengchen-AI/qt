import { z } from "zod";

const isoDate = z.iso.datetime();

// 到账日不得为未来日期 (create 必填 / confirm 时可选覆盖共用同一口径)
const notFuture = (v: string) => new Date(v).getTime() <= Date.now();
const methodEnum = z.enum(["BANK_TRANSFER", "CHECK", "CASH", "WECHAT", "ALIPAY", "OTHER"]);

export const paymentCreateSchema = z.object({
  contractId: z.string().min(1, "请选择合同"),
  invoiceId: z.string().optional(),
  amount: z
    .number()
    .positive("金额必须大于 0")
    .max(999999999999.99, "金额超出上限")
    // 字符串形式判定, 避免 0.07*100=7.000000000000001 这类浮点误伤
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v.toString()), "金额最多 2 位小数"),
  receivedAt: isoDate.refine(notFuture, "到账日不得为未来日期"),
  method: methodEnum,
  bankRefNo: z.string().max(50).optional(),
  bankName: z.string().max(50).optional(),
  remark: z.string().max(500).optional()
});

export const paymentActionSchema = z.object({
  action: z.enum(["confirm", "reconcile", "refund", "cancel"]),
  bankRefNo: z.string().max(50).optional(),
  reason: z.string().max(500).optional(),
  // confirm 时可选更正实际到账日 / 收款方式 (预建 PLANNED 的 receivedAt 是开票时间快照)
  receivedAt: isoDate.refine(notFuture, "到账日不得为未来日期").optional(),
  method: methodEnum.optional()
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
