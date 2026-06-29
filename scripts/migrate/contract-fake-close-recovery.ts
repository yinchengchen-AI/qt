#!/usr/bin/env tsx
/**
 * 合同"假完结"数据修复 — 可执行版本 (推荐用这个, 比纯 SQL 更安全)
 *
 * 比纯 SQL 版本多做的事:
 *   1) 自动解析 DATABASE_URL, 无需 psql
 *   2) 默认走 --dry-run, 让你先看影响再决定
 *   3) 事务包裹, 任何一步失败整体回滚
 *   4) 影响行数校验 (100~300, 防误伤)
 *   5) 自动从 User 表找一个最近登录的 ADMIN 角色作为 reviewerId
 *   6) 完成后打印恢复后的合同清单 (按应收未结降序)
 *
 * 用法:
 *   pnpm tsx scripts/migrate/contract-fake-close-recovery.ts --dry-run
 *   pnpm tsx scripts/migrate/contract-fake-close-recovery.ts --execute
 *
 * 前置:
 *   1) 先备份整库: pg_dump -Fc qt_biz > /backup/qt_biz_20260629.dump
 *   2) 通知财务暂停录入回款 (执行期间)
 *   3) 暂停 cron: sudo systemctl stop qt-app (避免冲突)
 *
 * 范围: 所有 CLOSED + 已删除=否 + 未结清的合同 (242 条, 应收 269 万)
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

config();

const DRY_RUN = process.argv.includes("--dry-run");
const EXECUTE = process.argv.includes("--execute");

if (DRY_RUN === EXECUTE) {
  console.error("[!] 必须二选一: --dry-run 或 --execute");
  process.exit(1);
}

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter, log: ["error"] });

const BACKUP_TABLE = "Contract_fake_close_recovery_" + formatDate(new Date());

async function main() {
  console.log(`[${DRY_RUN ? "DRY-RUN" : "EXEC"}] 合同假完结数据修复开始...`);
  console.log(`[备份表] ${BACKUP_TABLE}`);

  // 1) 找执行人 (最近一次登入的 ADMIN 角色用户)
  //    User.roleId 是外键, 关联 Role.code='ADMIN'
  const operator = await prisma.user.findFirst({
    where: { role: { code: "ADMIN" }, deletedAt: null },
    orderBy: { lastLoginAt: "desc" },
  });
  if (!operator) {
    throw new Error("找不到 ADMIN 用户, 请先 seed 至少一个 admin 账号");
  }
  console.log(`[操作人] ${operator.name} (${operator.id})`);

  // 2) 找目标合同 ID 列表
  const targetIds = await findTargetContractIds(prisma);
  console.log(`[目标] 假完结合同数: ${targetIds.length}`);

  if (targetIds.length === 0) {
    console.log("[!] 没有找到假完结合同, 无需修复, 退出");
    return;
  }

  if (targetIds.length < 100 || targetIds.length > 300) {
    throw new Error(
      `目标合同数 ${targetIds.length} 超过安全阈值 100~300, 请人工确认是否在跑别的脚本`
    );
  }

  if (DRY_RUN) {
    console.log("\n========== DRY-RUN 预览 (不会写入) ==========");
    const preview = await previewList(prisma, targetIds);
    console.table(preview.slice(0, 10));
    console.log(`... 共 ${preview.length} 条`);
    console.log(`应收未结合计: ${preview.reduce((s, r) => s + Number(r.unpaid), 0).toFixed(2)} 元`);
    console.log("\n确认无误后跑: pnpm tsx scripts/migrate/contract-fake-close-recovery.ts --execute");
    return;
  }

  // 3) 实际执行 (在事务里)
  console.log("[!] 实际执行模式, 即将写入数据库, 5 秒后开始 (按 Ctrl+C 取消)...");
  await new Promise((r) => setTimeout(r, 5000));

  await prisma.$transaction(async (tx) => {
    // 3.1) 备份: 复制原始 CLOSED 状态到备份表
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
      id: `crrl_recover_${cid}`,
      contractId: cid,
      reviewerId: operator.id,
      action: "MANUAL_REOPEN",
      comment: `数据修复:从 CLOSED 恢复为 ACTIVE. 触发原因:cron 长期未跑, 误关合同恢复开放补录回款. 详见 docs/contract-fake-close-recovery.md`,
    }));
    await tx.contractReviewLog.createMany({
      data: logData,
      skipDuplicates: true,
    });
    console.log(`[审计] ContractReviewLog 写入 ${logData.length} 条`);

    // 3.3) CLOSED → ACTIVE
    const updated = await tx.contract.updateMany({
      where: { id: { in: targetIds } },
      data: {
        status: "ACTIVE",
        reviewComment: "recovered_from_fake_close",
        updatedById: operator.id,
      },
    });
    console.log(`[修改] Contract 表 UPDATE 影响行数: ${updated.count}`);

    if (updated.count !== targetIds.length) {
      throw new Error(
        `UPDATE 影响行数 (${updated.count}) 与目标合同数 (${targetIds.length}) 不一致, 回滚`
      );
    }
  });

  console.log("\n[OK] 修复完成, 下面是恢复后的合同清单 (前 10 条):");
  const result = await previewList(prisma, targetIds);
  console.table(result.slice(0, 10));
  console.log(`... 共 ${result.length} 条`);
  console.log(`应收未结合计: ${result.reduce((s, r) => s + Number(r.unpaid), 0).toFixed(2)} 元`);

  console.log("\n[下一步]");
  console.log("  1) 通知财务: 这 242 个合同已恢复 ACTIVE, 可以补录 Payment");
  console.log("  2) 启动应用: sudo systemctl start qt-app");
  console.log("  3) 监控: 次日 cron 跑完后, 钱齐的合同会自动完结 (reason=completed)");
  console.log("  4) 长期方案: 加 reopen 接口 + cron 监控告警 (见 docs/contract-fake-close-recovery.md)");
}

async function findTargetContractIds(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT c.id
    FROM "Contract" c
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
    }>
  >`
    SELECT
      c."contractNo" AS "contractNo",
      c."customerName" AS "customerName",
      c."totalAmount"::numeric(18,2) AS "totalAmount",
      COALESCE(paid.paid, 0)::numeric(18,2) AS paid,
      (c."totalAmount" - COALESCE(paid.paid, 0))::numeric(18,2) AS unpaid,
      c."endDate" AS "endDate"
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