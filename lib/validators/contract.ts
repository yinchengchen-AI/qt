import { z } from "zod";
import { CONTRACT_PAYMENT_METHOD } from "@/types/enums";
import { attachmentUrlSchema, taxRateSchema } from "@/lib/validators/_shared";

const isoDate = z.iso.datetime();

const attachment = z.object({
  id: z.string(),
  name: z.string().min(1),
  // url optional: 新流程存 MinIO objectKey, 下载时实时签 URL
  // 旧数据 (https://placeholder.local/...) 仅在历史列表展示
  url: attachmentUrlSchema,
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  uploadedBy: z.string(),
  uploadedAt: z.string()
});

// 合同结构化交付物 (deliverables JSON) 已下线: 实际交付文件走 Attachment.isDeliverable
// (合同详情"交付物"tab 内上传, 写权限仅 admin / 签订人 / 负责人)
// 保留 DeliverableInput 类型别名避免老 import 报错; 实际 schema 不再使用

export const contractCreateSchema = z.object({
  customerId: z.string().min(1, "请选择客户"),
  // 合同编号:改为手工录入,不再由系统按 Sequence 生成;
  // 唯一性由 DB @unique + service 层校验 P2002 兜底
  contractNo: z.string().min(1, "请填写合同编号").max(50, "合同编号不超过 50 字"),
  title: z.string().min(2, "合同标题至少 2 个字符").max(200),
  serviceType: z.string().min(1),  // 兼容 LEGACY-* 旧服务类型 (Dictionary 校验在 service 层做)
  signDate: isoDate,
  startDate: isoDate,
  endDate: isoDate,
  totalAmount: z.number().positive("合同总额必须大于 0"),
  taxRate: taxRateSchema.default(0.06),
  paymentMethod: z.enum(CONTRACT_PAYMENT_METHOD),
  // 签订人:前端表单默认选当前登录员工,允许 admin 改成任意员工;
  // 不传时 service 层回退为当前 user.id,避免历史调用方漏字段
  signerId: z.string().min(1).optional(),
  // 负责人:前端表单默认跟 customer.ownerUserId 一致(继承客户业务负责人);
  // admin 可显式改成任意 ACTIVE 员工(支持跨部门代签/转交).
  // 不传时 service 层回退为 customer.ownerUserId.
  ownerUserId: z.string().min(1).optional(),
  // 合同备注: 自由文本, 跟 reviewComment (审批意见) 区分; 500 字符上限跟付款备注对齐
  // 允许 null: PATCH 时传 {remark: null} 表示显式清空; 不传 / undefined 表示不动
  remark: z.union([z.string().max(500), z.null()]).optional(),
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
  // 合同结构化交付物 (deliverables JSON) 已下线; 实际交付文件走 Attachment.isDeliverable=true
  attachments: z.array(attachment).default([])
});

export const contractUpdateSchema = contractCreateSchema
  .omit({ customerId: true, signerId: true })
  .partial()
  .extend({
    attachments: z.array(attachment).optional()
  });

export const reviewActionSchema = z.object({
  action: z.enum(["SUBMIT", "APPROVE", "REJECT", "WITHDRAW"]),
  comment: z.string().max(500).optional()
});

export type ContractCreateInput = z.infer<typeof contractCreateSchema>;
export type ContractUpdateInput = z.infer<typeof contractUpdateSchema>;
// 旧: 合同结构化交付物条目; 现已下线, 类型保留仅作占位以避免老 import 编译报错
export type DeliverableInput = { id: string; name: string };
export type ReviewActionInput = z.infer<typeof reviewActionSchema>;

// 合同列表 query:导出供 use-list-request 反射出 KNOWN_KEYS, 也供 app/api/contracts/route.ts 用
export const contractListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
  status: z.string().optional(),
  customerId: z.string().optional(),
});
