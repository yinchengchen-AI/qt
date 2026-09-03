// 消息渲染函数注册表
//
// 设计:把 bus.ts 中 20+ case 的 switch 拆成独立映射
//   - 业务模块 (server/services/contract) 想要 emit 新类型时:
//       1) 在 types/enums.ts 的 MESSAGE_TYPE 加常量
//       2) 在 prisma schema 的 MessageType enum 加值 (并写迁移)
//       3) 在本文件 register 一个 builder
//   - bus.emit 严格按 DomainEventType 查找,缺 builder 视为配置错误(显式抛错)
export type RenderedMessage = {
  title: string;
  content: string;
  link?: Record<string, unknown>;
};

// payload 形状因 type 而异(deprecated 类别如 CUSTOMER_STATUS_* 也允许),此处放宽
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MessageBuilder = (payload: any) => RenderedMessage;
//   渲染函数对 payload 做模板插值,允许访问任意字段。
//   类型用 any 是因为 payload 形状因 type 而异,且 MESSAGE_TYPE 之外还有 deprecated 类别。
//   bus.emit 在调用前已校验 type 在 enum 范围内;此处放宽到 any 减少冗余 cast。

const REGISTRY: Record<string, MessageBuilder> = {
  CONTRACT_EXPIRING: (p) => ({
    title: `合同 ${p.contractNo} 将于 ${p.daysLeft} 天后到期`,
    content: `到期日：${formatDate(p.endDate)}`,
    link: { kind: "contract", id: p.contractId }
  }),
  INVOICE_OVERDUE_PAYMENT: (p) => ({
    title: `发票 ${p.invoiceNo} 已开票 ${p.daysOverdue} 天，剩余未回款 ¥${p.remaining}`,
    content: `客户：${p.customerName}`,
    link: { kind: "invoice", id: p.invoiceId }
  }),
  PAYMENT_RECEIVED: (p) => ({
    title: `客户 ${p.customerName} 回款 ¥${p.amount} 已确认`,
    content: `回款单号：${p.paymentNo}`,
    link: { kind: "payment", id: p.paymentId }
  }),
  INVOICE_ISSUED: (p) => ({
    title: `发票 ${p.invoiceNo} 已开票`,
    content: `开票金额：¥${p.amount ?? "-"}`,
    link: { kind: "invoice", id: p.invoiceId }
  }),
  INVOICE_REJECTED: (p) => ({
    title: `发票 ${p.invoiceNo} 已被驳回`,
    content: `驳回原因：${p.reason ?? "—"}`,
    link: { kind: "invoice", id: p.invoiceId }
  }),
  CONTRACT_AUTO_EXECUTED: (p) => ({
    title: `合同 ${p.contractNo} 已自动执行`,
    content: `客户：${p.customerName ?? "—"}`,
    link: { kind: "contract", id: p.contractId }
  }),
  CONTRACT_AUTO_COMPLETED: (p) => ({
    title: `合同 ${p.contractNo} 已自动完结`,
    content: `客户：${p.customerName ?? "—"}`,
    link: { kind: "contract", id: p.contractId }
  }),
  CONTRACT_AUTO_EXPIRED: (p) => ({
    title: `合同 ${p.contractNo} 已到期自动终止`,
    content: `客户：${p.customerName ?? "—"}`,
    link: { kind: "contract", id: p.contractId }
  }),
  CONTRACT_AUTO_OVERDUE_TERMINATED: (p) => ({
    title: `合同 ${p.contractNo} 宽限期已过，强制终止`,
    content: `客户：${p.customerName ?? "—"}，到期日：${formatDate(p.endDate)}`,
    link: { kind: "contract", id: p.contractId }
  }),
  CONTRACT_EXPIRED_UNPAID: (p) => ({
    title: `合同 ${p.contractNo} 已过期未结清`,
    content: `客户：${p.customerName ?? "—"}，请跟进催收`,
    link: { kind: "contract", id: p.contractId }
  }),
  CONTRACT_PAID_INVOICE_PENDING: (p) => ({
    title: `合同 ${p.contractNo} 回款已足额，请补开发票`,
    content: `客户：${p.customerName ?? "—"}`,
    link: { kind: "contract", id: p.contractId }
  }),
  CERTIFICATE_EXPIRING: (p) => ({
    title: `证书 ${p.certificateName ?? p.certificateId} 将在 ${p.daysLeft} 天后到期`,
    content: `员工：${p.employeeName ?? "—"}，到期日：${formatDate(p.expiryDate)}`,
    link: { kind: "employee", id: p.employeeId }
  }),
  CUSTOMER_STATUS_SUGGEST: (p) => ({
    title: `客户 ${p.customerName} 状态建议：${p.suggest ?? "—"}`,
    content: p.reason ?? "",
    link: { kind: "customer", id: p.customerId }
  }),
  CUSTOMER_STATUS_AUTO_APPLIED: (p) => ({
    title: `客户 ${p.customerName} 状态已自动更新为 ${p.status ?? "—"}`,
    content: p.reason ?? "",
    link: { kind: "customer", id: p.customerId }
  }),
  CUSTOMER_STATUS_AUTO_REVERTED: (p) => ({
    title: `客户 ${p.customerName} 状态已自动回退为 ${p.status ?? "—"}`,
    content: p.reason ?? "",
    link: { kind: "customer", id: p.customerId }
  }),
  RISK_LEVEL_UP: (p) => {
    const LEVEL_LABEL: Record<string, string> = { LOW: "低", MEDIUM: "中", HIGH: "高", CRITICAL: "严重" };
    if (p.summary) {
      return {
        title: `风险合同日报：高风险 ${Number(p.high ?? 0)} 份，严重 ${Number(p.critical ?? 0)} 份`,
        content: p.topContractNo
          ? `最高分合同 ${p.topContractNo}（${Number(p.topScore ?? 0)} 分），请登录合同工作台跟进`
          : "请登录合同工作台跟进风险合同"
      };
    }
    const level = String(p.level ?? "");
    const prevLevel = String(p.prevLevel ?? "");
    return {
      title: `合同 ${p.contractNo} 风险等级上调为${LEVEL_LABEL[level] ?? level}（${Number(p.score ?? 0)} 分）`,
      content: `原等级：${LEVEL_LABEL[prevLevel] ?? prevLevel}（${Number(p.prevScore ?? 0)} 分），请尽快处理`,
      link: { kind: "contract", id: p.contractId }
    };
  },
  CONTRACT_RENEWAL_REMIND: (p) => ({
    title: `合同 ${p.contractNo} 已到期 ${Number(p.daysExpired ?? 0)} 天，仍未续签`,
    content: `客户：${p.customerName ?? "-"}，到期日：${formatDate(p.endDate)}；如不再合作请归档处理，否则请尽快发起续签`,
    link: { kind: "contract", id: p.contractId }
  }),
  LINKAGE_NO_INVOICE: (p) => ({
    title: `合同 ${p.contractNo} 生效 ${Number(p.daysSinceStart ?? 0)} 天未开票`,
    content: `客户：${p.customerName ?? "-"}，请确认服务进度并及时开票`,
    link: { kind: "contract", id: p.contractId }
  }),
  LINKAGE_INVOICE_PAYMENT_GAP: (p) => ({
    title: `合同 ${p.contractNo} 开票-回款偏差 ${Number(p.gapRatio ?? 0)}%（缺口 ¥${p.gapAmount ?? "-"}）`,
    content: `客户：${p.customerName ?? "-"}，已开票 ¥${p.invoicedAmount ?? "-"} / 已回款 ¥${p.paidAmount ?? "-"}，请跟进催收`,
    link: { kind: "contract", id: p.contractId }
  }),
  RECONCILIATION_AUTO_MATCHED: (p) => ({
    title: `对账自动匹配：${p.candidateCount} 条候选`,
    content: `金额：¥${p.amount}，客户：${p.customerName}`,
    link: { kind: "reconciliation", id: p.transactionId }
  }),
  RECONCILIATION_SUGGESTION: (p) => ({
    title: `对账建议匹配：${p.candidateCount} 条候选匹配`,
    content: `金额：¥${p.amount}，客户：${p.customerName}，请前往对账中心人工确认`,
    link: { kind: "reconciliation", id: p.transactionId }
  }),
  RECONCILIATION_DISCREPANCY: (p) => ({
    title: `对账差异提醒：${p.description}`,
    content: `类型：${p.type}，严重程度：${p.severity}，请及时处理`,
    link: { kind: "reconciliation", id: p.bankTransactionId }
  }),
  RECONCILIATION_WEEKLY_REPORT: (p) => ({
    title: `本周对账汇总：新增 ${p.newCount} 条流水，匹配率 ${p.matchRate}%`,
    content: `待确认 ${p.pendingCount} 条，差异 ${p.discrepancyCount} 条，请前往对账中心查看`,
    link: { kind: "reconciliation" }
  })
};

// 兜底:未知 / 已下线 type 仍允许 emit 走历史占位提示,避免一个陌生 type 把整页渲染崩掉
//   - title 包含 type 名, 与 v0.5.0 之前的渲染保持一致(测试期望兼容)
const FALLBACK_BUILDER_FACTORY = (type: string): MessageBuilder => (_payload) => ({
  title: `历史消息 (${type})`,
  content: "该消息类型已下线, 详情请联系管理员"
});

export function getBuilder(type: string): MessageBuilder {
  const b = REGISTRY[type];
  if (b) return b;
  // 未知 type 走 fallback, 而不是抛错
  return FALLBACK_BUILDER_FACTORY(type);
}

export function isKnownType(type: string): boolean {
  return type in REGISTRY;
}



function formatDate(d: unknown): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d instanceof Date ? d : null;
  if (!date || isNaN(date.getTime())) return "—";
  return date.toISOString().slice(0, 10);
}
