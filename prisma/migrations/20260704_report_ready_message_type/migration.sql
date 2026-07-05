-- 报表订阅通知：给 MessageType enum 增加 REPORT_READY
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'REPORT_READY';
