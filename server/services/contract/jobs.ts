/**
 * 合同状态机自动转换 — DRAFT → ACTIVE / ACTIVE → CLOSED
 *
 * 触发入口:
 *   - tryAutoPublish:   createContract / updateContract / tickPublishableDraffts 调
 *   - tryAutoClose:     tickCompletionCandidates 调
 *                       (R-07: 开票+回款都足额, reason 由 endDate<now 自动判定)
 *
 * 写 ContractReviewLog.action: AUTO_PUBLISH / AUTO_CLOSE_COMPLETED / AUTO_CLOSE_EXPIRED
 * 状态不匹配 / 条件不满足 → 静默 no-op, 不会拖垮主事务.
 *
 * 历史: 之前 tryAutoComplete + tryAutoCloseOnExpiry 两条独立路径,
 *       前者只查 ratio*total, 后者只查 invoicing>=total 且无回款检查,
 *       行为不一致; 已统一为 tryAutoClose 一条, 走同一份 ratio 校验 + 双足额前置.
 *       job 端也只剩 tickCompletionCandidates 一条, runContractExpiryJob 已删除。
 *
 * 真正的实现 (tryAutoClose / tryAutoPublish / closeContract 等) 在 ./status.ts;
 * job runner (tickPublishableDraffts / tickCompletionCandidates) 在 server/jobs/contract-automation.ts。
 * 本文件保留为文档占位, 外部仍然可以从 "@/server/services/contract" barrel 拿到所有 API。
 */
export {};
