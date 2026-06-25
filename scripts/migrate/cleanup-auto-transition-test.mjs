#!/usr/bin/env node
/**
 * 清掉 2030-01-01 端到端验证留下的开发库副作用.
 *
 * 清理对象 (按 test run 时系统自动 actor 标识):
 *   1) Contract.status = 'EXPIRED' 但 endDate > today (2026-06-22):
 *      真过期合同 endDate < today. fake-now=2030 才会把未来 endDate 的合同置 EXPIRED.
 *      复原策略: 优先从 OperationLog(diff.before.status) 取原始状态;
 *               缺失则按 endDate 距 2030 的远近启发式回退 EXECUTING / EFFECTIVE.
 *   2) ContractReviewLog action IN ('AUTO_EXECUTE','AUTO_COMPLETE','AUTO_EXPIRE')
 *      且 reviewerId = 'system' (只有自动转换会写系统 reviewer)
 *   3) OperationLog action IN ('CONTRACT_AUTO_EXECUTE','CONTRACT_AUTO_COMPLETE','CONTRACT_AUTO_EXPIRE')
 *      且 actorId = 'system'
 *   4) Message type IN ('CONTRACT_AUTO_EXECUTED','CONTRACT_AUTO_COMPLETED','CONTRACT_AUTO_EXPIRED'):
 *      这三类消息类型是新增的, 唯一来源是自动转换, 全删
 *   5) Message type IN ('INVOICE_OVERDUE_PAYMENT','PAYMENT_RECEIVED','CUSTOMER_STATUS_SUGGEST','CONTRACT_AUTO_EXECUTED','CONTRACT_AUTO_COMPLETED','CONTRACT_AUTO_EXPIRED','CONTRACT_EXPIRING'):
 *      按 createdAt 落在 test window (OperationLog 系统条目的最早/最晚时间) 内的删,
 *      这些是 runAllJobs 在 fake-now=2030 下扫出来的假数据
 *
 * 用法:
 *   node scripts/migrate/cleanup-auto-transition-test.mjs --dry-run   # 报告, 不动
 *   node scripts/migrate/cleanup-auto-transition-test.mjs --apply      # 实际清
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

config();

const REPORT_DIR = path.resolve("ops/legacy/reports");
mkdirSync(REPORT_DIR, { recursive: true });

const APPLY = process.argv.includes("--apply");
const TODAY = new Date("2026-06-22T00:00:00Z");

const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter, log: ["error"] });

function log(...args) { console.log(...args); }
function warn(...args) { console.warn(...args); }

const report = {
  generatedAt: new Date().toISOString(),
  mode: APPLY ? "APPLY" : "DRY-RUN",
  today: TODAY.toISOString(),
  actions: []
};

function record(action, target, count, sample) {
  report.actions.push({ action, target, count, sample });
}

async function detectTestWindow() {
  const sysLogs = await prisma.operationLog.findMany({
    where: { actorId: "system" },
    select: { at: true },
    orderBy: { at: "asc" }
  });
  if (sysLogs.length === 0) return null;
  return { from: sysLogs[0].at, to: sysLogs[sysLogs.length - 1].at, count: sysLogs.length };
}

async function plan() {
  // 1) 假过期合同
  const fakeExpired = await prisma.contract.findMany({
    where: { status: "EXPIRED", endDate: { gte: TODAY }, deletedAt: null },
    select: { id: true, contractNo: true, status: true, endDate: true, updatedAt: true }
  });
  const ids = fakeExpired.map(c => c.id);
  const restoreLogs = ids.length
    ? await prisma.operationLog.findMany({
        where: {
          actorId: "system",
          action: "CONTRACT_AUTO_EXPIRE",
          entity: "Contract",
          entityId: { in: ids }
        },
        select: { entityId: true, diff: true, at: true },
        orderBy: { at: "desc" }
      })
    : [];
  const latestByContract = new Map();
  for (const r of restoreLogs) {
    if (!latestByContract.has(r.entityId)) latestByContract.set(r.entityId, r);
  }
  const restorePlan = fakeExpired.map(c => {
    const lg = latestByContract.get(c.id);
    let from = null;
    if (lg?.diff && typeof lg.diff === "object") {
      const d = lg.diff;
      from = d.before?.status ?? d.before?.data?.status ?? null;
    }
    if (!from) from = c.endDate && c.endDate < new Date("2027-01-01") ? "EXECUTING" : "EFFECTIVE";
    return { id: c.id, contractNo: c.contractNo, endDate: c.endDate, currentStatus: c.status, restoreTo: from, hasLog: !!lg };
  });
  record("restore_contracts", "Contract.status", restorePlan.length, restorePlan.slice(0, 3));

  // 2) ContractReviewLog 系统条目
  const reviewLogs = await prisma.contractReviewLog.findMany({
    where: { reviewerId: "system", action: { in: ["AUTO_EXECUTE", "AUTO_COMPLETE", "AUTO_EXPIRE"] } },
    select: { id: true, contractId: true, action: true, at: true }
  });
  record("delete_contract_review_log", "ContractReviewLog", reviewLogs.length, reviewLogs.slice(0, 3));

  // 3) OperationLog 系统条目
  const opLogs = await prisma.operationLog.findMany({
    where: { actorId: "system", action: { in: ["CONTRACT_AUTO_EXECUTE", "CONTRACT_AUTO_COMPLETE", "CONTRACT_AUTO_EXPIRE"] } },
    select: { id: true, action: true, entity: true, entityId: true, at: true }
  });
  record("delete_operation_log", "OperationLog", opLogs.length, opLogs.slice(0, 3));

  // 4) 三类新消息
  const newTypeMsgs = await prisma.message.findMany({
    where: { type: { in: ["CONTRACT_AUTO_EXECUTED", "CONTRACT_AUTO_COMPLETED", "CONTRACT_AUTO_EXPIRED"] } },
    select: { id: true, type: true, receiverUserId: true, createdAt: true }
  });
  record("delete_new_type_messages", "Message (new types)", newTypeMsgs.length, newTypeMsgs.slice(0, 3));

  // 5) 老类型消息按 test window 过滤
  const window = await detectTestWindow();
  let oldTypeMsgs = [];
  if (window) {
    oldTypeMsgs = await prisma.message.findMany({
      where: {
        type: { in: ["INVOICE_OVERDUE_PAYMENT", "PAYMENT_RECEIVED", "CUSTOMER_STATUS_SUGGEST", "CONTRACT_AUTO_EXECUTED", "CONTRACT_AUTO_COMPLETED", "CONTRACT_AUTO_EXPIRED", "CONTRACT_EXPIRING"] },
        createdAt: { gte: window.from, lte: window.to }
      },
      select: { id: true, type: true, receiverUserId: true, createdAt: true }
    });
  } else {
    warn("[warn] 没找到 system actor 的 OperationLog, 跳过老类型消息清理 (test window 未知)");
  }
  record("delete_old_type_messages_in_test_window", "Message (old types in test window)", oldTypeMsgs.length, oldTypeMsgs.slice(0, 3));

  return { restorePlan, reviewLogs, opLogs, newTypeMsgs, oldTypeMsgs, window };
}

async function apply(planResult) {
  const { restorePlan, reviewLogs, opLogs, newTypeMsgs, oldTypeMsgs } = planResult;
  const result = { contractsRestored: 0, reviewLogsDeleted: 0, opLogsDeleted: 0, newTypeMsgsDeleted: 0, oldTypeMsgsDeleted: 0 };

  await prisma.$transaction(async (tx) => {
    for (const c of restorePlan) {
      await tx.contract.update({ where: { id: c.id }, data: { status: c.restoreTo } });
      result.contractsRestored++;
    }
    if (reviewLogs.length) {
      const r = await tx.contractReviewLog.deleteMany({ where: { id: { in: reviewLogs.map(x => x.id) } } });
      result.reviewLogsDeleted = r.count;
    }
    if (opLogs.length) {
      const r = await tx.operationLog.deleteMany({ where: { id: { in: opLogs.map(x => x.id) } } });
      result.opLogsDeleted = r.count;
    }
    if (newTypeMsgs.length) {
      const r = await tx.message.deleteMany({ where: { id: { in: newTypeMsgs.map(x => x.id) } } });
      result.newTypeMsgsDeleted = r.count;
    }
    if (oldTypeMsgs.length) {
      const r = await tx.message.deleteMany({ where: { id: { in: oldTypeMsgs.map(x => x.id) } } });
      result.oldTypeMsgsDeleted = r.count;
    }
  });

  return result;
}

async function main() {
  log("=== cleanup-auto-transition-test ===");
  log("mode:", APPLY ? "APPLY" : "DRY-RUN");
  log("today:", TODAY.toISOString().slice(0, 10));
  log("");

  const planResult = await plan();

  if (planResult.window) {
    log("test window (from system actor OperationLog cluster):");
    log("  from:", planResult.window.from.toISOString());
    log("  to:  ", planResult.window.to.toISOString());
    log("  count:", planResult.window.count);
    log("");
  }

  log("== cleanup plan ==");
  for (const a of report.actions) {
    log(`  [${a.target}] ${a.action}: ${a.count} rows`);
    if (a.sample?.length) {
      for (const s of a.sample) log("    sample:", JSON.stringify(s));
    }
  }
  log("");

  if (!APPLY) {
    log("[dry-run] 没改任何数据. 加 --apply 实际执行.");
  } else {
    log("[apply] 开始事务清理...");
    const r = await apply(planResult);
    log("[apply] 完成:");
    log("  contracts restored:", r.contractsRestored);
    log("  ContractReviewLog deleted:", r.reviewLogsDeleted);
    log("  OperationLog deleted:", r.opLogsDeleted);
    log("  new-type Message deleted:", r.newTypeMsgsDeleted);
    log("  old-type Message deleted (in test window):", r.oldTypeMsgsDeleted);
  }

  report.planResult = {
    restorePlanSample: planResult.restorePlan.slice(0, 5),
    restorePlanTotal: planResult.restorePlan.length,
    reviewLogsTotal: planResult.reviewLogs.length,
    opLogsTotal: planResult.opLogs.length,
    newTypeMsgsTotal: planResult.newTypeMsgs.length,
    oldTypeMsgsTotal: planResult.oldTypeMsgs.length,
    window: planResult.window ? { from: planResult.window.from.toISOString(), to: planResult.window.to.toISOString(), count: planResult.window.count } : null
  };
  const reportPath = path.join(REPORT_DIR, `cleanup-auto-transition-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  log("");
  log("report:", reportPath);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
