// 客户状态机自动化规则元数据 (P 客户状态机优化 §2.1):
// 把 4 条 "系统自动写客户状态" 规则的 ID / 目标状态 / 触发器 / 天数 集中起来, 供
//   - server/services/customer/automation.ts (业务事件触发)
//   - server/jobs/customer-status-suggest.ts (时间窗触发)
//   - components/customers/auto-status-banner.tsx (横幅展示)
//   - lib/customer-auto-rules.test.ts (单测)
// 共同消费. 单一事实源, 加规则只动这里.
//
// 关闭单条规则: env CUSTOMER_AUTO_RULES_DISABLED="RULE_A,RULE_B" (逗号分隔, 空白 trim).
// 测试环境想临时关掉 90 天的 LOST: CUSTOMER_AUTO_RULES_DISABLED=INACTIVE_LOST

import { env } from "@/lib/env";
import type { CustomerStatus } from "@/types/enums";

export type CustomerAutoRuleId =
  | "CONTRACT_ACTIVATED"
  | "ALL_CONTRACTS_CLOSED"
  | "INACTIVE_LOST"
  | "INACTIVE_FROZEN";

export type CustomerAutoRule = {
  id: CustomerAutoRuleId;
  /** 规则触发后, 系统要写的客户状态 */
  targetStatus: CustomerStatus;
  /**
   * 7 天异议窗口期内, 人工撤销时回退到的状态. 必须是状态机迁移表里
   * (targetStatus → revertTarget) 这条边允许的 from 集合之一.
   * 3 个 LOST/FROZEN 规则走 NEGOTIATING (合法); CONTRACT_ACTIVATED 走 FROZEN
   * (因为 SIGNED → NEGOTIATING 不在迁移表里, 这是 §2.4 设计决策).
   */
  revertTarget: CustomerStatus;
  /** 触发器类型: event=业务事件触发(合同 ACTIVE/CLOSED), time=时间窗触发(suggest job) */
  trigger: "event" | "time";
  /** env 覆盖阈值: time 规则用 CUSTOMER_AUTO_INACTIVE_*_DAYS, event 规则用不到 */
  days?: number;
  /** UI 横幅 / 站内信展示用 label */
  label: string;
  /** 站内信 payload 用的简短 reason 前缀, 前端会拼具体上下文 */
  reasonHint: string;
};

export const CUSTOMER_AUTO_RULES: Record<CustomerAutoRuleId, CustomerAutoRule> = {
  CONTRACT_ACTIVATED: {
    id: "CONTRACT_ACTIVATED",
    targetStatus: "SIGNED",
    // 状态机迁移表 (§2.4) 不允许 SIGNED → NEGOTIATING ("越级回退"), 所以 CONTRACT_ACTIVATED
    // 的 revert 走 SIGNED → FROZEN。FROZEN 是可恢复状态 (FROZEN → NEGOTIATING 合法), 业务上表示
    // "本次自动签约作废, 客户进入冻结观察期", owner 后续如需重新推进可手动走 FROZEN → NEGOTIATING。
    revertTarget: "FROZEN",
    trigger: "event",
    label: "合同生效",
    reasonHint: "已有生效中合同, 系统自动改为「已签约」"
  },
  ALL_CONTRACTS_CLOSED: {
    id: "ALL_CONTRACTS_CLOSED",
    targetStatus: "FROZEN",
    revertTarget: "NEGOTIATING",
    trigger: "event",
    label: "全部合同完结",
    reasonHint: "全部合同已完结且无未对账回款, 系统自动改为「已冻结」"
  },
  INACTIVE_LOST: {
    id: "INACTIVE_LOST",
    targetStatus: "LOST",
    revertTarget: "NEGOTIATING",
    trigger: "time",
    days: env.CUSTOMER_AUTO_INACTIVE_LOST_DAYS,
    label: `${env.CUSTOMER_AUTO_INACTIVE_LOST_DAYS} 天无活动`,
    reasonHint: `已 ${env.CUSTOMER_AUTO_INACTIVE_LOST_DAYS} 天无活动且无活跃合同, 系统自动改为「已流失」`
  },
  INACTIVE_FROZEN: {
    id: "INACTIVE_FROZEN",
    targetStatus: "FROZEN",
    revertTarget: "NEGOTIATING",
    trigger: "time",
    days: env.CUSTOMER_AUTO_INACTIVE_FROZEN_DAYS,
    label: `${env.CUSTOMER_AUTO_INACTIVE_FROZEN_DAYS} 天无活动 + 全部合同完结`,
    reasonHint: `已 ${env.CUSTOMER_AUTO_INACTIVE_FROZEN_DAYS} 天无活动且全部合同完结, 系统自动改为「已冻结」`
  }
};

/** 解析 env "RULE_A,RULE_B" → Set; 空/未配置 = 空集 (即全开) */
function parseDisabledRules(raw: string): Set<CustomerAutoRuleId> {
  const set = new Set<CustomerAutoRuleId>();
  for (const piece of raw.split(",")) {
    const id = piece.trim();
    if (!id) continue;
    if (id in CUSTOMER_AUTO_RULES) set.add(id as CustomerAutoRuleId);
  }
  return set;
}

/** 规则当前是否启用. true = 规则会执行自动写; false = 走原建议消息路径 */
export function isRuleEnabled(id: CustomerAutoRuleId): boolean {
  return !parseDisabledRules(env.CUSTOMER_AUTO_RULES_DISABLED).has(id);
}

/** 全部 time 规则 (suggest job 升级时遍历用) */
export function getTimeRules(): CustomerAutoRule[] {
  return Object.values(CUSTOMER_AUTO_RULES).filter((r) => r.trigger === "time");
}

/** 详情页横幅: 给定 ruleId 拿 label */
export function getRuleLabel(id: string | null | undefined): string {
  if (!id) return "系统自动";
  return CUSTOMER_AUTO_RULES[id as CustomerAutoRuleId]?.label ?? id;
}
