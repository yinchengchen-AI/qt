// 催收记录服务
//   - 行级隔离: SALES 角色只看到自己 owner 的合同下发票的催收(走 ownerViaContract)
//   - 权限: DUNNING resource (CRUD+EXPORT for ADMIN, CRU for FINANCE, R for SALES/OPS/EXPERT)
//   - 注意: 催收记录本身是 invoiceId 级(不存 customerId),所有过滤都通过 Invoice -> Contract -> owner
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import {  ownerViaContract } from "@/lib/ownership";
import { Prisma } from "@prisma/client";

export const DUNNING_STATUS = ["CONTACTED", "PROMISED", "DISPUTED", "LEGAL"] as const;
export type DunningStatus = (typeof DUNNING_STATUS)[number];

export const DUNNING_CHANNEL = ["PHONE", "WECHAT", "EMAIL", "VISIT"] as const;
export type DunningChannel = (typeof DUNNING_CHANNEL)[number];

export const dunningNoteCreateSchema = z.object({
  invoiceId: z.string().min(1),
  status: z.enum(DUNNING_STATUS),
  promisedDate: z.string().datetime().optional().nullable(),
  lastContactAt: z.string().datetime(),
  channel: z.enum(DUNNING_CHANNEL),
  remark: z.string().max(1000).optional().nullable()
});

export const dunningNoteUpdateSchema = z.object({
  status: z.enum(DUNNING_STATUS).optional(),
  promisedDate: z.string().datetime().optional().nullable(),
  lastContactAt: z.string().datetime().optional(),
  channel: z.enum(DUNNING_CHANNEL).optional(),
  remark: z.string().max(1000).optional().nullable()
});

export type DunningNoteCreateInput = z.infer<typeof dunningNoteCreateSchema>;
export type DunningNoteUpdateInput = z.infer<typeof dunningNoteUpdateSchema>;

