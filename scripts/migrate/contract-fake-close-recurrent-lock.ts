#!/usr/bin/env tsx
/**
 * 合同"假完结"复发处理 — 加临时 lock 标记, 阻止 cron 反复强关
 *
 * 背景:
 *   2026-06-29 跑了 contract-fake-close-recovery.ts, 把 242 个合同的 CLOSED → ACTIVE.
 *   但财务还没补录完付款, cron 每小时扫一次又把满足 tryAutoCloseOnOverdue 条件的
 *   合同再次强关 (reason=overdue_terminated). 反复关-开-关, 财务永远录不进去.
 *
 * 这个脚本做的事:
 *   1) 找出所有 reviewComment='recovered_from_fake_close' AND status='CLOSED' AND 未结清 的合同
 *      (即"复发"的 6/29 那批, 当前又被 cron 关回去了的)
 *   2) 把它们重新打开 (CLOSED → ACTIVE) + 加 lock 标记:
 *      reviewComment = 'lock:overdue_skip:<batch_id>'
 *   3) 备份原状态到 Contract_fake_close_recurrent_<date> 表 (与 6/29 那次分开, 便于追踪)
 *   4) 写 ContractReviewLog (action='MANUAL_REOPEN', comment 说明触发原因)
 *   5) 不动"自然新增"的假完结合同 (reviewComment 为空 / overdue_terminated 的),
 *      那些走 reopen + force 旁路的人工流程
 *
 * lock 机制说明 (见 server/jobs/contract-automation.ts):
 *   - tryAutoClose 路径不受 lock 影响 (钱齐了就完结)
 *   - tryAutoCloseOnOverdue 路径跳过 lock 合同
 *   - 解锁: UPDATE Contract SET reviewComment = NULL WHERE id = '...'
 *
 * 用法:
 *   pnpm tsx scripts/migrate/contract-fake-close-recurrent-lock.ts --dry-run
 *   pnpm tsx scripts/migrate/contract-fake-close-recurrent-lock.ts --execute --batch 2026-06-29-batch
 *
 * 前置:
 *   1) 备份整库: pg_dump -Fc qt_biz > /backup/qt_biz_20260630.dump
 *   2) 暂停 cron: sudo systemctl stop qt-app (避免执行期间 cron 又误关)
 *   3) 先用 --dry-run 预览, 确认目标数在 50~300 之间
 */
import { config } from "dotenv";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

config();

const DRY_RUN = process.argv.includes("--dry-run");
const EXECUTE = process.argv.includes("--execute");

if (DRY_RUN === EXECUTE) {
  console.error("[!] 必须二选一: --dry-run 或 --execute");
  process.exit(1);
}

const batchArg = process.argv.indexOf("--batch");
const batchArgValue = batchArg > -1 ? process.argv[batchArg + 1] : undefined;
const BATCH_ID: string =
  typeof batchArgValue === "string" && batchArgValue.length > 0
    ? batchArgValue
    : `recurrent-${formatDate(new Date())}`;
const LOCK_MARKER = `lock:overdue_skip:${BATCH_ID}`;

if (!/^[a-zA-Z0-9_\-:.]+$/.test(BATCH_ID)) {
  console.error(`[!] batch ID 只能含字母数字和 _-:. (避免 SQL 注入)`);
  process.exit(1);
}

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter, log: ["error"] });

const BACKUP_TABLE = "Contract_fake_close_recurrent_" + formatDate(new Date());

