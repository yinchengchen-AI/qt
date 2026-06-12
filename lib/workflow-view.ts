// 工作流引擎 — 纯函数视图聚合 helper
// 设计目标:把 getProjectWorkflow / getProjectKanban 共享的"按 phase 分组 + 计算阶段状态 +
// lockReason"逻辑集中到一处;同时抽出"实例里挑主流模板 id"的小工具,供 upgrade-check
// 和 export 共用。本文件无 prisma / env 依赖,可被 vitest 直接 import。
import { WORKFLOW_PHASE_ORDER, type WorkflowPhaseState } from "@/types/enums";

export type PhaseViewByStatus = {
  PENDING: number;
  IN_PROGRESS: number;
  BLOCKED: number;
  COMPLETED: number;
  SKIPPED: number;
};

export type PhaseView = {
  total: number;
  completed: number;
  byStatus: PhaseViewByStatus;
  /** required stage 中 PENDING/IN_PROGRESS/BLOCKED 的实例数(用于 lockReason 文案) */
  requiredUnfinishedCount: number;
  /** 任意 PENDING/IN_PROGRESS/BLOCKED 的实例(用于 kanban 简化阻塞判定) */
  anyActive: boolean;
  state: WorkflowPhaseState;
  /** 仅 state === "LOCKED" 时填充 */
  lockReason?: string;
};

export type PhaseInstanceInput = {
  status: string;
  task: {
    stage: {
      phase: string;
      code: string;
      name: string;
      sort: number;
      isRequired: boolean;
    };
  };
};

export const WORKFLOW_PHASE_TO_CN: Record<string, string> = {
  PREP: "前期准备",
  REQUIREMENT: "需求识别",
  CONTRACT: "合同签订",
  EXECUTE: "服务实施",
  FOLLOWUP: "回访与改进"
};

/**
 * 把一组 task instance 按 phase 聚合,并按 WORKFLOW_PHASE_ORDER 计算每阶段的状态。
 *
 * 阻塞判定可通过 opts.isPhaseBlocking 自定义:
 *  - 默认(requiredUnfinishedCount > 0):严格语义,只在"required stage 还有未完成"时阻塞后续
 *  - getProjectKanban 传入 (pv) => pv.anyActive:兼容旧看板"任意 active 即阻塞"行为
 *
 * PARTIAL 判定可通过 opts.isPartial 自定义:
 *  - 默认(pv.anyActive):只要还有 active 实例就是 PARTIAL
 *  - getProjectWorkflow 传入 (pv) => pv.completed > 0:兼容旧行为
 *    (旧 computePhaseStatesForProject 严格按"有完成项"判定,纯 PENDING 的 phase 显 READY)
 *
 * lockReason 文案始终以 requiredUnfinishedCount 为依据(供 getProjectWorkflow 使用),
 * 不受 isPhaseBlocking 影响;kanban 不读 lockReason。
 */
export function computePhaseView(
  instances: PhaseInstanceInput[],
  opts: {
    isPhaseBlocking?: (pv: PhaseView) => boolean;
    isPartial?: (pv: PhaseView) => boolean;
  } = {}
): Map<string, PhaseView> {
  const isPhaseBlocking = opts.isPhaseBlocking ?? ((pv) => pv.requiredUnfinishedCount > 0);
  const isPartial = opts.isPartial ?? ((pv) => pv.anyActive);
  const map = new Map<string, PhaseView>();

  for (const ins of instances) {
    const ph = ins.task.stage.phase;
    let v = map.get(ph);
    if (!v) {
      v = {
        total: 0,
        completed: 0,
        byStatus: { PENDING: 0, IN_PROGRESS: 0, BLOCKED: 0, COMPLETED: 0, SKIPPED: 0 },
        requiredUnfinishedCount: 0,
        anyActive: false,
        state: "READY"
      };
      map.set(ph, v);
    }
    v.total++;
    const s = ins.status as keyof PhaseViewByStatus;
    if (s in v.byStatus) v.byStatus[s]++;
    if (ins.status === "COMPLETED" || ins.status === "SKIPPED") v.completed++;
    const isActive = ins.status === "PENDING" || ins.status === "IN_PROGRESS" || ins.status === "BLOCKED";
    if (ins.task.stage.isRequired && isActive) v.requiredUnfinishedCount++;
    if (isActive) v.anyActive = true;
  }

  // 兜底:即使没有实例,WORKFLOW_PHASE_ORDER 中的每个阶段也要有条目(保持与旧实现一致)
  for (const phase of WORKFLOW_PHASE_ORDER) {
    if (!map.has(phase)) {
      map.set(phase, {
        total: 0,
        completed: 0,
        byStatus: { PENDING: 0, IN_PROGRESS: 0, BLOCKED: 0, COMPLETED: 0, SKIPPED: 0 },
        requiredUnfinishedCount: 0,
        anyActive: false,
        state: "READY"
      });
    }
  }

  let prevBlocking = false;
  for (const phase of WORKFLOW_PHASE_ORDER) {
    const v = map.get(phase)!;
    if (v.total === 0) {
      v.state = "READY";
      continue;
    }
    if (v.completed === v.total) {
      v.state = "DONE";
    } else if (prevBlocking) {
      v.state = "LOCKED";
    } else if (isPartial(v)) {
      v.state = "PARTIAL";
    } else {
      v.state = "READY";
    }
    if (isPhaseBlocking(v)) prevBlocking = true;
  }

  for (let i = 0; i < WORKFLOW_PHASE_ORDER.length; i++) {
    const ph = WORKFLOW_PHASE_ORDER[i]!;
    const v = map.get(ph);
    if (v?.state !== "LOCKED") continue;
    const prevPh = i > 0 ? WORKFLOW_PHASE_ORDER[i - 1]! : null;
    if (!prevPh) continue;
    const prevV = map.get(prevPh);
    if (!prevV || prevV.requiredUnfinishedCount === 0) continue;
    v.lockReason = `前一阶段「${WORKFLOW_PHASE_TO_CN[prevPh] ?? prevPh}」还有 ${prevV.requiredUnfinishedCount} 项任务未完成`;
  }

  return map;
}

/**
 * 从实例列表中挑"主流模板 id"(出现次数最多的)。
 *  - 空输入返回 null
 *  - 并列时取第一个最大(对应 Map.entries 顺序)
 */
export function pickMajorityTemplateId(
  instances: Array<{ task?: { stage?: { templateId?: string | null } | null } | null }>
): string | null {
  const counts = new Map<string, number>();
  for (const ins of instances) {
    const tplId = ins.task?.stage?.templateId;
    if (!tplId) continue;
    counts.set(tplId, (counts.get(tplId) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]![0];
}
