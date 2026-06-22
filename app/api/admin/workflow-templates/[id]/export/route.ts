// 410 Gone — admin/workflow-templates/[id]/export
// 端点已下线, 详情见 docs/superpowers/specs/2026-06-22-minimal-pm-workflow-design.md
// PR-1 阶段临时返回 410, PR-2 阶段整个文件 + 目录会被删除.
import { gone410 } from "@/lib/dead-route";

const ENDPOINT = "admin/workflow-templates/[id]/export";

export async function GET() {
  return gone410(ENDPOINT);
}
