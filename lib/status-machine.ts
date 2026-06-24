// 状态机迁移统一入口。吃掉 contract.ts 的 tryAutoPublish / tryAutoCloseOnExpiry /
// tryAutoComplete 三个 ~50 行函数,以及 customer.ts:changeCustomerStatus /
// invoice.ts:invoiceAction / payment.ts:paymentAction 的事务与重试样板。
//
// 两种使用模式:
//   - runTransitionInTx: 嵌在外层事务内 (createContract / updateContract / closeContract 等)
//   - runTransition:     单独事务跑 (自动迁移), 内部 Serializable + P2034 重试 3 次
//
// Prisma 7 不支持嵌套事务, 两种模式二选一; caller 自己包 $transaction 时只能调 InTx 版本。
import { Prisma } from "@prisma/client";
import { Prisma as PrismaNS } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { emit, type DomainEventType } from "@/server/events/bus";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";

const SERIALIZABLE_RETRY = 3;
const TX_TIMEOUT_MS = 10_000;

type Entity = "Contract" | "Customer" | "Invoice" | "Payment";

// 让 precondition 抛 SkipTransition 触发 silentSkip 语义; silentSkip=false 时会
// 透过抛 ENTITY_IMMUTABLE, silentSkip=true 时直接返回 SKIPPED。
export class SkipTransition extends Error {
  constructor() {
    super("skip");
  }
}

export type TransitionInput<C extends { id: string; status: string }> = {
  entity: Entity;
  loadInTx: (tx: PrismaNS.TransactionClient) => Promise<C | null>;
  from: readonly string[];
  to: string;
  /** 拿到 current 后, update 前做业务校验; 抛 ApiError 表示 422 */
  precondition?: (current: C, tx: PrismaNS.TransactionClient) => void | Promise<void>;
  /** update 时除了 status: to 之外还要写的字段(比如 closeContract 写 reviewComment) */
  extraData?: (current: C) => Record<string, unknown>;
  audit: (current: C) => {
    actorId: string;
    action: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  };
  /** 仅 Contract 走 contractReviewLog 表; 其他 entity 留空 */
  reviewLog?: (current: C) => { action: string; comment?: string | null; reviewerId: string } | undefined;
  event?: (
    current: C,
    tx: PrismaNS.TransactionClient,
  ) => Promise<{ type: DomainEventType; payload: Record<string, unknown>; receivers: string[] } | undefined>;
  /** 状态不匹配时静默跳过(自动迁移)还是抛 ENTITY_IMMUTABLE(管理员手动迁移) */
  silentSkip?: boolean;
};

export type TransitionResult = "DONE" | "SKIPPED";

// 嵌在外层事务内使用
export async function runTransitionInTx<C extends { id: string; status: string }>(
  tx: PrismaNS.TransactionClient,
  input: TransitionInput<C>,
): Promise<TransitionResult> {
  const current = await input.loadInTx(tx);
  if (!current) {
    if (input.silentSkip) return "SKIPPED";
    throw new ApiError(ERROR_CODES.NOT_FOUND, `${input.entity}不存在`, 404);
  }
  if (!input.from.includes(current.status)) {
    if (input.silentSkip) return "SKIPPED";
    throw new ApiError(
      ERROR_CODES.ENTITY_IMMUTABLE,
      `当前状态 ${current.status} 不可迁移到 ${input.to}(须 ${input.from.join("/")})`,
      403,
    );
  }
  try {
    if (input.precondition) await input.precondition(current, tx);
  } catch (e) {
    if (e instanceof SkipTransition) return "SKIPPED";
    throw e;
  }
  const data: Record<string, unknown> = { status: input.to, ...(input.extraData?.(current) ?? {}) };
  await updateByEntity(tx, input.entity, current.id, data);
  const a = input.audit(current);
  await audit(tx, {
    actorId: a.actorId,
    action: a.action,
    entity: input.entity,
    entityId: current.id,
    before: a.before,
    after: a.after,
  });
  const rl = input.reviewLog?.(current);
  if (rl && input.entity === "Contract") {
    await tx.contractReviewLog.create({
      data: { contractId: current.id, reviewerId: rl.reviewerId, action: rl.action, comment: rl.comment ?? null },
    });
  }
  const ev = input.event ? await input.event(current, tx) : undefined;
  if (ev) {
    await emit(tx, { type: ev.type, payload: ev.payload, receivers: ev.receivers });
  }
  return "DONE";
}

// 单独事务跑 (自动迁移) — Serializable + P2034 重试 3 次
export async function runTransition<C extends { id: string; status: string }>(
  input: TransitionInput<C> & { id: string },
): Promise<TransitionResult> {
  for (let attempt = 1; attempt <= SERIALIZABLE_RETRY; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => runTransitionInTx(tx, input),
        { isolationLevel: PrismaNS.TransactionIsolationLevel.Serializable, timeout: TX_TIMEOUT_MS },
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034" && attempt < SERIALIZABLE_RETRY) {
        continue;
      }
      throw e;
    }
  }
  throw new Error("unreachable: SERIALIZABLE_RETRY exhausted");
}

// 按 entity dispatch Prisma update. Prisma 的 model.update 是 per-model 类型,
// 这里用 switch 把抽象层的 entity 字符串转成对应的 tx.contract.update 等。
async function updateByEntity(
  tx: PrismaNS.TransactionClient,
  entity: Entity,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  switch (entity) {
    case "Contract":
      await tx.contract.update({ where: { id }, data: data as Prisma.ContractUpdateInput });
      return;
    case "Customer":
      await tx.customer.update({ where: { id }, data: data as Prisma.CustomerUpdateInput });
      return;
    case "Invoice":
      await tx.invoice.update({ where: { id }, data: data as Prisma.InvoiceUpdateInput });
      return;
    case "Payment":
      await tx.payment.update({ where: { id }, data: data as Prisma.PaymentUpdateInput });
      return;
  }
}
