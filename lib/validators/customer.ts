import { z } from "zod";
import { CUSTOMER_LEVEL, CUSTOMER_SCALE, CUSTOMER_TYPE } from "@/types/enums";
import { isValidCreditCode } from "@/lib/credit-code";

export const customerCreateSchema = z.object({
  name: z.string().min(2, "客户名称至少 2 个字符").max(100),
  shortName: z.string().max(50).optional(),
  unifiedSocialCreditCode: z
    .string()
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || isValidCreditCode(v), { message: "统一社会信用代码格式错误" }),
  customerType: z.enum(CUSTOMER_TYPE),
  industry: z.string().max(50).optional(),
  scale: z.enum(CUSTOMER_SCALE).optional(),
  province: z.string().min(1, "请输入省份").max(20),
  city: z.string().min(1, "请输入城市").max(40),
  address: z.string().max(200).optional(),
  contactPhone: z.string().min(5, "请输入联系电话").max(20),
  contactEmail: z.string().email("邮箱格式错误").optional().or(z.literal("")),
  sourceChannel: z.string().max(50).optional(),
  level: z.enum(CUSTOMER_LEVEL).default("C"),
  ownerUserId: z.string().optional(),
  creditLimitAmount: z.number().nonnegative().optional(),
  paymentTermDays: z.number().int().min(0).max(365).default(30)
});

export const customerUpdateSchema = customerCreateSchema.partial();

export const followUpCreateSchema = z.object({
  followAt: z.iso.datetime(),
  method: z.enum(["VISIT", "CALL", "WECHAT", "EMAIL", "OTHER"]),
  content: z.string().min(1, "请填写跟进内容").max(2000),
  nextFollowAt: z.iso.datetime().optional(),
  result: z.enum(["INTENT", "NO_INTENT", "PENDING", "SIGNED"]).optional()
});

export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;
export type FollowUpCreateInput = z.infer<typeof followUpCreateSchema>;
