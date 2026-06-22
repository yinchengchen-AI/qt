// 410 Gone helper — PR-1 阶段把 12 个 dead 端点都改成返回这个.
// PR-2 阶段此文件 + dead 端点路由文件会一并删除.
//
// 参考设计文档: docs/superpowers/specs/2026-06-22-minimal-pm-workflow-design.md §4.2
const SPEC_PATH = "docs/superpowers/specs/2026-06-22-minimal-pm-workflow-design.md";

export function gone410(endpoint: string): Response {
  return Response.json(
    {
      code: 41001,
      message: `此端点(${endpoint})已下线,见 ${SPEC_PATH}`,
    },
    { status: 410 },
  );
}
