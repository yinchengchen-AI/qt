// /api/files/presign-upload 共享 body schema
// 抽出来便于在 vitest 直接 import 测试,避免 from "@/app/api/..." 反向依赖
import { z } from "zod";

export const presignUploadBodySchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(127),
  size: z.number().int().positive(),
  contractId: z.string().optional().nullable(),
  invoiceId: z.string().optional().nullable(),
  // v1 标书素材库新增
  assetId: z.string().optional().nullable()
});

export type PresignUploadBody = z.infer<typeof presignUploadBodySchema>;
