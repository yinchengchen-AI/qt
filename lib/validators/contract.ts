import { z } from "zod";
import { CONTRACT_PAYMENT_METHOD, SERVICE_TYPE } from "@/types/enums";

const isoDate = z.iso.datetime();

const attachment = z.object({
  id: z.string(),
  name: z.string().min(1),
  url: z.string().url(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  uploadedBy: z.string(),
  uploadedAt: z.string()
});

export const contractCreateSchema = z.object({
  customerId: z.string().min(1, "请选择客户"),
  title: z.string().min(2, "合同标题至少 2 个字符").max(200),
  serviceType: z.enum(SERVICE_TYPE),
  signDate: isoDate,
  startDate: isoDate,
  endDate: isoDate,
  totalAmount: z.number().positive("合同总额必须大于 0"),
  taxRate: z.number().min(0).max(1).default(0.06),
  paymentMethod: z.enum(CONTRACT_PAYMENT_METHOD),
  installmentPlan: z
    .array(
      z.object({
        phase: z.string().min(1),
        amount: z.number().positive(),
        dueDate: isoDate.optional(),
        condition: z.string().optional()
      })
    )
    .optional(),
  attachments: z.array(attachment).default([])
});

export const contractUpdateSchema = contractCreateSchema.partial().extend({
  attachments: z.array(attachment).optional()
});

export const reviewActionSchema = z.object({
  action: z.enum(["SUBMIT", "APPROVE", "REJECT", "WITHDRAW"]),
  comment: z.string().max(500).optional()
});

export type ContractCreateInput = z.infer<typeof contractCreateSchema>;
export type ContractUpdateInput = z.infer<typeof contractUpdateSchema>;
export type ReviewActionInput = z.infer<typeof reviewActionSchema>;
