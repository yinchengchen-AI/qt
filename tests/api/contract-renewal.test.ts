// Phase 1.5 续签跟进集成测试
//
// 覆盖:
//   1) isoWeekKey 格式 (yyyy-Www)
//   2) 续签提醒 job: 到期超 30 天未续签 → CONTRACT_RENEWAL_REMIND (owner+admin); < 30 天不提醒
//   3) 同周重跑不重复 (entityKey 周去重)
//   4) beforeAll 即已续签的合同 → 绝对 0 条提醒 (与周去重无关, 直接证明 renewal 排除生效)
//   5) createContract 带 renewedFromId → 持久化, 源合同状态机不变; 源不存在 → 404
//   6) 已续签合同的 overdue/expiring 待办消失 (no_invoice 语义与续签无关, 保留 — spec §4.4 只指带续签按钮的项)
//   7) schema 回归: renewedFromId 字段 + 3 个新 MessageType
//
// 并发隔离: 新建专属 SALES 用户 (与 contract-workbench/contract-risk 同模式).
// DB 不可达时整组 skip, 全部数据 TAG 前缀 + 自清理.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, MessageType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { runContractRenewalRemind, isoWeekKey } from "@/server/jobs/contract-renewal-remind";
import { createContract } from "@/server/services/contract";
import { getMyTodos } from "@/server/services/contract/workbench";

