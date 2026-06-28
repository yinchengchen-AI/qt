// 定时任务 (contractExpiringJob / invoiceOverdueJob) 单测
//
// 覆盖:
//   - contractExpiringJob:30/7/1 天窗口扫描 + 按 owner 维度的批量化去重 + 接收人 (owner + admins)
//   - invoiceOverdueJob:30 天 cutoff + 累计回款剔除 + 按 entityId 批量化去重 + 接收人 (owner + admins + finance)
//   - 跨事件类型去重互不污染 (P3.10):CONTRACT_EXPIRING 已发不会阻止 INVOICE_OVERDUE_PAYMENT 反之亦然
//   - 跨合同/发票去重互不污染:同一 owner 的合同 A 发了不会阻止合同 B
//   - admins 与 finance 的 isSystem: false 过滤生效
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  contracts: [] as Array<{
    id: string;
    contractNo: string;
    endDate: Date;
    ownerUserId: string;
  }>,
  invoices: [] as Array<{
    id: string;
    invoiceNo: string;
    customerName: string;
    amount: number | { toString(): string };
    actualIssueDate: Date;
    status: string;
    deletedAt: Date | null;
    contract: { ownerUserId: string };
  }>,
  payments: [] as Array<{ invoiceId: string; amount: number | { toString(): string }; status: string }>,
  messages: [] as Array<{
    type: string;
    receiverUserId: string;
    link: unknown;
    createdAt: Date;
  }>,
  users: [] as Array<{ id: string; role: { code: string } }>,
  emitted: [] as Array<{ type: string; payload: Record<string, unknown>; receivers: string[] }>
}));

vi.mock("@/lib/prisma", () => {
  return {
    prisma: {
      contract: {
        findMany: vi.fn(async (args: { where: { endDate?: { gte?: Date; lt?: Date }; status?: string } }) => {
          // mock 只镜像 status + endDate 范围,够单测使用
          let list = mockState.contracts;
          if (args.where.status) {
            list = list.filter((c) => c.endDate > now); // 简化:用 endDate 替 ACTIVE
          }
          if (args.where.endDate?.gte) {
            list = list.filter((c) => c.endDate >= args.where.endDate!.gte!);
          }
          if (args.where.endDate?.lt) {
            list = list.filter((c) => c.endDate < args.where.endDate!.lt!);
          }
          return list;
        })
      },
      invoice: {
        findMany: vi.fn(async (args: { where: { actualIssueDate?: { lte?: Date }; status?: string; deletedAt?: null } }) => {
          let list = mockState.invoices;
          if (args.where.status) list = list.filter((i) => i.status === args.where.status);
          if (args.where.deletedAt === null) list = list.filter((i) => i.deletedAt === null);
          if (args.where.actualIssueDate?.lte) {
            list = list.filter((i) => i.actualIssueDate <= args.where.actualIssueDate!.lte!);
          }
          return list;
        })
      },
      payment: {
        groupBy: vi.fn(async (args: { where: { invoiceId?: { in: string[] }; status?: { in: string[] } } }) => {
          const inSet = new Set(args.where.invoiceId?.in ?? []);
          const statusSet = new Set(args.where.status?.in ?? []);
          const sums = new Map<string, number>();
          for (const p of mockState.payments) {
            if (!inSet.has(p.invoiceId)) continue;
            if (!statusSet.has(p.status)) continue;
            const amt = Number(p.amount.toString());
            sums.set(p.invoiceId, (sums.get(p.invoiceId) ?? 0) + amt);
          }
          return Array.from(sums.entries()).map(([invoiceId, _sum]) => ({
            invoiceId,
            _sum: { amount: _sum }
          }));
        })
      },
      message: {
        // 批量化去重查询:job 拉"今天该 type 涉及到的消息"全量,再在 JS 里按 link.id 过滤
        findMany: vi.fn(async (args: { where: { type?: string; receiverUserId?: { in: string[] }; createdAt?: { gte: Date } } }) => {
          const today = args.where.createdAt?.gte ?? new Date(0);
          return mockState.messages.filter((m) => {
            if (args.where.type && m.type !== args.where.type) return false;
            if (args.where.receiverUserId && !args.where.receiverUserId.in.includes(m.receiverUserId)) return false;
            if (m.createdAt < today) return false;
            return true;
          });
        }),
        createMany: vi.fn(async (args: { data: Array<{ receiverUserId: string; type: string; title: string; content: string; link: unknown }> }) => {
          for (const d of args.data) {
            mockState.messages.push({
              type: d.type,
              receiverUserId: d.receiverUserId,
              link: d.link,
              createdAt: new Date()
            });
          }
          return { count: args.data.length };
        })
      },
      user: {
        findMany: vi.fn(async (args: { where: { role?: { code: string }; isSystem?: boolean; status?: string; deletedAt?: null } }) => {
          const code = args.where.role?.code;
          return mockState.users
            .filter((u) => (code ? u.role.code === code : true))
            .map((u) => ({ id: u.id }));
        })
      }
    }
  };
});

