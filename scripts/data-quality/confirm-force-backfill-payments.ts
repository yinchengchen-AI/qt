#!/usr/bin/env tsx
/**
 * 存量 force 补录回款补确认脚本 (v0.26.1 配套, 一次性)。
 *
 * 背景:
 *   v0.25.16 之前, ADMIN/财务 force 补录的回款落为 PLANNED, 需要财务再点一次
 *   "确认" 才计入合同"已回款"口径。生产库里遗留了若干笔已补录未确认的 force
 *   回款, 导致合同显示回款仍为 0 / 缺口 (如 2026-11-20 补录的 QT-HT-2026-3113
 *   尾款 446,666.68)。本脚本把这笔历史断点补上。
 *
 * 做法:
 *   逐笔调用 paymentAction confirm (与人工在页面上点确认完全同一条 service
 *   路径) — 状态机迁移 + PAYMENT_CONFIRM 审计 + R-10 流水号查重 + R-11/R-12
 *   超额校验 + PAYMENT_RECEIVED 通知全部生效, 可回查。actor = system 用户。
 *
 * 范围:
 *   仅处理 status=PLANNED 且 remark 以 [FORCE_BACKFILL: 开头的回款。
 *   开票自动预创建的 -PLANNED 记录 (remark="开票预创建(...)") 不在范围,
 *   那些需要财务核对银行流水后人工判断, 多数应取消而非确认。
 *
 * 安全性:
 *   - 幂等: 已 CONFIRMED 的回款不会被重新命中 (过滤条件含 status=PLANNED)
 *   - 缺 bankRefNo 的记录跳过并告警 (confirm 前提), 人工补齐后重跑即可
 *   - 超额/流水号冲突由 paymentAction 内部校验拦截, 单笔失败不影响其它
 *
 * 用法:
 *   npx tsx scripts/data-quality/confirm-force-backfill-payments.ts --dry-run   # 预览
 *   npx tsx scripts/data-quality/confirm-force-backfill-payments.ts --apply     # 执行
 */
import { prisma } from "@/lib/prisma";
import { paymentAction } from "@/server/services/payment";
import { SYSTEM_USER_ID } from "@/lib/system";
import type { SessionUser } from "@/lib/session";

const APPLY = process.argv.includes("--apply");
const DRY_RUN = process.argv.includes("--dry-run") || !APPLY;

async function main() {
  const targets = await prisma.payment.findMany({
    where: {
      status: "PLANNED",
      deletedAt: null,
      remark: { startsWith: "[FORCE_BACKFILL:" },
    },
    select: {
      id: true,
      paymentNo: true,
      contractId: true,
      amount: true,
      bankRefNo: true,
      contract: { select: { contractNo: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  console.log(`命中 PLANNED + [FORCE_BACKFILL] 标记的回款: ${targets.length} 笔`);
  if (targets.length === 0) return;

  const actor: SessionUser = {
    id: SYSTEM_USER_ID,
    employeeNo: "system",
    name: "系统",
    email: "system@local",
    roleCode: "ADMIN",
    permissions: [],
  };

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (const p of targets) {
    const label = `${p.paymentNo} | 合同 ${p.contract.contractNo}(${p.contract.status}) | 金额 ${p.amount}`;
    if (!p.bankRefNo?.trim()) {
      skipped++;
      console.log(`[SKIP] ${label} | 缺 bankRefNo, 人工补流水号后重跑`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`[DRY-RUN] 将确认 ${label} | 流水号 ${p.bankRefNo}`);
      continue;
    }
    try {
      await paymentAction(actor, p.id, { action: "confirm" });
      ok++;
      console.log(`[OK] ${label} → CONFIRMED`);
    } catch (e) {
      failed++;
      console.log(`[FAIL] ${label} | ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`\n完成: 确认=${ok} 跳过=${skipped} 失败=${failed} (${DRY_RUN ? "dry-run, 未写入" : "apply"})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
