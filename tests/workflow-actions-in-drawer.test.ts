// 工作流 v0.x → "状态机操作统一收进任务详情抽屉" 改动锁:
// 1) workflow-section.tsx 里的卡片不再含任何 "开始/完成/阻塞/解阻/跳过" 按钮或历史展开
// 2) /workflow 列表不再含批量多选(行内操作按钮也删了)
// 3) /workflow/board 不再含拖拽/Dropdown 菜单/拖放区
// 4) task-drawer.tsx 必须仍然包含全部 8 个动作字符串(开始/完成/阻塞/解阻/跳过/提交校核/审核通过/驳回)
// 5) 活动历史已迁移到项目详情页:drawer 不再渲染活动历史/Timeline/ACTION_META
//    相关 BEFORE_LABEL / ACTION_META / DiffRow 等在 project-history.tsx 里

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf-8");
}

describe("状态机操作统一收进任务详情抽屉", () => {
  it("项目详情工作流区段 workflow-section.tsx 不再渲染任何状态机按钮或活动历史", () => {
    const src = read("components/workflow/workflow-section.tsx");
    // 卡片里之前出现的按钮文案
    expect(src, "工作流卡片不应再渲染「开始」按钮文案").not.toMatch(/>\s*开始\s*</);
    expect(src, "工作流卡片不应再渲染「完成」按钮文案").not.toMatch(/>\s*完成\s*</);
    expect(src, "工作流卡片不应再渲染「阻塞」按钮文案").not.toMatch(/>\s*阻塞\s*</);
    expect(src, "工作流卡片不应再渲染「解阻」按钮文案").not.toMatch(/>\s*解阻\s*</);
    expect(src, "工作流卡片不应再渲染「跳过」按钮文案").not.toMatch(/>\s*跳过\s*</);
    // 旧版的活动历史展开按钮和组件都不应再出现
    expect(src, "应已删除 TaskActions 组件").not.toMatch(/function\s+TaskActions\b/);
    expect(src, "应已删除 TaskHistory 组件").not.toMatch(/function\s+TaskHistory\b/);
    expect(src, "应已删除 AssigneeName 组件").not.toMatch(/function\s+AssigneeName\b/);
    expect(src, "不应再展开「活动历史」按钮").not.toMatch(/展开活动历史|收起活动历史/);
  });

  it("/workflow 列表不再含批量多选和行内状态机按钮", () => {
    const src = read("app/(app)/workflow/page.tsx");
    expect(src, "应已删除「批量」相关字符串").not.toMatch(/批量/);
    expect(src, "应已删除「已选 N 项」提示").not.toMatch(/已选\s*\{/);
    expect(src, "应已删除 rowSelection 配置").not.toMatch(/rowSelection/);
    expect(src, "行内状态机按钮文案应被删除").not.toMatch(/>\s*(开始|完成|解阻|校核)\s*</);
  });

  it("/workflow/board 不再含拖拽、Dropdown 菜单、拖放区", () => {
    const src = read("app/(app)/workflow/board/page.tsx");
    expect(src, "应已删除 handleDrop 处理器").not.toMatch(/handleDrop/);
    expect(src, "应已删除 handleDragStart 处理器").not.toMatch(/handleDragStart/);
    expect(src, "应已删除 handleDragOver 处理器").not.toMatch(/handleDragOver/);
    expect(src, "应已删除 draggable 属性").not.toMatch(/draggable=/);
    expect(src, "应已删除 onDragStart/onDragEnd").not.toMatch(/onDragStart|onDragEnd/);
    expect(src, "应已删除 Dropdown 组件").not.toMatch(/<Dropdown/);
    expect(src, "应已删除 MoreOutlined 快捷操作入口").not.toMatch(/MoreOutlined/);
    expect(src, "应已删除 AssigneeName 组件").not.toMatch(/function\s+AssigneeName\b/);
    expect(src, "拖放区文案「开始/完成/跳过」应从看板列底部移除").not.toMatch(
      />\s*开始\s*<\s*\/div>|>\s*完成\s*<\s*\/div>|>\s*跳过\s*<\s*\/div>/
    );
  });

  it("task-drawer.tsx 仍含全部 8 个状态机动作文案", () => {
    const src = read("components/workflow/task-drawer.tsx");
    // 抽屉是状态机操作的唯一暴露点 — 8 个动作文案缺一不可
    const expected = ["开始", "完成", "阻塞", "解阻", "跳过", "提交校核", "审核通过", "驳回"];
    for (const label of expected) {
      expect(src, `task-drawer.tsx 缺失动作文案: ${label}`).toMatch(new RegExp(`>\\s*${label}\\s*<`));
    }
  });

  it("task-drawer.tsx 不再渲染活动历史 / Timeline / ACTION_META", () => {
    const src = read("components/workflow/task-drawer.tsx");
    // 活动历史已搬到项目详情页;drawer 不应再保留 Timeline / 历史相关组件
    expect(src, "drawer 不应再使用 antd Timeline").not.toMatch(/from\s+"antd"[\s\S]*?\bTimeline\b/);
    expect(src, "drawer 不应再出现 <Timeline> JSX").not.toMatch(/<Timeline[\s>]/);
    expect(src, "drawer 不应再定义 ACTION_META 动作元数据表").not.toMatch(/const\s+ACTION_META\s*:/);
    expect(src, "drawer 不应再定义 BEFORE_LABEL diff 字段映射").not.toMatch(/const\s+BEFORE_LABEL\s*:/);
    expect(src, "drawer 不应再出现 DiffRow 组件").not.toMatch(/function\s+DiffRow\b/);
    expect(src, "drawer 不应再引用 /api/workflow-tasks/.../history").not.toMatch(/\/api\/workflow-tasks\/[^`]*history/);
  });
});