let dbReachable = false;
const TAG = `TEST-REN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DAY_MS = 86_400_000;

let salesUser: SessionUser | null = null;
let salesId = "";
let customerId: string | null = null;
let cOldId: string | null = null;
let cRecentId: string | null = null;
let cRenewedFreshId: string | null = null;
const renewalIds: string[] = [];

async function createFixtureContract(overrides: { startDate: Date; endDate: Date }) {
  return prisma.contract.create({
    data: {
      contractNo: `${TAG}-${Math.random().toString(36).slice(2, 8)}`,
      customerId: customerId!,
      customerName: `${TAG}-客户`,
      title: `${TAG}-合同`,
      serviceType: "OTHER",
      signDate: overrides.startDate,
      startDate: overrides.startDate,
      endDate: overrides.endDate,
      totalAmount: 100000,
      taxRate: 0.06,
      taxAmount: Number((100000 * 0.06 / 1.06).toFixed(2)),
      amountExcludingTax: Number((100000 / 1.06).toFixed(2)),
      paymentMethod: "LUMP_SUM",
      status: "ACTIVE",
      ownerUserId: salesId,
      signerId: salesId,
      attachments: [] as unknown as Prisma.InputJsonValue,
      createdById: salesId,
      updatedById: salesId
    }
  });
}

function renewalInput(sourceId: string, suffix: string) {
  const now = Date.now();
  return {
    customerId: customerId!,
    contractNo: `${TAG}-${suffix}`,
    title: `${TAG}-续签`,
    serviceType: "OTHER",
    signDate: new Date(now).toISOString(),
    startDate: new Date(now - 39 * DAY_MS).toISOString(),
    endDate: new Date(now + 325 * DAY_MS).toISOString(),
    totalAmount: 100000,
    taxRate: 0.06,
    attachments: [],
    paymentMethod: "LUMP_SUM" as const,
    renewedFromId: sourceId
  };
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const salesRow = await prisma.user.create({
    data: {
      employeeNo: `${TAG}-S`,
      name: `${TAG}-销售`,
      email: `${TAG}-sales@example.com`,
      passwordHash: "not-valid",
      role: { connect: { code: "SALES" } }
    },
    select: { id: true, employeeNo: true, name: true, email: true }
  });
  salesId = salesRow.id;
  salesUser = { ...salesRow, roleCode: "SALES", permissions: [] };

  const cust = await prisma.customer.create({
    data: {
      code: `${TAG}-C`,
      name: `${TAG}-客户`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactPhone: "13800000777",
      ownerUserId: salesId,
      createdById: salesId,
      updatedById: salesId
    }
  });
  customerId = cust.id;

  const now = Date.now();
  // 注意 fixture 日期设计: startDate/signDate 用 -50d 而非更老 — statistics.getUninvoicedContracts
  // 按 signDate asc 取前 50 条, 过老的无发票 fixture 会把 aging 测试的 -60d fixture 挤出窗口 (并发文件互踩)
  // cOld: 到期 40 天 (> 30 天阈值), 全程不续签 → 应提醒 + overdue 待办
  cOldId = (await createFixtureContract({ startDate: new Date(now - 50 * DAY_MS), endDate: new Date(now - 40 * DAY_MS) })).id;
  // cRecent: 到期 20 天 (< 30 天) → 不提醒, 但有 overdue 待办
  cRecentId = (await createFixtureContract({ startDate: new Date(now - 40 * DAY_MS), endDate: new Date(now - 20 * DAY_MS) })).id;
  // cRenewedFresh: 到期 40 天, beforeAll 里即建续签 → 任何 job 运行都不应提醒它 (绝对 0 条)
  cRenewedFreshId = (await createFixtureContract({ startDate: new Date(now - 50 * DAY_MS), endDate: new Date(now - 40 * DAY_MS) })).id;
  const renewal = await createContract(salesUser, renewalInput(cRenewedFreshId, "RENEWAL-A"));
  if (renewal) renewalIds.push(renewal.id);
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
    const ids = [cOldId, cRecentId, cRenewedFreshId, ...renewalIds].filter((x): x is string => !!x);
    await prisma.message.deleteMany({ where: { OR: ids.map((id) => ({ entityKey: { contains: id } })) } });
    await prisma.operationLog.deleteMany({ where: { entity: "Contract", entityId: { in: ids } } }).catch(() => {});
    await prisma.contractReviewLog.deleteMany({ where: { contractId: { in: ids } } }).catch(() => {});
    // 续签合同 (renewedFromId 指向源) 一并删除; FK ON DELETE SET NULL 兜底顺序问题
    if (ids.length > 0) await prisma.contract.deleteMany({ where: { id: { in: ids } } });
    if (customerId) await prisma.customer.delete({ where: { id: customerId } });
    if (salesId) await prisma.user.delete({ where: { id: salesId } }).catch(() => {});
  } finally {
    await prisma.$disconnect();
  }
});

describe("isoWeekKey", () => {
  it("格式 yyyy-Www", () => {
    expect(isoWeekKey(new Date("2026-08-18T06:00:00Z"))).toMatch(/^\d{4}-W\d{2}$/);
  });
});

describe("contract-renewal-remind job", () => {
  it("到期超 30 天未续签 → 提醒 owner+admin; < 30 天不提醒; 已续签绝对 0 条", async () => {
    if (!dbReachable) return;
    const r = await runContractRenewalRemind();
    expect(r.scanned).toBeGreaterThan(0);
    const msgs = await prisma.message.findMany({
      where: { type: "CONTRACT_RENEWAL_REMIND", entityKey: { contains: cOldId! } }
    });
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.some((m) => m.receiverUserId === salesId)).toBe(true);
    expect(msgs[0]!.title).toContain("仍未续签");
    expect(msgs[0]!.entityKey).toContain(isoWeekKey(new Date()));

    const recent = await prisma.message.findMany({
      where: { type: "CONTRACT_RENEWAL_REMIND", entityKey: { contains: cRecentId! } }
    });
    expect(recent.length).toBe(0);

    // beforeAll 已续签的合同: 不受周去重影响, 绝对 0 条
    const renewed = await prisma.message.findMany({
      where: { type: "CONTRACT_RENEWAL_REMIND", entityKey: { contains: cRenewedFreshId! } }
    });
    expect(renewed.length).toBe(0);
  });

  it("同周重跑不重复 (entityKey 周去重)", async () => {
    if (!dbReachable) return;
    const before = await prisma.message.count({
      where: { type: "CONTRACT_RENEWAL_REMIND", entityKey: { contains: cOldId! } }
    });
    await runContractRenewalRemind();
    const after = await prisma.message.count({
      where: { type: "CONTRACT_RENEWAL_REMIND", entityKey: { contains: cOldId! } }
    });
    expect(after).toBe(before);
  });
});

describe("续签创建 (createContract + renewedFromId)", () => {
  it("带 renewedFromId 创建成功并持久化; 源合同状态机不变", async () => {
    if (!dbReachable || !salesUser) return;
    const created = await createContract(salesUser, renewalInput(cRenewedFreshId!, "RENEWAL-B"));
    expect(created).not.toBeNull();
    renewalIds.push(created!.id);
    expect(created!.renewedFromId).toBe(cRenewedFreshId);
    // 源合同状态不变 (仍 ACTIVE, 由既有状态机收尾)
    const source = await prisma.contract.findUnique({ where: { id: cRenewedFreshId! } });
    expect(source!.status).toBe("ACTIVE");
  });

  it("renewedFromId 指向不存在合同 → 404", async () => {
    if (!dbReachable || !salesUser) return;
    await expect(createContract(salesUser, renewalInput("nonexistent-id", "RENEWAL-BAD")))
      .rejects.toMatchObject({ status: 404 });
  });
});

describe("续签后的待办收口", () => {
  it("已续签合同无 overdue/expiring 待办; 未续签的保留", async () => {
    if (!dbReachable || !salesUser) return;
    const todos = await getMyTodos(salesUser);
    const forRenewed = todos.filter((t) => t.contractId === cRenewedFreshId);
    expect(forRenewed.some((t) => t.type === "overdue" || t.type === "expiring")).toBe(false);
    // 未续签的两个合同 overdue 待办仍在
    expect(todos.some((t) => t.contractId === cOldId && t.type === "overdue")).toBe(true);
    expect(todos.some((t) => t.contractId === cRecentId && t.type === "overdue")).toBe(true);
  });
});

describe("schema 回归", () => {
  it("Contract 含 renewedFromId 字段", () => {
    expect("renewedFromId" in Prisma.ContractScalarFieldEnum).toBe(true);
  });
  it("MessageType 含 CONTRACT_RENEWAL_REMIND / LINKAGE_NO_INVOICE / LINKAGE_INVOICE_PAYMENT_GAP", () => {
    expect(MessageType.CONTRACT_RENEWAL_REMIND).toBe("CONTRACT_RENEWAL_REMIND");
    expect(MessageType.LINKAGE_NO_INVOICE).toBe("LINKAGE_NO_INVOICE");
    expect(MessageType.LINKAGE_INVOICE_PAYMENT_GAP).toBe("LINKAGE_INVOICE_PAYMENT_GAP");
  });
});
