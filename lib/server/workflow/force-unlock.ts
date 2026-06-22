// 强制解锁某阶段:走 OperationLog,不改 WorkflowTaskInstance.status。
// 阶段派生时检查 OperationLog 的存在性,命中即视为已解锁。
import { prisma } from "@/lib/prisma";

export async function forceUnlockStage(opts: {
  projectId: string;
  stage: "DO" | "DELIVER";
  operatorId: string;
}) {
  const project = await prisma.project.findUnique({ where: { id: opts.projectId } });
  if (!project) throw new Error("PROJECT_NOT_FOUND");

  // 幂等:用 (projectId, stage) + action=FORCE_UNLOCK_STAGE 的最近一条作为唯一
  // OperationLog stores diff as Json, use it for stage payload
  const existing = await prisma.operationLog.findFirst({
    where: { entity: "Project", entityId: opts.projectId, action: "FORCE_UNLOCK_STAGE" },
    orderBy: { at: "desc" }
  });
  if (existing && (existing.diff as { stage?: string } | null)?.stage === opts.stage) {
    return { operationLogId: existing.id, alreadyUnlocked: true };
  }

  const log = await prisma.operationLog.create({
    data: {
      entity: "Project",
      entityId: opts.projectId,
      action: "FORCE_UNLOCK_STAGE",
      actorId: opts.operatorId,
      diff: { stage: opts.stage }
    }
  });
  return { operationLogId: log.id, alreadyUnlocked: false };
}
