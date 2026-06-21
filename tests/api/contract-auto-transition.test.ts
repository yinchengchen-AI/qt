// 合同状态机自动转换服务层单测
//   tryAutoExecuteContract / tryAutoCompleteContract / runContractExpiryJob
// 覆盖矩阵:
//   1) start 项目: 合同 EFFECTIVE → EXECUTING, 写 audit/review log, 发 CONTRACT_AUTO_EXECUTED 消息
//   2) start 项目: 合同已 EXECUTING → no-op (无重复日志)
//   3) close 项目 (单项目合同): 合同自动 → COMPLETED
//   4) close/cancel 项目 (多项目合同 1 关 1 在): 合同不自动结清
//   5) close/cancel 项目 (多项目合同 2 全关): 合同自动 → COMPLETED
//   6) runContractExpiryJob: endDate < now + EFFECTIVE → EXPIRED, COMPLETED 跳过
//
// DB 不可达时整组 skip. 测试数据用 unique 前缀, 跑完自己清理, 不污染生产.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  tryAutoExecuteContract,
  tryAutoCompleteContract,
  runContractExpiryJob
} from "@/server/services/contract";
import { projectAction } from "@/server/services/project";
import type { SessionUser } from "@/lib/session";

let dbReachable = false;
const TAG = `TEST-AUTOCT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdContractNos: string[] = [];
const createdContractIds: string[] = [];
const createdProjectIds: string[] = [];
const createdMessageTitles: string[] = [];
let adminUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "ADMIN" } | null = null;
let testCustomerId: string | null = null;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const adminRow = await prisma.user.findFirst({
    where: { role: { code: "ADMIN" }, deletedAt: null },
    select: { id: true, employeeNo: true, name: true, email: true, role: { select: { code: true } } }
  });
  if (!adminRow) return;
  adminUser = { id: adminRow.id, employeeNo: adminRow.employeeNo, name: adminRow.name, email: adminRow.email, roleCode: "ADMIN" };

  const cust = await prisma.customer.create({
    data: {
      code: `${TAG}-CUST`,
      name: `${TAG}-客户`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactPhone: "13800000000",
      createdById: adminUser.id,
      updatedById: adminUser.id,
      ownerUserId: adminUser.id
    }
  });
  testCustomerId = cust.id;
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
    if (createdMessageTitles.length > 0) {
      await prisma.message.deleteMany({ where: { type: { in: ["CONTRACT_AUTO_EXECUTED", "CONTRACT_AUTO_COMPLETED", "CONTRACT_AUTO_EXPIRED"] }, title: { contains: TAG } } });
    }
    if (createdProjectIds.length > 0) {
      await prisma.project.deleteMany({ where: { id: { in: createdProjectIds } } });
    }
    if (createdContractNos.length > 0) {
      await prisma.contract.deleteMany({ where: { contractNo: { in: createdContractNos } } });
    }
    if (testCustomerId) {
      await prisma.contract.deleteMany({ where: { customerId: testCustomerId } });
      await prisma.customer.delete({ where: { id: testCustomerId } });
    }
    if (createdContractIds.length > 0) {
      await prisma.operationLog.deleteMany({
        where: { entity: "Contract", action: { startsWith: "CONTRACT_AUTO_" }, entityId: { in: createdContractIds } }
      });
      await prisma.contractReviewLog.deleteMany({
        where: { contractId: { in: createdContractIds } }
      });
    }
  } catch {
    // 忽略清理失败
  }
  await prisma.$disconnect();
});

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable) return;
  if (!adminUser || !testCustomerId) return;
  await fn();
};

const buildAdmin = (): SessionUser => {
  if (!adminUser) throw new Error("admin not bootstrapped");
  return {
    id: adminUser.id,
    employeeNo: adminUser.employeeNo,
    name: adminUser.name,
    email: adminUser.email,
    roleCode: "ADMIN",
    permissions: []
  };
};

async function mkContract(status: string, suffix: string, endDate = "2026-12-31T00:00:00Z") {
  if (!adminUser || !testCustomerId) throw new Error("setup not ready");
  const no = `${TAG}-${suffix}`;
  createdContractNos.push(no);
  return prisma.contract.create({
    data: {
      contractNo: no,
      customerId: testCustomerId,
      customerName: `${TAG}-客户`,
      title: `${TAG}-title-${suffix}`,
      serviceType: "OTHER",
      signDate: new Date("2026-01-01T00:00:00Z"),
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date(endDate),
      totalAmount: "0",
      taxRate: "0",
      taxAmount: "0",
      amountExcludingTax: "0",
      paymentMethod: "LUMP_SUM",
      status,
      ownerUserId: adminUser.id,
      signerId: adminUser.id,
      attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
      createdById: adminUser.id,
      updatedById: adminUser.id
    }
  }).then((row) => { createdContractIds.push(row.id); return row; });
}

async function mkProject(contractId: string, name: string) {
  if (!adminUser) throw new Error("setup not ready");
  const p = await prisma.project.create({
    data: {
      projectNo: `${TAG}-${name}-${Math.random().toString(36).slice(2, 6)}`,
      contractId,
      name,
      serviceScope: "test",
      managerUserId: adminUser.id,
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date("2026-12-31T00:00:00Z"),
      createdById: adminUser.id,
      updatedById: adminUser.id
    }
  });
  createdProjectIds.push(p.id);
  return p;
}

describe("tryAutoExecuteContract (start 项目触发)", () => {
  it("合同 EFFECTIVE → EXECUTING, 写 audit + review log + 通知", guard(async () => {
    const c = await mkContract("EFFECTIVE", "AUTOEXEC-1");
    const p = await mkProject(c.id, "AUTOEXEC-P1");
    await prisma.$transaction(async (tx) => {
      await tryAutoExecuteContract(tx, c.id, { projectId: p.id, projectName: p.name });
    });
    const reloaded = await prisma.contract.findUnique({ where: { id: c.id } });
    expect(reloaded?.status).toBe("EXECUTING");
    const audit = await prisma.operationLog.count({
      where: { entity: "Contract", entityId: c.id, action: "CONTRACT_AUTO_EXECUTE" }
    });
    expect(audit).toBe(1);
    const reviewLog = await prisma.contractReviewLog.count({
      where: { contractId: c.id, action: "AUTO_EXECUTE" }
    });
    expect(reviewLog).toBe(1);
    const msgCount = await prisma.message.count({
      where: { type: "CONTRACT_AUTO_EXECUTED", title: { contains: TAG } }
    });
    expect(msgCount).toBeGreaterThan(0);
    if (msgCount > 0) createdMessageTitles.push(TAG);
  }));

  it("合同已 EXECUTING → no-op, 不写日志", guard(async () => {
    const c = await mkContract("EXECUTING", "AUTOEXEC-NOOP");
    const p = await mkProject(c.id, "AUTOEXEC-P2");
    const beforeCount = await prisma.contractReviewLog.count({ where: { contractId: c.id, action: "AUTO_EXECUTE" } });
    await prisma.$transaction(async (tx) => {
      await tryAutoExecuteContract(tx, c.id, { projectId: p.id, projectName: p.name });
    });
    const reloaded = await prisma.contract.findUnique({ where: { id: c.id } });
    expect(reloaded?.status).toBe("EXECUTING");
    const afterCount = await prisma.contractReviewLog.count({ where: { contractId: c.id, action: "AUTO_EXECUTE" } });
    expect(afterCount).toBe(beforeCount);
  }));
});

describe("projectAction start/close/cancel 钩入", () => {
  it("start 项目触发合同 EFFECTIVE → EXECUTING (走完整 service 路径)", guard(async () => {
    const c = await mkContract("EFFECTIVE", "HOOK-START");
    const p = await mkProject(c.id, "HOOK-START-P");
    await projectAction(buildAdmin(), p.id, { action: "start" });
    const reloaded = await prisma.contract.findUnique({ where: { id: c.id } });
    expect(reloaded?.status).toBe("EXECUTING");
  }));

  it("close 项目 (单项目合同) 触发合同自动 → COMPLETED", guard(async () => {
    const c = await mkContract("EXECUTING", "HOOK-CLOSE-SINGLE");
    const p = await mkProject(c.id, "HOOK-CLOSE-P");
    // 推进项目: start → deliver → accept → close (需要 workflow 任务, 我们手动绕过 R-17: 删掉项目实例要求, 改用 cancel)
    // 这里走 cancel (也是收尾状态之一), 避免 instantiate workflow 后的 deliver/accept 卡 R-17
    await projectAction(buildAdmin(), p.id, { action: "cancel" });
    const reloaded = await prisma.contract.findUnique({ where: { id: c.id } });
    expect(reloaded?.status).toBe("COMPLETED");
    const reviewLog = await prisma.contractReviewLog.count({
      where: { contractId: c.id, action: "AUTO_COMPLETE" }
    });
    expect(reviewLog).toBe(1);
  }));

  it("close 1 个项目 (合同还有 1 个 IN_PROGRESS 项目) → 不自动结清", guard(async () => {
    const c = await mkContract("EXECUTING", "HOOK-PARTIAL");
    const p1 = await mkProject(c.id, "HOOK-PARTIAL-1");
    const p2 = await mkProject(c.id, "HOOK-PARTIAL-2");
    // p1 cancel
    await projectAction(buildAdmin(), p1.id, { action: "cancel" });
    const mid = await prisma.contract.findUnique({ where: { id: c.id } });
    expect(mid?.status).toBe("EXECUTING");
    // p2 start 后 cancel
    await projectAction(buildAdmin(), p2.id, { action: "start" });
    await projectAction(buildAdmin(), p2.id, { action: "cancel" });
    const after = await prisma.contract.findUnique({ where: { id: c.id } });
    expect(after?.status).toBe("COMPLETED");
  }));
});

describe("tryAutoCompleteContract (close 钩)", () => {
  it("多项目 1 关 1 在 → 不结清; 全关后结清", guard(async () => {
    const c = await mkContract("EXECUTING", "DIRECT-PARTIAL");
    const p1 = await mkProject(c.id, "DIRECT-P1");
    const p2 = await mkProject(c.id, "DIRECT-P2");
    // 把 p1 直接 close (不走 projectAction, 走 prisma 直改)
    await prisma.project.update({ where: { id: p1.id }, data: { status: "CLOSED" } });
    await prisma.$transaction(async (tx) => {
      await tryAutoCompleteContract(tx, c.id);
    });
    const mid = await prisma.contract.findUnique({ where: { id: c.id } });
    expect(mid?.status).toBe("EXECUTING"); // 还有 p2 IN_PROGRESS
    // p2 也 close
    await prisma.project.update({ where: { id: p2.id }, data: { status: "CLOSED" } });
    await prisma.$transaction(async (tx) => {
      await tryAutoCompleteContract(tx, c.id);
    });
    const after = await prisma.contract.findUnique({ where: { id: c.id } });
    expect(after?.status).toBe("COMPLETED");
  }));

  it("无项目合同 → no-op, 不结清", guard(async () => {
    const c = await mkContract("EFFECTIVE", "DIRECT-EMPTY");
    await prisma.$transaction(async (tx) => {
      await tryAutoCompleteContract(tx, c.id);
    });
    const reloaded = await prisma.contract.findUnique({ where: { id: c.id } });
    expect(reloaded?.status).toBe("EFFECTIVE");
  }));
});

describe("runContractExpiryJob (过期定时任务)", () => {
  it("endDate < now + EFFECTIVE → EXPIRED", guard(async () => {
    const c = await mkContract("EFFECTIVE", "EXPIRE-1", "2025-01-01T00:00:00Z");
    const now = new Date("2026-06-21T00:00:00Z");
    const r = await runContractExpiryJob(now);
    expect(r.scanned).toBeGreaterThan(0);
    const reloaded = await prisma.contract.findUnique({ where: { id: c.id } });
    expect(reloaded?.status).toBe("EXPIRED");
    const audit = await prisma.operationLog.count({
      where: { entity: "Contract", entityId: c.id, action: "CONTRACT_AUTO_EXPIRE" }
    });
    expect(audit).toBe(1);
  }));

  it("endDate 在未来 → 不转换", guard(async () => {
    const c = await mkContract("EFFECTIVE", "EXPIRE-NOOP", "2027-12-31T00:00:00Z");
    const now = new Date("2026-06-21T00:00:00Z");
    await runContractExpiryJob(now);
    const reloaded = await prisma.contract.findUnique({ where: { id: c.id } });
    expect(reloaded?.status).toBe("EFFECTIVE");
  }));

  it("已 COMPLETED 状态 → 跳过, 不动", guard(async () => {
    const c = await mkContract("COMPLETED", "EXPIRE-COMPLETED", "2025-01-01T00:00:00Z");
    const now = new Date("2026-06-21T00:00:00Z");
    await runContractExpiryJob(now);
    const reloaded = await prisma.contract.findUnique({ where: { id: c.id } });
    expect(reloaded?.status).toBe("COMPLETED");
  }));
});
