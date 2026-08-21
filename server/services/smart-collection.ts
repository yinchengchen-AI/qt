// 智能催款建议系统 (Phase 5 - 智能化增强)
//
// 职责:
//   1) 基于客户付款习惯生成个性化催款话术
//   2) 分析客户付款行为模式 (付款周期、偏好方式、响应率)
//   3) 提供最优催款时机建议
//   4) 生成多版本话术供选择
//
// 安全: API key 只走 lib/env.ts 服务端读取; 出域数据最小化
// 降级: 未配置 key → 使用本地规则引擎生成话术

import { ApiError } from "@/lib/api";
import { env } from "@/lib/env";
import { ERROR_CODES } from "@/types/errors";

// =====================================================
// 类型定义
// =====================================================

export type PaymentHabit = {
  contractId: string;
  contractNo: string;           // 合同编号
  customerId: string;
  customerName: string;
  totalContracts: number;
  paidOnTimeCount: number;      // 按时付款次数
  latePaymentCount: number;     // 逾期付款次数
  avgPaymentDays: number;       // 平均付款天数
  preferredPaymentMethod: string; // 偏好付款方式
  lastPaymentDate: Date | null; // 最后一次付款日期
  outstandingAmount: number;    // 未结清金额
  overdueDays: number;          // 逾期天数
};

export type CollectionRecommendation = {
  contractId: string;
  contractNo: string;
  customerName: string;
  outstandingAmount: number;
  overdueDays: number;
  urgencyLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  suggestedTiming: string;
  talkTracks: string[];
  internalNotes: string[];
  suggestedApproach: string;
};

export type CustomerPaymentPattern = {
  customerId: string;
  customerName: string;
  totalContracts: number;
  paidOnTimeRate: number;       // 按时付款率 (0-1)
  avgPaymentDelay: number;      // 平均逾期天数
  preferredMethod: string;      // 偏好付款方式
  responseRate: number;         // 催款响应率 (0-1)
  lastInteraction: Date | null; // 最后互动日期
};

// =====================================================
// 本地规则引擎 (未配置 DeepSeek 时使用)
// =====================================================

/**
 * 基于客户付款习惯生成个性化催款话术
 * 使用规则引擎而非 LLM，确保快速响应
 */
export function generateSmartTalkTracks(
  habit: PaymentHabit,
  pattern?: CustomerPaymentPattern
): string[] {
  const tracks: string[] = [];
  const amount = habit.outstandingAmount;
  const overdue = habit.overdueDays;
  
  // 根据客户付款习惯选择话术风格
  if (pattern && pattern.paidOnTimeRate > 0.8) {
    // 高信用客户: 温和提醒
    tracks.push(
      `您好，提醒一下贵司有一笔 ¥${formatAmount(amount)} 的款项已逾期 ${overdue} 天，方便确认一下付款安排吗？`,
      `不好意思打扰了，看到有一笔 ¥${formatAmount(amount)} 的款项还没收到，想跟您确认下是不是已经安排了？`
    );
  } else if (pattern && pattern.avgPaymentDelay > 15) {
    // 长期逾期客户: 直接明确
    tracks.push(
      `关于合同 ${habit.contractNo}，有一笔 ¥${formatAmount(amount)} 的款项已逾期 ${overdue} 天，请问什么时候能安排付款？`,
      `您好，合同 ${habit.contractNo} 的 ¥${formatAmount(amount)} 款项已逾期较久，请尽快安排付款。`
    );
  } else if (overdue > 30) {
    // 严重逾期: 正式催告
    tracks.push(
      `合同 ${habit.contractNo} 的 ¥${formatAmount(amount)} 款项已逾期 ${overdue} 天，现正式催告请尽快处理，否则将影响后续合作。`,
      `您好，合同 ${habit.contractNo} 的 ¥${formatAmount(amount)} 款项已逾期 ${overdue} 天，请于本周内安排付款。`
    );
  } else {
    // 一般情况: 标准提醒
    tracks.push(
      `您好，合同 ${habit.contractNo} 有一笔 ¥${formatAmount(amount)} 的款项已逾期 ${overdue} 天，请问什么时候方便付款？`,
      `提醒一下，合同 ${habit.contractNo} 的 ¥${formatAmount(amount)} 款项还没收到，请安排一下。`
    );
  }
  
  // 根据偏好付款方式添加针对性建议
  if (pattern?.preferredMethod === "bank_transfer") {
    tracks.push(`如果需要，我可以把对公账户信息发给您。`);
  } else if (pattern?.preferredMethod === "wechat_pay") {
    tracks.push(`支持微信支付，我可以发收款码给您。`);
  }
  
  return tracks.slice(0, 3); // 最多返回 3 条
}

/**
 * 计算催款紧急度
 */
