-- 操作日志列表页「动作」过滤走精确匹配,补索引避免全表扫描
CREATE INDEX "OperationLog_action_idx" ON "OperationLog"("action");
