-- 操作日志审计字段补全
-- 背景:现状 OperationLog 只有 ip + diff + at,排查安全/合规问题时缺少
--       User-Agent / 请求 ID / HTTP method / 路径 / 成功失败状态.
-- 行为:
--   - 新增字段全部可空 (除 status 有默认值),历史行不会破坏
--   - status 枚举值: SUCCESS(默认)/ FAILURE;FAILURE 留作未来失败回写
--   - 新增索引便于按 requestId 关联追踪,按 status 过滤
--   - userAgent 截断 500 字符,避免异常长 UA 撑爆日志表

BEGIN;

ALTER TABLE "OperationLog"
  ADD COLUMN "userAgent" TEXT,
  ADD COLUMN "requestId" TEXT,
  ADD COLUMN "method" TEXT,
  ADD COLUMN "path" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'SUCCESS',
  ADD COLUMN "errorMessage" TEXT;

-- User-Agent 截断到 500 字符(防止被恶意超长 header 撑爆日志表)
ALTER TABLE "OperationLog"
  ADD CONSTRAINT "OperationLog_userAgent_length_chk"
  CHECK ("userAgent" IS NULL OR length("userAgent") <= 500);

CREATE INDEX "OperationLog_requestId_idx" ON "OperationLog"("requestId");
CREATE INDEX "OperationLog_status_idx" ON "OperationLog"("status");

COMMIT;