export function calculateUrgencyLevel(
  overdueDays: number,
  outstandingAmount: number,
  pattern?: CustomerPaymentPattern
): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  let score = 0;
  
  // 逾期天数
  if (overdueDays > 60) score += 40;
  else if (overdueDays > 30) score += 30;
  else if (overdueDays > 15) score += 20;
  else if (overdueDays > 7) score += 10;
  
  // 金额大小
  if (outstandingAmount > 100000) score += 30;
  else if (outstandingAmount > 50000) score += 20;
  else if (outstandingAmount > 10000) score += 10;
  
  // 客户付款习惯
  if (pattern) {
    if (pattern.paidOnTimeRate < 0.3) score += 20; // 低信用
    if (pattern.responseRate < 0.5) score += 10;   // 低响应率
  }
  
  if (score >= 70) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

/**
 * 建议催款时机
 */
export function suggestTiming(
  overdueDays: number,
  pattern?: CustomerPaymentPattern
): string {
  if (overdueDays > 30) {
    return "立即联系，工作日上午 10:00-11:00 效果最佳";
  }
  if (overdueDays > 14) {
    return "今日联系，避免拖延至周末";
  }
  if (overdueDays > 7) {
    return "本周内联系，工作日下午 3:00-5:00";
  }
  // 新逾期
  if (pattern?.avgPaymentDelay && pattern.avgPaymentDelay > 10) {
    return "该客户通常延迟 10+ 天付款，可再观察 3-5 天";
  }
  return "下周初联系，给客户合理付款时间";
}

/**
 * 生成内部备注 (供业务人员参考)
 */
export function generateInternalNotes(
  habit: PaymentHabit,
  pattern?: CustomerPaymentPattern
): string[] {
  const notes: string[] = [];
  
  if (pattern) {
    if (pattern.paidOnTimeRate > 0.8) {
      notes.push("高信用客户，温和提醒即可");
    } else if (pattern.paidOnTimeRate < 0.3) {
      notes.push("低信用客户，需重点关注");
    }
    
    if (pattern.avgPaymentDelay > 15) {
      notes.push(`该客户平均付款延迟 ${pattern.avgPaymentDelay} 天，建议提前催款`);
    }
    
    if (pattern.responseRate < 0.3) {
      notes.push("客户响应率低，可能需要电话跟进");
    }
  }
  
  if (habit.overdueDays > 30) {
    notes.push("严重逾期，考虑升级处理");
  }
  
  return notes;
}

/**
 * 智能催款建议主入口
 */
export function generateSmartCollectionAdvice(
  habits: PaymentHabit[],
  patterns?: Map<string, CustomerPaymentPattern>
): CollectionRecommendation[] {
  return habits
    .map((habit) => {
      const pattern = patterns?.get(habit.customerId);
      const urgencyLevel = calculateUrgencyLevel(
        habit.overdueDays,
        habit.outstandingAmount,
        pattern
      );
      
      return {
        contractId: habit.contractId,
        contractNo: habit.contractNo,
        customerName: habit.customerName,
        outstandingAmount: habit.outstandingAmount,
        overdueDays: habit.overdueDays,
        urgencyLevel,
        suggestedTiming: suggestTiming(habit.overdueDays, pattern),
        talkTracks: generateSmartTalkTracks(habit, pattern),
        internalNotes: generateInternalNotes(habit, pattern),
        suggestedApproach: getApproachByUrgency(urgencyLevel)
      };
    })
    .sort((a, b) => {
      const urgencyOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return urgencyOrder[a.urgencyLevel] - urgencyOrder[b.urgencyLevel];
    });
}

function getApproachByUrgency(level: string): string {
  switch (level) {
    case "CRITICAL":
      return "电话 + 上门拜访 + 正式催告函";
    case "HIGH":
      return "电话跟进 + 微信/短信提醒";
    case "MEDIUM":
      return "微信/邮件提醒";
    case "LOW":
      return "系统自动提醒";
    default:
      return "常规跟进";
  }
}

function formatAmount(amount: number): string {
  return amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// =====================================================
// LLM 增强版 (配置 DeepSeek 时使用)
// =====================================================

/**
 * 使用 LLM 生成增强版催款话术
 * 注意：实际实现需要调用 DeepSeek API，这里提供接口定义
 */
export async function generateLLMCollectionAdvice(
  habit: PaymentHabit,
  pattern?: CustomerPaymentPattern
): Promise<{ talkTracks: string[]; internalNotes: string[]; suggestedApproach: string }> {
  // 与 contract-ai.ts 保持一致：未配置 key 时明确报错，不伪装成本地生成
  if (!env.DEEPSEEK_API_KEY) {
    throw new ApiError(ERROR_CODES.INTERNAL_ERROR, "AI 催款建议未配置 (DEEPSEEK_API_KEY 未设置)", 503);
  }

  // TODO: 接入 DeepSeek API 实现真正的 LLM 增强
  // 当前先返回本地规则引擎结果（已配置 key 时作为兜底，避免阻塞业务）
  return {
    talkTracks: generateSmartTalkTracks(habit, pattern),
    internalNotes: generateInternalNotes(habit, pattern),
    suggestedApproach: getApproachByUrgency(
      calculateUrgencyLevel(habit.overdueDays, habit.outstandingAmount, pattern)
    )
  };
}