export type DunningNoteRow = {
  id: string;
  invoiceId: string;
  invoiceNo: string | null;
  status: DunningStatus;
  promisedDate: string | null;
  lastContactAt: string;
  channel: DunningChannel;
  remark: string | null;
  actorId: string;
  actorName: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * 把"按 invoice 限定"的 SALES 隔离条件转成 Prisma where。
 * SALES 只能列出自己 owner 合同下的催收记录;
 * ADMIN/FINANCE/OPS/EXPERT 看到全部。
 */
function whereForUser(user: SessionUser, extra: Prisma.DunningNoteWhereInput = {}): Prisma.DunningNoteWhereInput {
  const base: Prisma.DunningNoteWhereInput = { ...extra };
  if (user.roleCode === "SALES") {
    base.invoice = { contract: { ownerUserId: user.id } } as Prisma.InvoiceWhereInput;
  }
  return base;
}

async function assertInvoiceAccess(user: SessionUser, invoiceId: string): Promise<void> {
  // 验证发票存在 + SALES 行级隔离
  const inv = await prisma.invoice.findFirst({
    where: {
      id: invoiceId,
      deletedAt: null,
      ...(ownerViaContract(user) as Prisma.InvoiceWhereInput)
    },
    select: { id: true, invoiceNo: true, customerName: true }
  });
  if (!inv) {
    // SALES 看不到的发票,统一抛 404(不是 403,避免泄露存在性)
    const err = new Error("发票不存在或无权限访问");
    (err as Error & { status?: number }).status = 404;
    throw err;
  }
}

export async function listDunningNotes(
  user: SessionUser,
  query: { invoiceId?: string; limit?: number } = {}
): Promise<DunningNoteRow[]> {
  requirePermission(user.roleCode, RESOURCE.DUNNING, ACTION.READ);
  const where: Prisma.DunningNoteWhereInput = whereForUser(user, {});
  if (query.invoiceId) where.invoiceId = query.invoiceId;
  const rows = await prisma.dunningNote.findMany({
    where,
    orderBy: { lastContactAt: "desc" },
    take: query.limit ?? 200,
    include: {
      actor: { select: { name: true } },
      invoice: { select: { invoiceNo: true } }
    }
  });
  return rows.map(mapDunningNoteRow);
}

// 把 prisma row(含 actor/invoice include) 拍成对外 DunningNoteRow.
// 不强行用 ReturnType 推断, 直接列字段更稳, 也方便 typecheck 报错时定位.
type DunningNoteWithRelations = {
  id: string;
  invoiceId: string;
  status: string;
  channel: string;
  actorId: string;
  lastContactAt: Date;
  createdAt: Date;
  updatedAt: Date;
  promisedDate: Date | null;
  remark: string | null;
  actor?: { name: string } | null;
  invoice?: { invoiceNo: string } | null;
};
function mapDunningNoteRow(r: DunningNoteWithRelations): DunningNoteRow {
  return {
    id: r.id,
    invoiceId: r.invoiceId,
    invoiceNo: r.invoice?.invoiceNo ?? null,
    status: r.status as DunningStatus,
    promisedDate: r.promisedDate?.toISOString() ?? null,
    lastContactAt: r.lastContactAt.toISOString(),
    channel: r.channel as DunningChannel,
    remark: r.remark ?? null,
    actorId: r.actorId,
    actorName: r.actor?.name ?? "-",
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString()
  };
}

export async function createDunningNote(user: SessionUser, input: DunningNoteCreateInput): Promise<DunningNoteRow> {
  requirePermission(user.roleCode, RESOURCE.DUNNING, ACTION.CREATE);
  await assertInvoiceAccess(user, input.invoiceId);
  // PROMISED 状态强烈建议带 promisedDate;其它情况可选
  if (input.status === "PROMISED" && !input.promisedDate) {
    const err = new Error("客户承诺状态必须填写承诺付款日");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  const created = await prisma.dunningNote.create({
    data: {
      invoiceId: input.invoiceId,
      status: input.status,
      promisedDate: input.promisedDate ? new Date(input.promisedDate) : null,
      lastContactAt: new Date(input.lastContactAt),
      channel: input.channel,
      remark: input.remark ?? null,
      actorId: user.id
    }
  });
  // 直接按 id 重读 — 避免 listDunningNotes 在并发场景下取到非本次创建的 note(issue #17 from review)
  const detail = await prisma.dunningNote.findUnique({
    where: { id: created.id },
    include: {
      actor: { select: { name: true } },
      invoice: { select: { invoiceNo: true } }
    }
  });
  if (!detail) {
    // 极端 race: 创建后瞬间被删; 抛错让上层感知
    throw new Error("催收记录创建后无法读取");
  }
  return mapDunningNoteRow(detail as unknown as DunningNoteWithRelations);
}

export async function updateDunningNote(
  user: SessionUser,
  id: string,
  patch: DunningNoteUpdateInput
): Promise<DunningNoteRow> {
  requirePermission(user.roleCode, RESOURCE.DUNNING, ACTION.UPDATE);
  // 找到原记录并校验行级权限
  const existing = await prisma.dunningNote.findFirst({
    where: whereForUser(user, { id }),
    select: { id: true, invoiceId: true, status: true, promisedDate: true }
  });
  if (!existing) {
    const err = new Error("催收记录不存在或无权限");
    (err as Error & { status?: number }).status = 404;
    throw err;
  }
  const data: Prisma.DunningNoteUpdateInput = {};
  if (patch.status) data.status = patch.status;
  if (patch.promisedDate !== undefined) {
    data.promisedDate = patch.promisedDate ? new Date(patch.promisedDate) : null;
  }
  if (patch.lastContactAt) data.lastContactAt = new Date(patch.lastContactAt);
  if (patch.channel) data.channel = patch.channel;
  if (patch.remark !== undefined) data.remark = patch.remark;
  // PROMISED 校验
  const finalStatus = (patch.status ?? existing.status) as DunningStatus;
  const finalPromisedDate = patch.promisedDate === undefined ? existing.promisedDate : (patch.promisedDate ? new Date(patch.promisedDate) : null);
  if (finalStatus === "PROMISED" && !finalPromisedDate) {
    const err = new Error("客户承诺状态必须填写承诺付款日");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  await prisma.dunningNote.update({ where: { id }, data });
  // listDunningNotes 失败也不应回滚 update — update 是 source of truth;
  // 调用方拿到 row 是 best-effort 视图, 失败时下一次列表会显示新值.
  return (await listDunningNotes(user, { invoiceId: existing.invoiceId, limit: 1 }))[0]!;
}

export async function deleteDunningNote(user: SessionUser, id: string): Promise<void> {
  requirePermission(user.roleCode, RESOURCE.DUNNING, ACTION.DELETE);
  const existing = await prisma.dunningNote.findFirst({
    where: whereForUser(user, { id }),
    select: { id: true }
  });
  if (!existing) {
    const err = new Error("催收记录不存在或无权限");
    (err as Error & { status?: number }).status = 404;
    throw err;
  }
  await prisma.dunningNote.delete({ where: { id } });
}

/**
 * 催收汇总(给 dashboard 卡片用)
 * - totalOpen: 有未结清应收(remain > 0.01)的发票数
 * - byStatus: 各催收状态的发票数(去重 invoiceId,只算最新一条)
 * - topOverdue: 90+ 且有催收记录的发票 Top 5
 */
export type DunningSummary = {
  totalOpen: number;
  withDunning: number;
  byStatus: Record<DunningStatus, number>;
  topOverdue: Array<{ invoiceId: string; invoiceNo: string; daysOverdue: number; remaining: number; latestStatus: DunningStatus }>;
};

export async function getDunningSummary(user: SessionUser): Promise<DunningSummary> {
  requirePermission(user.roleCode, RESOURCE.DUNNING, ACTION.READ);
  // 与 getInvoiceAging 同口径的过滤
  const baseInvoiceWhere: Prisma.InvoiceWhereInput = {
    deletedAt: null,
    status: "ISSUED",
    ...(ownerViaContract(user) as Prisma.InvoiceWhereInput)
  };
  const [openCount, latestNotes] = await Promise.all([
    prisma.invoice.count({ where: baseInvoiceWhere }),
    prisma.dunningNote.findMany({
      where: whereForUser(user, {}),
      orderBy: { lastContactAt: "desc" },
      include: { invoice: { select: { id: true, invoiceNo: true, actualIssueDate: true, dueDate: true, amount: true } } }
    })
  ]);
  // 每张发票只算最新一条
  const seen = new Set<string>();
  const latestByInvoice = new Map<string, typeof latestNotes[number]>();
  for (const n of latestNotes) {
    if (seen.has(n.invoiceId)) continue;
    seen.add(n.invoiceId);
    latestByInvoice.set(n.invoiceId, n);
  }
  const byStatus: Record<DunningStatus, number> = {
    CONTACTED: 0,
    PROMISED: 0,
    DISPUTED: 0,
    LEGAL: 0
  };
  for (const n of latestByInvoice.values()) {
    byStatus[n.status as DunningStatus] = (byStatus[n.status as DunningStatus] ?? 0) + 1;
  }
  // topOverdue: 90+ 且有催收;remaining = amount - 仍生效回款(与 getInvoiceAging 同口径)
  const now = new Date();
  const candidateInvoices = Array.from(latestByInvoice.values())
    .map((n) => {
      const basis = n.invoice.dueDate ?? n.invoice.actualIssueDate;
      if (!basis) return null;
      const days = daysBetween(now, new Date(basis));
      return { note: n, days };
    })
    .filter((x): x is { note: typeof latestByInvoice extends Map<string, infer V> ? V : never; days: number } => x !== null && x.days > 90);
  // 一次 groupBy 拿这批发票的"仍生效回款"汇总
  const topPaid = await prisma.payment.groupBy({
    by: ["invoiceId"],
    where: {
      invoiceId: { in: candidateInvoices.map((c) => c.note.invoice.id) },
      status: { in: ["CONFIRMED", "RECONCILED"] },
      deletedAt: null
    },
    _sum: { amount: true }
  });
  const topPaidMap = new Map<string, Prisma.Decimal>();
  for (const p of topPaid) topPaidMap.set(p.invoiceId!, new Prisma.Decimal(p._sum.amount ?? 0));
  const topOverdue = candidateInvoices
    .map(({ note, days }) => {
      const remain = round2(new Prisma.Decimal(note.invoice.amount).minus(topPaidMap.get(note.invoice.id) ?? 0));
      return {
        invoiceId: note.invoice.id,
        invoiceNo: note.invoice.invoiceNo,
        daysOverdue: days,
        remaining: remain,
        latestStatus: note.status as DunningStatus
      };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
    .slice(0, 5);

  return {
    totalOpen: openCount,
    withDunning: latestByInvoice.size,
    byStatus,
    topOverdue
  };
}

function round2(v: number | Prisma.Decimal): number {
  return new Prisma.Decimal(v).toDecimalPlaces(2).toNumber();
}

function daysBetween(later: Date, earlier: Date): number {
  const a = Date.UTC(later.getUTCFullYear(), later.getUTCMonth(), later.getUTCDate());
  const b = Date.UTC(earlier.getUTCFullYear(), earlier.getUTCMonth(), earlier.getUTCDate());
  return Math.floor((a - b) / 86_400_000);
}
