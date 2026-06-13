// 锁定看板页 (1) 服务层 getProjectKanban 拉取 task.code (2) 接口返回包含 code 字段
// (3) 前端 KanbanTask 类型带 code (4) 卡片渲染展示任务码 Tag
// 与 PROJECT_HISTORY 行为对齐:每条任务实例都能在 UI 上被标识。

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf-8");
}

describe("看板视图显示任务码(code)", () => {
  it("server/services/workflow.ts:getProjectKanban select task.code 并把 code 推到 KanbanColumn.tasks", () => {
    const src = read("server/services/workflow.ts");
    // select 要拉 task.code;stage 作为 select 的嵌套字段(Prisma 不允许同级 select + include)
    expect(src, "task select 应包含 code: true").toMatch(
      /include:\s*\{\s*task:\s*\{[^}]*select:\s*\{[^}]*code:\s*true/
    );
    // 反向断言:不允许 select + include 同级
    expect(src, "task 不应在 select 同级再写 include").not.toMatch(
      /select:\s*\{[^}]*\}\s*,\s*include:/
    );
    // KanbanColumn.tasks 类型里要有 code
    const tasksTypeBlock = src.match(/tasks:\s*Array<\{[\s\S]*?\}>;/)?.[0] ?? "";
    expect(tasksTypeBlock, "KanbanColumn.tasks 类型应含 code: string").toMatch(/code:\s*string/);
    // col.tasks.push 注入 code
    expect(src, "col.tasks.push 应注入 code: ins.task.code").toMatch(/col\.tasks\.push\(\{[\s\S]*?code:\s*ins\.task\.code/);
  });

  it("app/api/projects/[id]/workflow/board/route.ts 透传 ProjectKanban", () => {
    const src = read("app/api/projects/[id]/workflow/board/route.ts");
    // 该 route 只做 requireSession + 调 getProjectKanban,不做字段裁剪
    expect(src, "应从 services/workflow 导入 getProjectKanban").toMatch(/getProjectKanban[\s\S]*from\s+"@\/server\/services\/workflow"/);
    // 必须把 getProjectKanban 的返回值塞进响应(ok(data) 也算透传)
    expect(src, "应把 getProjectKanban 结果作为响应体透传").toMatch(/ok\(\s*(?:await\s+)?getProjectKanban\(|ok\(\s*data\b/);
  });

  it("app/(app)/workflow/board/page.tsx:KanbanTask 类型带 code,卡片渲染 code Tag", () => {
    const src = read("app/(app)/workflow/board/page.tsx");
    // 类型
    const typeBlock = src.match(/type\s+KanbanTask\s*=\s*\{[\s\S]*?\};/)?.[0] ?? "";
    expect(typeBlock, "KanbanTask 类型应含 code: string").toMatch(/code:\s*string/);
    // 卡片 JSX 渲染 t.code
    expect(src, "卡片应渲染 t.code 任务码 Tag").toMatch(/\{t\.code\s*&&\s*<Tag[^>]*>\{t\.code\}<\/Tag>\}/);
  });
});