async function main() {
  console.log(`[${DRY_RUN ? "DRY-RUN" : "EXEC"}] 复发处理开始...`);
  console.log(`[Lock 标记] ${LOCK_MARKER}`);
  console.log(`[备份表] ${BACKUP_TABLE}`);

  // 1) 找执行人 (最近一次登入的 ADMIN 角色用户)
  const operator = await prisma.user.findFirst({
    where: { role: { code: "ADMIN" }, deletedAt: null },
    orderBy: { lastLoginAt: "desc" }
  });
  if (!operator) {
    throw new Error("找不到 ADMIN 用户, 请先 seed 至少一个 admin 账号");
  }
  console.log(`[操作人] ${operator.name} (${operator.id})`);

  // 2) 找目标合同: 6/29 修过的 + 现在又被关回去的 + 仍有未结清
  const targetIds = await findRecurrentClosedIds(prisma);
  console.log(`[目标] 复发合同数: ${targetIds.length}`);

  if (targetIds.length === 0) {
    console.log("[!] 没有找到复发合同, 无需处理, 退出");
    return;
  }

  if (targetIds.length < 1 || targetIds.length > 500) {
    throw new Error(
      `目标合同数 ${targetIds.length} 超出安全阈值 1~500. 如果是 0 代表没复发, 跳过即可; 如果 >500 请人工确认是否误伤`
    );
  }

  if (DRY_RUN) {
    console.log("\n========== DRY-RUN 预览 (不会写入) ==========");
    const preview = await previewList(prisma, targetIds);
    console.table(preview.slice(0, 15));
    console.log(`... 共 ${preview.length} 条`);
    console.log(
      `应收未结合计: ${preview.reduce((s, r) => s + Number(r.unpaid), 0).toFixed(2)} 元`
    );
    console.log("\n确认无误后跑:");
    console.log(
      `  pnpm tsx scripts/migrate/contract-fake-close-recurrent-lock.ts --execute --batch ${BATCH_ID}`
    );
    return;
  }

  // 3) 实际执行 (在事务里)
  console.log("[!] 实际执行模式, 即将写入数据库, 5 秒后开始 (按 Ctrl+C 取消)...");
  await new Promise((r) => setTimeout(r, 5000));

  await prisma.$transaction(async (tx) => {
    // 3.1) 备份
    await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS ${BACKUP_TABLE};`);
    await tx.$executeRawUnsafe(
      `CREATE TABLE ${BACKUP_TABLE} AS
       SELECT id, "contractNo", status, "reviewComment", "updatedAt" AS closed_at, "updatedById" AS closed_by
       FROM "Contract"
       WHERE id = ANY($1::text[]);`,
      targetIds
    );
    console.log(`[备份] ${BACKUP_TABLE} 已创建`);

    // 3.2) 写 ContractReviewLog (审计痕迹)
    const logData = targetIds.map((cid) => ({
      id: `crrl_recurrent_${cid}_${Date.now()}`,
      contractId: cid,
      reviewerId: operator.id,
      action: "MANUAL_REOPEN",
      comment: `复发处理:从 CLOSED 恢复为 ACTIVE 并加 lock 标记 (${LOCK_MARKER}). 触发原因:cron 反复强关, 临时豁免强关等财务补录. 详见 docs/contract-fake-close-recovery.md §4.6`
    }));
    await tx.contractReviewLog.createMany({
      data: logData,
      skipDuplicates: true
    });
    console.log(`[审计] ContractReviewLog 写入 ${logData.length} 条`);

    // 3.3) CLOSED → ACTIVE + 加 lock 标记
    const updated = await tx.contract.updateMany({
      where: { id: { in: targetIds } },
      data: {
        status: "ACTIVE",
        reviewComment: LOCK_MARKER,
        updatedById: operator.id
      }
    });
    console.log(`[修改] Contract 表 UPDATE 影响行数: ${updated.count}`);

    if (updated.count !== targetIds.length) {
      throw new Error(
        `UPDATE 影响行数 (${updated.count}) 与目标合同数 (${targetIds.length}) 不一致, 回滚`
      );
    }
  });

  console.log("\n[OK] 复发处理完成, 下面是恢复后的合同清单 (前 15 条):");
  const result = await previewList(prisma, targetIds);
  console.table(result.slice(0, 15));
  console.log(`... 共 ${result.length} 条`);
  console.log(
    `应收未结合计: ${result.reduce((s, r) => s + Number(r.unpaid), 0).toFixed(2)} 元`
  );

  console.log("\n[下一步]");
  console.log("  1) 启动应用: sudo systemctl start qt-app");
  console.log("  2) 通知财务: 这批合同已加 lock 标记, 可以安心补录 Payment");
  console.log("     - 钱齐后 tryAutoClose 会正常完结 (reason=completed), lock 自动清除");
  console.log("     - 钱一直不齐: lock 会一直生效, 不再被 cron 强关");
  console.log("  3) 长期不需要 lock 的合同, 手动解锁:");
  console.log(`     psql -c "UPDATE \\"Contract\\" SET \\"reviewComment\\" = NULL WHERE \\"id\\" = '<id>'"`);
}

async function findRecurrentClosedIds(prisma: PrismaClient): Promise<string[]> {
  // 用 6/29 那次的备份表作为白名单来源 (Contract_fake_close_recovery_20260629)
  // 因为 cron 的 tryAutoCloseOnOverdue 会把 reviewComment 覆盖成 'overdue_terminated',
  // 不能直接靠 reviewComment='recovered_from_fake_close' 匹配.
  const BACKUP_20260629 = "Contract_fake_close_recovery_20260629";
  const backupExists = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = $1) AS exists`,
    BACKUP_20260629
  );
  if (!backupExists[0]?.exists) {
    throw new Error(
      `备份表 ${BACKUP_20260629} 不存在, 无法确认 6/29 那批 242 个合同的 ID. 请人工核对目标合同列表`
    );
  }

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT c.id
    FROM "Contract" c
    INNER JOIN ${Prisma.raw(BACKUP_20260629)} b ON b.id = c.id
    LEFT JOIN (
      SELECT "contractId", SUM(amount) AS paid
      FROM "Payment" p
      WHERE p.status IN ('CONFIRMED', 'RECONCILED')
        AND p."deletedAt" IS NULL
      GROUP BY "contractId"
    ) paid ON paid."contractId" = c.id
    WHERE c.status = 'CLOSED'
      AND c."deletedAt" IS NULL
      AND c."totalAmount" > COALESCE(paid.paid, 0)
  `;
  return rows.map((r) => r.id);
}

async function previewList(prisma: PrismaClient, ids: string[]) {
  return prisma.$queryRaw<
    Array<{
      contractNo: string;
      customerName: string;
      totalAmount: number;
      paid: number;
      unpaid: number;
      endDate: Date;
      reviewComment: string | null;
    }>
  >`
    SELECT
      c."contractNo" AS "contractNo",
      c."customerName" AS "customerName",
      c."totalAmount"::numeric(18,2) AS "totalAmount",
      COALESCE(paid.paid, 0)::numeric(18,2) AS paid,
      (c."totalAmount" - COALESCE(paid.paid, 0))::numeric(18,2) AS unpaid,
      c."endDate" AS "endDate",
      c."reviewComment" AS "reviewComment"
    FROM "Contract" c
    LEFT JOIN (
      SELECT "contractId", SUM(amount) AS paid
      FROM "Payment"
      WHERE status IN ('CONFIRMED', 'RECONCILED') AND "deletedAt" IS NULL
      GROUP BY "contractId"
    ) paid ON paid."contractId" = c.id
    WHERE c.id = ANY(${ids}::text[])
    ORDER BY unpaid DESC
  `;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

main()
  .catch((e) => {
    console.error("[FAIL]", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });