// "DiffRow 不再显示活动历史,移至项目详情页" 改动锁:
// 1) server/services/workflow.ts 暴露 getProjectHistory,返回 HistoryEntry 包含 instanceId/taskName/taskCode
// 2) 新建 app/api/projects/[id]/history/route.ts,GET 走 getProjectHistory
// 3) components/workflow/project-history.tsx 渲染项目级活动流,每条带任务码 + 任务名
// 4) 项目详情页 (/projects/{id}) 引入 ProjectHistory
// 5) task-drawer.tsx 不再含活动历史相关(Timeline / ACTION_META / DiffRow / BEFORE_LABEL)

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf-8");
}

describe("项目级活动历史", () => {
  it("server/services/workflow.ts 导出 getProjectHistory,扩展 HistoryEntry 含 instanceId/taskName/taskCode", () => {
    const src = read("server/services/workflow.ts");
    expect(src, "应导出 getProjectHistory").toMatch(/export\s+async\s+function\s+getProjectHistory\b/);
    // HistoryEntry 类型补 3 个字段
    const typeBlock = src.match(/export\s+type\s+HistoryEntry\s*=\s*\{[\s\S]*?\};/)?.[0] ?? "";
    expect(typeBlock, "HistoryEntry 应该是 export type object").toBeTruthy();
    expect(typeBlock, "HistoryEntry 应含 instanceId 字段").toMatch(/instanceId\s*:\s*string\s*\|\s*null/);
    expect(typeBlock, "HistoryEntry 应含 taskName 字段").toMatch(/taskName\s*:\s*string\s*\|\s*null/);
    expect(typeBlock, "HistoryEntry 应含 taskCode 字段").toMatch(/taskCode\s*:\s*string\s*\|\s*null/);
  });

  it("app/api/projects/[id]/history/route.ts 走 getProjectHistory", () => {
    const path = "app/api/projects/[id]/history/route.ts";
    expect(existsSync(join(ROOT, path)), `${path} 必须存在`).toBe(true);
    const src = read(path);
    expect(src, "应从 services/workflow 导入 getProjectHistory").toMatch(/getProjectHistory[\s\S]*from\s+"@\/server\/services\/workflow"/);
    expect(src, "应暴露 GET 处理器").toMatch(/export\s+async\s+function\s+GET\b/);
  });

  it("components/workflow/project-history.tsx 渲染 Timeline + ACTION_META + DiffRow + 任务上下文", () => {
    const path = "components/workflow/project-history.tsx";
    expect(existsSync(join(ROOT, path)), `${path} 必须存在`).toBe(true);
    const src = read(path);
    // 拉取 /api/projects/{id}/history
    expect(src, "应 SWR 拉 /api/projects/.../history").toMatch(/useSWR[\s\S]*?\/api\/projects\/\$\{projectId\}\/history/);
    // Timeline 渲染
    expect(src, "应使用 antd Timeline 串活动").toMatch(/<Timeline[\s\S]*?items=/);
    // ACTION_META + 15 个动作
    expect(src, "应定义 ACTION_META 动作元数据表").toMatch(/const\s+ACTION_META\s*:/);
    const requiredActions = [
      "WORKFLOW_INSTANTIATE",
      "WORKFLOW_TASK_START",
      "WORKFLOW_TASK_COMPLETE",
      "WORKFLOW_TASK_BLOCK",
      "WORKFLOW_TASK_UNBLOCK",
      "WORKFLOW_TASK_SKIP",
      "WORKFLOW_TASK_ASSIGN",
      "WORKFLOW_TASK_REMARK",
      "WORKFLOW_TASK_ATTACHMENT_ADD",
      "WORKFLOW_TASK_ATTACHMENT_REMOVE",
      "WORKFLOW_REVIEW_SUBMIT",
      "WORKFLOW_REVIEW_APPROVE",
      "WORKFLOW_REVIEW_REJECT",
      "WORKFLOW_RECURRING_GENERATE",
      "WORKFLOW_RECURRING_GENERATE_PARENT"
    ];
    for (const action of requiredActions) {
      expect(src, `ACTION_META 应覆盖动作: ${action}`).toMatch(new RegExp(`${action}\\s*:`));
    }
    // DiffRow 必须存在并被使用
    expect(src, "应定义 DiffRow 组件").toMatch(/function\s+DiffRow\b/);
    expect(src, "应使用 <DiffRow ").toMatch(/<DiffRow\b/);
    // BEFORE_LABEL 必须覆盖 16 个 key
    const requiredKeys = [
      "status", "assigneeId", "reviewStatus", "remark",
      "attachments", "attachmentId", "name",
      "templateId", "serviceType", "count", "force",
      "taskId", "wouldCompleteAt", "projectEndDate",
      "generated", "skipped"
    ];
    const labelBlock = src.match(/const\s+BEFORE_LABEL[^=]*=\s*\{[\s\S]*?\n\};/)?.[0] ?? "";
    expect(labelBlock, "BEFORE_LABEL 应是 const object").toBeTruthy();
    for (const k of requiredKeys) {
      const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp("^\\s*" + escaped + "\\s*:");
      const hit = labelBlock.split("\n").some((line) => re.test(line));
      expect(hit, `BEFORE_LABEL 应覆盖 diff key: ${k}`).toBe(true);
    }
    // 状态/二审 枚举值映射要复用 enum-maps
    expect(src, "应复用 enum-maps 的状态映射").toMatch(/WORKFLOW_TASK_STATUS_MAP/);
    expect(src, "应复用 enum-maps 的二审映射").toMatch(/WORKFLOW_REVIEW_STATUS_MAP/);
    // 任务上下文渲染:每条 instanceId 非空的历史要展示任务码 + 任务名
    expect(src, "应渲染 taskCode / taskName 上下文").toMatch(/taskCode/);
    expect(src, "应渲染 taskName 上下文").toMatch(/taskName/);
    // 项目级动作(instanceId = null)不渲染任务行;instanceId 非空时也要展示(任务名缺失时 fallback 到 instanceId)
    expect(src, "instanceId 存在时也展示任务上下文").toMatch(/h\.instanceId\s*&&/);
    expect(src, "任务名缺失时应 fallback 到 instanceId 短前缀").toMatch(/instanceId\.slice/);
  });

  it("项目详情页 /projects/{id} 引入 ProjectHistory", () => {
    const src = read("app/(app)/projects/[id]/page.tsx");
    expect(src, "应 import ProjectHistory").toMatch(/import\s*\{[^}]*ProjectHistory[^}]*\}\s*from\s*"@\/components\/workflow\/project-history"/);
    expect(src, "应在页面上挂载 <ProjectHistory ").toMatch(/<ProjectHistory\s/);
  });

  it("看板视图 /workflow/board 不再挂活动历史(改去项目详情页),且任务卡不链接抽屉", () => {
    const src = read("app/(app)/workflow/board/page.tsx");
    // 1) 不应再 import ProjectHistory
    expect(src, "不应再 import ProjectHistory").not.toMatch(/from\s+"@\/components\/workflow\/project-history"/);
    // 2) 不应再挂载 ProjectHistory
    expect(src, "不应再挂载 <ProjectHistory").not.toMatch(/<ProjectHistory\b/);
    // 3) 不应再出现独立「活动历史」PageHeader
    expect(src, "不应再有「活动历史」PageHeader").not.toMatch(/<PageHeader[^>]*title="活动历史"/);
    // 4) 任务卡不再链接抽屉:无 setDrawerTask onClick / 无 TaskDrawer
    expect(src, "卡片不应再有 setDrawerTask 类的 onClick").not.toMatch(/onClick=\{\(\)\s*=>\s*setDrawerTask/);
    expect(src, "不应再 import TaskDrawer").not.toMatch(/from\s+"@\/components\/workflow\/task-drawer"/);
    expect(src, "不应再挂载 <TaskDrawer").not.toMatch(/<TaskDrawer\b/);
  });

  it("task-drawer.tsx 不再含活动历史 / Timeline / ACTION_META / DiffRow", () => {
    const src = read("components/workflow/task-drawer.tsx");
    expect(src, "drawer 不应再使用 antd Timeline").not.toMatch(/from\s+"antd"[\s\S]*?\bTimeline\b/);
    expect(src, "drawer 不应再出现 <Timeline> JSX").not.toMatch(/<Timeline[\s>]/);
    expect(src, "drawer 不应再定义 ACTION_META").not.toMatch(/const\s+ACTION_META\s*:/);
    expect(src, "drawer 不应再出现 DiffRow 组件").not.toMatch(/function\s+DiffRow\b/);
    expect(src, "drawer 不应再引用 task history 接口").not.toMatch(/\/api\/workflow-tasks\/[^`]*history/);
  });
});
