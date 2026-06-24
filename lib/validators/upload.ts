// /api/files/presign-upload 共享 body schema
// 抽出来便于在 vitest 直接 import 测试,避免 from "@/app/api/..." 反向依赖
import { z } from "zod";

export const presignUploadBodySchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(127),
  size: z.number().int().positive(),
  contractId: z.string().optional().nullable(),
  invoiceId: z.string().optional().nullable(),
  employeeProfileId: z.string().optional().nullable(),
  // 合同交付物附件标记 (true 表示这是合同详情"交付物"tab 上传的交付文件, 写权限仅 admin / 签订人 / 负责人)
  isDeliverable: z.boolean().optional().default(false)
});

export type PresignUploadBody = z.infer<typeof presignUploadBodySchema>;
