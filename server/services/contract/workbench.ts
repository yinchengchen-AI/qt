// 个人合同工作台 service (Phase 1)
//
// 数据范围: "我的合同" = ownerUserId = 当前用户, 对所有角色一致 (SALES / EXPERT / FINANCE / ADMIN 都是个人视角).
// 口径对齐 spec §3.5 (docs/superpowers/specs/2026-08-18-contract-deepening-roadmap-design.md):
//   - 活跃合同数   = status = ACTIVE (含逾期窗口内的)
//   - 即将到期     = ACTIVE 且 endDate ∈ [now, now + 7d]
//   - 逾期合同     = ACTIVE 且 endDate < now (宽限期窗口内未被强关、也未双足额自动完结的)
//                   + CLOSED 且 reviewComment = "overdue_terminated" (已强关待善后)
//   - 风险预警     = Phase 2 交付前固定 0 (卡片显示 "—")
//
// 安全: 所有查询的 ownerUserId 一律从 session 取, 不接受客户端传入; 只读操作不写审计日志.
import { prisma } from "@/lib/prisma";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";
import { INVOICE_ISSUED_AMOUNT_STATUSES } from "@/lib/invoice-amounts";

const DAY_MS = 86_400_000;
/** 即将到期窗口 (天), 与 spec §3.5 的 0-7 天一致 */
const EXPIRING_WINDOW_DAYS = 7;
/** 生效多久无已开票发票才算 "未开票" 待办 (天), 与 Phase 3 超期未开票口径同源 */
const NO_INVOICE_GRACE_DAYS = 30;

export type MyStats = {
  /** status = ACTIVE 的合同数 (含逾期窗口内的) */
  active: number;
  /** ACTIVE 且 endDate ∈ [now, now+7d] */
  expiringSoon: number;
  /** ACTIVE 且 endDate < now + CLOSED 且 reviewComment="overdue_terminated" */
  overdue: number;
  /** Phase 2 风险引擎交付前固定 0, 前端卡片显示 "—" */
  risk: number;
};

export async function getMyStats(user: SessionUser): Promise<MyStats> {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.READ);

  const now = new Date();
  const in7Days = new Date(now.getTime() + EXPIRING_WINDOW_DAYS * DAY_MS);

  // 一次查询拿所有 ACTIVE 合同, 在 JS 里按 endDate 分桶 (避免 3 次 count / N+1)
  const [activeContracts, forceClosed] = await Promise.all([
    prisma.contract.findMany({
      where: { ownerUserId: user.id, status: "ACTIVE", deletedAt: null },
      select: { id: true, endDate: true }
    }),
    // 已强关待善后: 宽限期强关 (reason 存在 reviewComment) 的合同
    // 口径与 status.ts tryAutoCloseOnOverdue 一致; 统计区间内强关的按 endDate 窗口过滤
    prisma.contract.count({
      where: {
        ownerUserId: user.id,
        status: "CLOSED",
        reviewComment: "overdue_terminated",
        deletedAt: null,
        endDate: { gte: new Date(now.getTime() - 90 * DAY_MS) }
      }
    })
  ]);

  let expiringSoon = 0;
  let overdueActive = 0;
  for (const c of activeContracts) {
    if (!c.endDate) continue;
    if (c.endDate.getTime() < now.getTime()) overdueActive++;
    else if (c.endDate.getTime() <= in7Days.getTime()) expiringSoon++;
  }

  return {
    active: activeContracts.length,
    expiringSoon,
    overdue: overdueActive + forceClosed,
    risk: 0
  };
}

export type TodoItem = {
  id: string;
  contractId: string;
  contractNo: string;
  title: string;
  customerName: string | null;
  type: "overdue" | "expiring" | "no_invoice";
  /** 1 = 逾期 (最优先), 2 = 7 天内到期, 3 = 未开票 */
  priority: 1 | 2 | 3;
  dueLabel: string;
  href: string;
};

export async function getMyTodos(user: SessionUser): Promise<TodoItem[]> {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.READ);

  const now = new Date();
  const in7Days = new Date(now.getTime() + EXPIRING_WINDOW_DAYS * DAY_MS);
  const noInvoiceCutoff = new Date(now.getTime() - NO_INVOICE_GRACE_DAYS * DAY_MS);

  // 一次查询拿所有 ACTIVE 合同 + 客户名 + 已开票发票 (未开票判定用), 避免 N+1
  const contracts = await prisma.contract.findMany({
    where: { ownerUserId: user.id, status: "ACTIVE", deletedAt: null },
    select: {
      id: true,
      contractNo: true,
      title: true,
      endDate: true,
      startDate: true,
      customer: { select: { name: true } },
      // 已开票口径: 与 overview.ts / stale-contract.ts 一致 (ISSUED + RED_FLUSHED)
      invoices: {
        where: { deletedAt: null, status: { in: [...INVOICE_ISSUED_AMOUNT_STATUSES] } },
        select: { id: true }
      }
    }
  });

  const todos: TodoItem[] = [];

  for (const c of contracts) {
    // 逾期 (priority 1) — 逾期合同不重复产生其他类型待办
    if (c.endDate && c.endDate.getTime() < now.getTime()) {
      const daysOverdue = Math.floor((now.getTime() - c.endDate.getTime()) / DAY_MS);
      todos.push({
        id: `overdue-${c.id}`,
        contractId: c.id,
        contractNo: c.contractNo,
        title: c.title,
        customerName: c.customer?.name ?? null,
        type: "overdue",
        priority: 1,
        dueLabel: `已逾期 ${daysOverdue} 天`,
        href: `/contracts/${c.id}`
      });
      continue;
    }

    // 7 天内到期 (priority 2)
    if (c.endDate && c.endDate.getTime() <= in7Days.getTime()) {
      const daysLeft = Math.ceil((c.endDate.getTime() - now.getTime()) / DAY_MS);
      todos.push({
        id: `expiring-${c.id}`,
        contractId: c.id,
        contractNo: c.contractNo,
        title: c.title,
        customerName: c.customer?.name ?? null,
        type: "expiring",
        priority: 2,
        dueLabel: `${daysLeft} 天后到期`,
        href: `/contracts/${c.id}`
      });
    }

    // 生效 ≥ 30 天无已开票发票 (priority 3; 口径与 Phase 3 超期未开票对齐)
    if (c.startDate && c.startDate.getTime() <= noInvoiceCutoff.getTime() && c.invoices.length === 0) {
      const daysSinceStart = Math.floor((now.getTime() - c.startDate.getTime()) / DAY_MS);
      todos.push({
        id: `no-invoice-${c.id}`,
        contractId: c.id,
        contractNo: c.contractNo,
        title: c.title,
        customerName: c.customer?.name ?? null,
        type: "no_invoice",
        priority: 3,
        dueLabel: `生效 ${daysSinceStart} 天未开票`,
        href: `/contracts/${c.id}`
      });
    }
  }

  // 按优先级排序 (逾期 > 7 天内到期 > 未开票)
  todos.sort((a, b) => a.priority - b.priority);
  return todos;
}