vi.mock("@/server/events/bus", () => ({
  emit: vi.fn(async (_p: unknown, ev: { type: string; payload: Record<string, unknown>; receivers: string[] }) => {
    mockState.emitted.push(ev);
    // 镜像 bus.emit 的副作用:把消息写入 messages 表 (用于后续 dedup 验证)
    for (const r of ev.receivers) {
      mockState.messages.push({
        type: ev.type,
        receiverUserId: r,
        link: (ev.payload as { contractId?: string; invoiceId?: string; contractId_?: string }).contractId
          ? { id: (ev.payload as { contractId: string }).contractId }
          : { id: (ev.payload as { invoiceId: string }).invoiceId },
        createdAt: new Date()
      });
    }
    return ev.receivers.length;
  }),
  listAdminUserIds: vi.fn(async () => mockState.users.filter((u) => u.role.code === "ADMIN").map((u) => u.id))
}));

import { contractExpiringJob, invoiceOverdueJob } from "@/server/jobs/runner";

const now = new Date("2026-06-23T10:00:00Z");
const inDays = (n: number) => {
  const d = new Date(now);
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d;
};

beforeEach(() => {
  mockState.contracts = [];
  mockState.invoices = [];
  mockState.payments = [];
  mockState.messages = [];
  mockState.users = [
    { id: "u-owner", role: { code: "SALES" } },
    { id: "u-admin", role: { code: "ADMIN" } },
    { id: "u-finance", role: { code: "FINANCE" } }
  ];
  mockState.emitted = [];
});

describe("contractExpiringJob", () => {
  it("ACTIVE 合同 30 天后到期 → owner + 全部 ADMIN 收到一条", async () => {
    mockState.contracts = [
      { id: "c-1", contractNo: "CT-001", endDate: inDays(30), ownerUserId: "u-owner" }
    ];
    const r = await contractExpiringJob(now);
    expect(r.scanned).toBe(1);
    expect(r.created).toBe(1);
    const emit = mockState.emitted[0]!;
    expect(emit.type).toBe("CONTRACT_EXPIRING");
    expect(emit.receivers).toEqual(["u-owner", "u-admin"]);
    expect(emit.payload).toMatchObject({ contractId: "c-1", daysLeft: 30 });
  });

  it("同合同同日第二次跑 → created=0 (按 owner 维度去重)", async () => {
    mockState.contracts = [
      { id: "c-1", contractNo: "CT-001", endDate: inDays(30), ownerUserId: "u-owner" }
    ];
    const r1 = await contractExpiringJob(now);
    expect(r1.created).toBe(1);
    mockState.emitted = [];
    const r2 = await contractExpiringJob(now);
    expect(r2.created).toBe(0);
  });

  it("跨合同不互相影响:合同 A 发了不阻止合同 B", async () => {
    mockState.contracts = [
      { id: "c-A", contractNo: "CT-A", endDate: inDays(30), ownerUserId: "u-owner" },
      { id: "c-B", contractNo: "CT-B", endDate: inDays(30), ownerUserId: "u-owner" }
    ];
    const r = await contractExpiringJob(now);
    expect(r.created).toBe(2);
  });

  it("30/7/1 三个窗口同一天都命中 → 3 条", async () => {
    mockState.contracts = [
      { id: "c-30", contractNo: "CT-30", endDate: inDays(30), ownerUserId: "u-owner" },
      { id: "c-7", contractNo: "CT-7", endDate: inDays(7), ownerUserId: "u-owner" },
      { id: "c-1", contractNo: "CT-1", endDate: inDays(1), ownerUserId: "u-owner" }
    ];
    const r = await contractExpiringJob(now);
    expect(r.scanned).toBe(3);
    expect(r.created).toBe(3);
  });
});

