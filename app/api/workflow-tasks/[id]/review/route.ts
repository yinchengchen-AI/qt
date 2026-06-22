// 410 Gone — workflow-tasks/[id]/review
// 端点已下线, 详情见 docs/superpowers/specs/2026-06-22-minimal-pm-workflow-design.md
// PR-1 阶段临时返回 410, PR-2 阶段整个文件 + 目录会被删除.
import { gone410 } from "@/lib/dead-route";

const ENDPOINT = "workflow-tasks/[id]/review";

export async function POST() {
  return gone410(ENDPOINT);
}
