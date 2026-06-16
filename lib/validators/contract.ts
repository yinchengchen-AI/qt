import { z } from "zod";
import { CONTRACT_PAYMENT_METHOD } from "@/types/enums";
import { attachmentUrlSchema } from "@/lib/validators/_shared";

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
  taxRate: z.number().min(0).max(1).default(0.06),
  paymentMethod: z.enum(CONTRACT_PAYMENT_METHOD),
  // 签订人:前端表单默认选当前登录员工,允许 admin 改成任意员工;
  // 不传时 service 层回退为当前 user.id,避免历史调用方漏字段
  signerId: z.string().min(1).optional(),
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

// 合同生命周期:执行中 / 暂停 / 恢复 / 结清
// 由已生效/执行中/已暂停的合同进入下一阶段,无审批环节
// action 由 URL 路径 (/execute /suspend /resume /complete) 决定,body 只承载可选 comment
export const lifecycleActionSchema = z.object({
  comment: z.string().max(500).optional()
});

export type ContractCreateInput = z.infer<typeof contractCreateSchema>;
export type ContractUpdateInput = z.infer<typeof contractUpdateSchema>;
export type ReviewActionInput = z.infer<typeof reviewActionSchema>;
export type LifecycleActionInput = z.infer<typeof lifecycleActionSchema>;
