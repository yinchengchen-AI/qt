// 发票"占用合同开票额度"的状态口径 (R-08) — 唯一权威定义。
//
// 背景: 此前 invoice/crud.ts、contract/crud.ts 各自硬编码 ["DRAFT","ISSUED","RED_FLUSHED"],
// 漏了 PENDING_FINANCE, 导致发票一旦提交(DRAFT→PENDING_FINANCE)就从额度校验中"隐身",
// 可顺序操作无限超额开票。统一收敛到这里, 所有 R-08 累计校验必须消费此常量。
//
// 口径推演(一张票生命周期内恰好计一次):
//   DRAFT(草稿占额) → PENDING_FINANCE(待审仍占额) → ISSUED(已开占额)
//     → VOIDED(作废, 释放, 不计) / RED_FLUSHED(原票保留 +A, 配套负票 ISSUED −A, 净 0)
//   红冲对净额为 0 自洽; REJECTED(驳回)视同未提交, 不占额。
export const INVOICE_LIMIT_COUNTED_STATUSES = [
  "DRAFT",
  "PENDING_FINANCE",
  "ISSUED",
  "RED_FLUSHED",
] as const;

// "已开票有效金额"展示/判定口径 (区别于上面的额度占用口径)。
// 用于合同已开票列、tryAutoClose 开票足额判断、统计"已开票额/开票率"。
// ISSUED(含红冲负票 −A) + RED_FLUSHED(原票 +A) → 红冲对净 0; DRAFT/PENDING_FINANCE 未实际开具, 不计。
export const INVOICE_ISSUED_AMOUNT_STATUSES = [
  "ISSUED",
  "RED_FLUSHED",
] as const;
