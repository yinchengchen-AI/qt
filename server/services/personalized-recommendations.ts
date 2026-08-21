// 个性化推荐服务 (Phase 5 - 用户体验优化)
//
// 职责:
//   1) 基于用户行为模式推荐待办事项
//   2) 分析用户工作习惯和偏好
//   3) 智能排序待办优先级
//   4) 提供个性化提醒
//
// 安全: 纯函数，不触库；行为数据在服务端分析

export type UserBehavior = {
  userId: string;
  role: string;
  recentActions: Array<{
    type: string;
    target: string;
    timestamp: Date;
  }>;
  preferences: {
    workingHours: { start: number; end: number };
    preferredCategories: string[];
    responsePatterns: Record<string, number>;
  };
  currentTasks: Array<{
    id: string;
    type: string;
    status: string;
    dueDate?: Date;
    priority: string;
    relatedEntity: string;
  }>;
};

export type RecommendedTask = {
  id: string;
  type: string;
  title: string;
  description: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  suggestedTime: string;
  reason: string;
  estimatedMinutes: number;
  relatedEntities: string[];
};

export type UserWorkPattern = {
  peakHours: number[];
  preferredTaskTypes: string[];
  avgResponseTime: number;
  completionRate: number;
};

// =====================================================
// 行为分析
// =====================================================

/**
 * 分析用户工作模式
 */
export function analyzeWorkPattern(behavior: UserBehavior): UserWorkPattern {
  const hourCounts: Record<number, number> = {};
  const taskTypeCounts: Record<string, number> = {};

  for (const action of behavior.recentActions) {
    const hour = action.timestamp.getHours();
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    taskTypeCounts[action.type] = (taskTypeCounts[action.type] || 0) + 1;
  }

  // 找出活跃时段 (Top 3)
  const peakHours = Object.entries(hourCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([hour]) => parseInt(hour));

  // 偏好的任务类型 (Top 2)
  const preferredTaskTypes = Object.entries(taskTypeCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 2)
    .map(([type]) => type);

  // 计算完成率
  const completedTasks = behavior.currentTasks.filter(t => t.status === "COMPLETED").length;
  const completionRate = behavior.currentTasks.length > 0
    ? completedTasks / behavior.currentTasks.length
    : 0.5;

  // 根据用户设置的工作时长估算平均响应时间（小时）
  const { start: workStart, end: workEnd } = behavior.preferences.workingHours;
  const workingHours = workEnd > workStart ? workEnd - workStart : 8;

  return {
    peakHours,
    preferredTaskTypes,
    avgResponseTime: workingHours,
    completionRate
  };
}

/**
 * 智能排序待办优先级
 */
export function calculateSmartPriority(
  task: UserBehavior["currentTasks"][0],
  pattern: UserWorkPattern,
  now: Date
): "LOW" | "MEDIUM" | "HIGH" | "URGENT" {
  let score = 0;

  // 1. 截止日期紧急度
  if (task.dueDate) {
    const daysUntilDue = Math.ceil((task.dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntilDue <= 0) score += 40; // 已过期
    else if (daysUntilDue <= 1) score += 30; // 明天截止
    else if (daysUntilDue <= 3) score += 20; // 3 天内
    else if (daysUntilDue <= 7) score += 10; // 一周内
  }

  // 2. 原始优先级
  const priorityScores: Record<string, number> = {
    URGENT: 30,
    HIGH: 20,
    MEDIUM: 10,
    LOW: 0
  };
  score += priorityScores[task.priority] || 0;

  // 3. 任务类型匹配度
  if (pattern.preferredTaskTypes.includes(task.type)) {
    score += 10;
  }

  // 4. 任务状态
  if (task.status === "IN_PROGRESS") {
    score += 5;
  }

  // 5. 转换为优先级
  if (score >= 60) return "URGENT";
  if (score >= 40) return "HIGH";
  if (score >= 20) return "MEDIUM";
  return "LOW";
}

/**
 * 生成个性化待办推荐
 */
export function generatePersonalizedRecommendations(
  behavior: UserBehavior,
  now = new Date()
): RecommendedTask[] {
  const pattern = analyzeWorkPattern(behavior);
  const recommendations: RecommendedTask[] = [];

  // 1. 处理逾期任务
  const overdueTasks = behavior.currentTasks.filter(
    t => t.dueDate && t.dueDate < now && t.status !== "COMPLETED"
  );
  for (const task of overdueTasks.slice(0, 3)) {
    recommendations.push({
      id: task.id,
      type: task.type,
      title: `[逾期] ${getTaskTitle(task)}`,
      description: `任务已逾期，请尽快处理`,
      priority: "URGENT",
      suggestedTime: "立即处理",
      reason: "任务已过截止日期",
      estimatedMinutes: 30,
      relatedEntities: [task.relatedEntity]
    });
  }

  // 2. 处理即将到期任务
  const upcomingTasks = behavior.currentTasks
    .filter(t => t.dueDate && t.dueDate >= now && t.status !== "COMPLETED")
    .sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity));

  for (const task of upcomingTasks.slice(0, 3)) {
    const dueDate = task.dueDate;
    if (!dueDate) continue;
    const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const smartPriority = calculateSmartPriority(task, pattern, now);
    
    recommendations.push({
      id: task.id,
      type: task.type,
      title: getTaskTitle(task),
      description: `${daysUntilDue} 天后截止`,
      priority: smartPriority,
      suggestedTime: suggestTimeForTask(task, pattern, now),
      reason: daysUntilDue <= 3 ? "即将截止" : "按计划处理",
      estimatedMinutes: estimateTaskDuration(task.type),
      relatedEntities: [task.relatedEntity]
    });
  }

  // 3. 基于行为模式推荐
  if (pattern.peakHours.includes(now.getHours())) {
    // 当前是用户活跃时段，推荐高优先级任务
    const highPriorityTasks = behavior.currentTasks
      .filter(t => t.priority === "HIGH" && t.status !== "COMPLETED")
      .slice(0, 2);
    
    for (const task of highPriorityTasks) {
      if (!recommendations.find(r => r.id === task.id)) {
        recommendations.push({
          id: task.id,
          type: task.type,
          title: getTaskTitle(task),
          description: "当前是您的高效工作时段",
          priority: "HIGH",
          suggestedTime: "现在处理",
          reason: "当前是您的高效工作时段",
          estimatedMinutes: estimateTaskDuration(task.type),
          relatedEntities: [task.relatedEntity]
        });
      }
    }
  }

  // 4. 推荐新任务创建
  if (behavior.currentTasks.length < 5) {
    recommendations.push({
      id: "new-task",
      type: "TASK_CREATION",
      title: "创建新任务",
      description: "您当前任务较少，可以考虑创建新任务",
      priority: "LOW",
      suggestedTime: "空闲时",
      reason: "当前任务负载较低",
      estimatedMinutes: 5,
      relatedEntities: []
    });
  }

  return recommendations
    .sort((a, b) => {
      const priorityOrder = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    })
    .slice(0, 8);
}

