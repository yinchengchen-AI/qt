// lib/git.ts + lib/git-format.ts 单元测试
//
// 覆盖:
//   - parseCommitSubject 各种 commit subject 格式
//   - formatReleaseContent 按 category 分组、产出 title/summary/content
//   - CATEGORY_MAP 把 commit type 翻成中文
import { describe, it, expect } from "vitest";
import { parseCommitSubject, categoryForType } from "@/lib/git";
import { formatReleaseContent } from "@/lib/git-format";
import type { GitCommit } from "@/lib/git";

const baseCommit: Omit<GitCommit, "type" | "scope" | "description" | "category"> = {
  sha: "x",
  shortSha: "x",
  subject: "x",
  date: "2026-07-03T00:00:00Z"
};

function mkCommit(type: string | null, scope: string | null, description: string): GitCommit {
  // 模拟 git.ts 里的处理
  const parsed = parseCommitSubject(`${type ?? "noop"}${scope ? `(${scope})` : ""}: ${description}`);
  return {
    ...baseCommit,
    type: parsed.type,
    scope: parsed.scope,
    description: parsed.description,
    category: categoryForType(parsed.type)
  };
}

describe("parseCommitSubject", () => {
  it("type + scope + description", () => {
    const r = parseCommitSubject("feat(customers): add bulk import");
    expect(r.type).toBe("feat");
    expect(r.scope).toBe("customers");
    expect(r.description).toBe("add bulk import");
  });

  it("type + description, no scope", () => {
    const r = parseCommitSubject("fix: 修复开票金额舍入");
    expect(r.type).toBe("fix");
    expect(r.scope).toBeNull();
    expect(r.description).toBe("修复开票金额舍入");
  });

  it("breaking change 用 ! 标记", () => {
    const r = parseCommitSubject("feat(api)!: 改响应结构");
    expect(r.type).toBe("feat");
    expect(r.scope).toBe("api");
    expect(r.description).toBe("!改响应结构");
  });

  it("no conventional prefix → 整行当 description", () => {
    const r = parseCommitSubject("merge branch 'dev' into main");
    expect(r.type).toBeNull();
    expect(r.scope).toBeNull();
    expect(r.description).toBe("merge branch 'dev' into main");
  });

  it("type 带数字/连字符", () => {
    const r = parseCommitSubject("feat-2(api-x): something");
    expect(r.type).toBe("feat-2");
    expect(r.scope).toBe("api-x");
  });
});

describe("formatReleaseContent", () => {
  it("无 commits → 占位", () => {
    const r = formatReleaseContent({ version: "v0.0.1", commits: [] });
    expect(r.title).toContain("v0.0.1");
    expect(r.summary).toBe("本次无任何变化");
    expect(r.content).toBe("本次无任何变化");
    expect(r.categoryCounts).toEqual([]);
  });

  it("version 不再做归一化,透传原样", () => {
    // 旧逻辑会自动加 v 前缀;现在由 validator 把关,这里只是透传。
    // 缺失 v 前缀的版本会直接被 admin 表单 reject,这里只是验证格式器忠实输出。
    const commits = [mkCommit("feat", "x", "A")];
    const r1 = formatReleaseContent({ version: "0.7.1", commits });
    expect(r1.title.startsWith("0.7.1")).toBe(true);
    const r2 = formatReleaseContent({ version: "v0.7.1", commits });
    expect(r2.title.startsWith("v0.7.1")).toBe(true);
  });

  it("按 category 分组,feat 在 fix 前面", () => {
    const commits = [
      mkCommit("fix", "x", "修 A"),
      mkCommit("feat", "x", "加 B"),
      mkCommit("feat", "y", "加 C")
    ];
    const r = formatReleaseContent({ version: "v0.7.0", commits });
    // content 第一组应该是 feat
    const firstSection = r.content.split("\n")[0];
    expect(firstSection).toBe("新功能");
    // 计数正确
    const feat = r.categoryCounts.find((c) => c.label === "新功能");
    const fix = r.categoryCounts.find((c) => c.label === "问题修复");
    expect(feat?.count).toBe(2);
    expect(fix?.count).toBe(1);
  });

  it("summary 只取前三类,多了加 '等'", () => {
    const commits = [
      mkCommit("feat", null, "1"),
      mkCommit("fix", null, "2"),
      mkCommit("refactor", null, "3"),
      mkCommit("docs", null, "4"),
      mkCommit("chore", null, "5")
    ];
    const r = formatReleaseContent({ version: "v0.7.0", commits });
    expect(r.summary).toContain("新功能");
    expect(r.summary).toContain("问题修复");
    expect(r.summary).toContain("代码优化");
    expect(r.summary).toContain("等");
    expect(r.summary).not.toContain("文档更新"); // 超过 3 类不展开
  });

  it("scope 显示在括号里", () => {
    const commits = [mkCommit("feat", "customers", "批量导入")];
    const r = formatReleaseContent({ version: "v0.7.0", commits });
    expect(r.content).toMatch(/customers/);
    expect(r.content).toContain("批量导入");
  });
});
