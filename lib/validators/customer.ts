import { z } from "zod";
import { CUSTOMER_SCALE, CUSTOMER_TYPE } from "@/types/enums";
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
  // 区级 (district) 可选 — 老数据 (迁移前) 经常空着, 4 级只填前 3 级时也允许为空
  district: z.string().max(40).optional(),
  // 镇街 (town) 与 district 同语义 — 4 级级联最末级, 客户表单里跟着 cascader 自动填充, 表层只读展示
  town: z.string().max(50).optional(),
  address: z.string().max(200).optional(),
  contactName: z.string().max(50).optional(),
  contactTitle: z.string().max(50).optional(),
  contactPhone: z.string().min(5, "请输入联系电话").max(20),
  sourceChannel: z.string().max(50).optional(),
  ownerUserId: z.string().optional()
});

export const customerUpdateSchema = customerCreateSchema.partial();

export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;

// 客户列表 query:导出供 use-list-request 反射出 KNOWN_KEYS, 也供 app/api/customers/route.ts 用,
// 不再在 route 文件里 inline 定义。
export const customerListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
  scale: z.string().optional(),
  customerType: z.string().optional(),
  industry: z.string().optional(),
  province: z.string().optional(),
  city: z.string().optional(),
  district: z.string().optional(),
  town: z.string().optional(),
  ownerUserId: z.string().optional(),
  createdAtFrom: z.string().optional(),
  createdAtTo: z.string().optional(),
});