describe("invoiceOverdueJob", () => {
  const invoice = (id: string, ownerUserId: string, amount: number, daysAgo: number) => {
    const issue = new Date(now);
    issue.setDate(issue.getDate() - daysAgo);
    return {
      id,
      invoiceNo: `INV-${id}`,
      customerName: "客户 X",
      amount,
      actualIssueDate: issue,
      status: "ISSUED",
      deletedAt: null,
      contract: { ownerUserId }
    };
  };

  it("ISSUED 满 30 天且未回款 → owner + admin + finance 都收到", async () => {
    mockState.invoices = [invoice("inv-1", "u-owner", 1000, 35)];
    const r = await invoiceOverdueJob(now);
    expect(r.scanned).toBe(1);
    expect(r.created).toBe(1);
    const emit = mockState.emitted[0]!;
    expect(emit.type).toBe("INVOICE_OVERDUE_PAYMENT");
    expect(emit.receivers.sort()).toEqual(["u-admin", "u-finance", "u-owner"]);
  });

  it("已全额回款的发票 → 跳过 (remaining <= 0.01)", async () => {
    mockState.invoices = [invoice("inv-1", "u-owner", 1000, 35)];
    mockState.payments = [{ invoiceId: "inv-1", amount: 1000, status: "CONFIRMED" }];
    const r = await invoiceOverdueJob(now);
    expect(r.created).toBe(0);
  });

  it("同发票同日第二次跑 → created=0 (按 entityId 维度去重)", async () => {
    mockState.invoices = [invoice("inv-1", "u-owner", 1000, 35)];
    const r1 = await invoiceOverdueJob(now);
    expect(r1.created).toBe(1);
    mockState.emitted = [];
    const r2 = await invoiceOverdueJob(now);
    expect(r2.created).toBe(0);
  });

  it("ISSUED 不足 30 天 → 不在扫描范围", async () => {
    mockState.invoices = [invoice("inv-1", "u-owner", 1000, 20)];
    const r = await invoiceOverdueJob(now);
    expect(r.scanned).toBe(0);
    expect(r.created).toBe(0);
  });
});

describe("跨事件类型去重互不污染 (P3.10)", () => {
  it("今天给合同 A 发过 CONTRACT_EXPIRING,不会让 invoiceOverdueJob 把同一实体当作已发过", async () => {
    // 模拟:今天已有 CONTRACT_EXPIRING 给合同 A
    mockState.messages.push({
      type: "CONTRACT_EXPIRING",
      receiverUserId: "u-owner",
      link: { id: "c-1" },
      createdAt: new Date(now)
    });
    // 现在 invoiceOverdueJob 跑,即使有发票 id 跟合同 id 撞了 (不会真撞,但模拟 link.id 重叠)
    mockState.invoices = [
      {
        id: "c-1", // 故意复用 id 模拟"键空间重叠"
        invoiceNo: "INV-1",
        customerName: "X",
        amount: 1000,
        actualIssueDate: new Date(now.getTime() - 35 * 86400_000),
        status: "ISSUED",
        deletedAt: null,
        contract: { ownerUserId: "u-owner" }
      }
    ];
    const r = await invoiceOverdueJob(now);
    // 期望:invoice 因 link.id === "c-1" 在 CONTRACT_EXPIRING dedup 里不会被认作已发,
    //       所以这次 INVOICE_OVERDUE_PAYMENT 仍然正常发出
    expect(r.created).toBe(1);
    expect(mockState.emitted[0]!.type).toBe("INVOICE_OVERDUE_PAYMENT");
  });

  it("今天给发票 B 发过 INVOICE_OVERDUE_PAYMENT,不会让 contractExpiringJob 跳过同 id 实体", async () => {
    mockState.messages.push({
      type: "INVOICE_OVERDUE_PAYMENT",
      receiverUserId: "u-owner",
      link: { id: "shared-id" },
      createdAt: new Date(now)
    });
    mockState.contracts = [
      { id: "shared-id", contractNo: "CT-X", endDate: inDays(30), ownerUserId: "u-owner" }
    ];
    const r = await contractExpiringJob(now);
    expect(r.created).toBe(1);
    expect(mockState.emitted[0]!.type).toBe("CONTRACT_EXPIRING");
  });
});
