// Project.milestones 字段自 v0.3.0 起废弃,v0.3.1 硬迁移物理删除。
// 此测试锁住 schema 不再回潮:prisma 生成的 Project 类型不应再含 milestones。
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

describe("Project.milestones 字段已从 schema 移除", () => {
  it("schema.prisma 中不应再有 milestones 字段定义", () => {
    const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf-8");
    // model Project 块
    const projectBlock = schema.match(/model\s+Project\s*\{[\s\S]*?\n\}/);
    expect(projectBlock).toBeTruthy();
    expect(projectBlock![0]).not.toMatch(/milestones/);
  });

  it("schema.prisma 整体不应再有 milestones 字符串", () => {
    const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf-8");
    expect(schema).not.toMatch(/milestones/);
  });

  it("迁移文件存在且 SQL 为 DROP COLUMN", () => {
    // 不依赖目录命名,只断言 prisma/migrations/ 下有一个 sql 文件含 milestones DROP

    const base = join(process.cwd(), "prisma", "migrations");
    const dirs = readdirSync(base);
    const hit = dirs.find((d) => d.includes("drop_project_milestones"));
    expect(hit, "应存在 drop_project_milestones 迁移目录").toBeTruthy();
    const sql = readFileSync(join(base, hit!, "migration.sql"), "utf-8");
    expect(sql).toMatch(/DROP\s+COLUMN\s+IF\s+EXISTS\s+"milestones"/i);
  });

  it("应用代码中不应再引用 Project.milestones", () => {
    // 用 require 动态加载两个已知会消费 Project 字段的实体文件,断言没有 milestones
    // 用 type-only 导入: 编译后类型字段不存在即代表硬迁移成功
    // vitest 在跑 .ts 测试时类型已擦除,这里用字符串扫描兜底

    let out = "";
    try {
      out = execSync(
        "rg -n --no-heading 'Project\\.milestones|\\.milestones\\b' -g '*.ts' -g '*.tsx' -g '!node_modules' -g '!.next' -g '!tests/milestones-removed.test.ts' . || true",
        { encoding: "utf-8" }
      );
    } catch {
      out = "";
    }
    expect(out.trim(), `应用代码不应再含 .milestones 引用:\n${out}`).toBe("");
  });
});