function getTaskTitle(task: UserBehavior["currentTasks"][0]): string {
  const typeLabels: Record<string, string> = {
    CONTRACT_REVIEW: "合同审核",
    PAYMENT_FOLLOW: "回款跟进",
    INVOICE_ISSUE: "发票开具",
    RISK_CHECK: "风险检查",
    CUSTOMER_FOLLOW: "客户跟进"
  };
  return `${typeLabels[task.type] || task.type} - ${task.relatedEntity}`;
}

function suggestTimeForTask(
  task: UserBehavior["currentTasks"][0],
  pattern: UserWorkPattern,
  now: Date
): string {
  const currentHour = now.getHours();
  
  // 如果任务紧急，建议立即处理
  if (task.priority === "URGENT" || task.priority === "HIGH") {
    return "立即处理";
  }

  // 如果当前是活跃时段，建议现在处理
  if (pattern.peakHours.includes(currentHour)) {
    return "现在处理";
  }

  // 否则建议在下一个活跃时段
  const nextPeakHour = pattern.peakHours.find(h => h > currentHour) ?? pattern.peakHours[0];
  if (nextPeakHour !== undefined) {
    return `${nextPeakHour}:00 处理`;
  }

  return "空闲时处理";
}

function estimateTaskDuration(taskType: string): number {
  const durations: Record<string, number> = {
    CONTRACT_REVIEW: 30,
    PAYMENT_FOLLOW: 15,
    INVOICE_ISSUE: 20,
    RISK_CHECK: 10,
    CUSTOMER_FOLLOW: 20
  };
  return durations[taskType] || 15;
}

/**
 * 生成个性化提醒
 */
export function generatePersonalizedReminders(
  behavior: UserBehavior,
  now = new Date()
): Array<{ message: string; priority: "LOW" | "MEDIUM" | "HIGH" }> {
  const reminders: Array<{ message: string; priority: "LOW" | "MEDIUM" | "HIGH" }> = [];
  const pattern = analyzeWorkPattern(behavior);

  // 1. 检查逾期任务
  const overdueCount = behavior.currentTasks.filter(
    t => t.dueDate && t.dueDate < now && t.status !== "COMPLETED"
  ).length;
  if (overdueCount > 0) {
    reminders.push({
      message: `有 ${overdueCount} 个任务已逾期，请优先处理`,
      priority: "HIGH"
    });
  }

  // 2. 检查今日任务
  const todayTasks = behavior.currentTasks.filter(t => {
    if (!t.dueDate) return false;
    const due = new Date(t.dueDate);
    return due.toDateString() === now.toDateString() && t.status !== "COMPLETED";
  });
  if (todayTasks.length > 0) {
    reminders.push({
      message: `今日有 ${todayTasks.length} 个待办任务`,
      priority: "MEDIUM"
    });
  }

  // 3. 工作效率提醒
  if (pattern.completionRate < 0.5) {
    reminders.push({
      message: "近期任务完成率较低，建议聚焦重要任务",
      priority: "MEDIUM"
    });
  }

  return reminders;
}
