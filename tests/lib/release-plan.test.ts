// lib/release-plan.ts 单元测试
//
// 覆盖:
//   - isReleaseNoise / filterReleaseNoise 过滤发版噪音 commit
//   - shouldMarkImportant 的 breaking (!) 判定
//   - planFromTag 的 tag 区间选择(当前版本已打 tag / 未打 tag / 无 tag)
import { describe, it, expect } from "vitest";
import { parseCommitSubject, categoryForType } from "@/lib/git";
import type { GitCommit } from "@/lib/git";
import {
  isReleaseNoise,
  filterReleaseNoise,
  shouldMarkImportant,
  planFromTag
} from "@/lib/release-plan";

function mkCommit(subject: string): GitCommit {
  const parsed = parseCommitSubject(subject);
  return {
    sha: "x",
    shortSha: "x",
    subject,
    date: "2026-07-29T00:00:00Z",
    type: parsed.type,
    scope: parsed.scope,
    description: parsed.description,
    category: categoryForType(parsed.type)
  };
}

describe("isReleaseNoise", () => {
  it("chore(release) / docs(release) 是噪音", () => {
    expect(isReleaseNoise("chore(release): bump to v0.13.1")).toBe(true);
    expect(isReleaseNoise("docs(release): v0.13.1 README/CHANGELOG/AGENTS 版本同步")).toBe(true);
    expect(isReleaseNoise("build(release): 打包")).toBe(true);
    expect(isReleaseNoise("ci(release): 发布流水线")).toBe(true);
  });

  it("普通 commit 不是噪音", () => {
    expect(isReleaseNoise("feat(customers): 客户批量导入")).toBe(false);
    expect(isReleaseNoise("chore: 升级依赖")).toBe(false);
    // scope 不是 release 时不算
    expect(isReleaseNoise("chore(workflow): 删除项目管理模块")).toBe(false);
    // 裸文本不算
    expect(isReleaseNoise("release v0.13.1")).toBe(false);
  });
});

describe("filterReleaseNoise", () => {
  it("过滤噪音并保留其余顺序", () => {
    const commits = [
      mkCommit("docs(release): v0.13.1 版本同步"),
      mkCommit("chore(release): bump to v0.13.1"),
      mkCommit("fix(invoice): 编辑开票页合同编号显示"),
      mkCommit("feat(contracts): 合同导出 PDF")
    ];
    const kept = filterReleaseNoise(commits);
    expect(kept.map((c) => c.subject)).toEqual([
      "fix(invoice): 编辑开票页合同编号显示",
      "feat(contracts): 合同导出 PDF"
    ]);
  });
});

describe("shouldMarkImportant", () => {
  it("任一 commit 带 breaking(!) 标记则为 true", () => {
    const commits = [mkCommit("feat(api)!: 删除旧接口"), mkCommit("fix: 小修")];
    expect(shouldMarkImportant(commits)).toBe(true);
  });

  it("全部普通提交为 false", () => {
    const commits = [mkCommit("feat: 新功能"), mkCommit("chore: 杂项")];
    expect(shouldMarkImportant(commits)).toBe(false);
  });
});

describe("planFromTag", () => {
  const tags = ["v0.13.1", "v0.13.0", "v0.12.0"];

  it("当前版本已打 tag: 取它的前一个 tag", () => {
    expect(planFromTag(tags, "v0.13.1")).toBe("v0.13.0");
  });

  it("当前版本还没打 tag: 取最新 tag", () => {
    expect(planFromTag(tags, "v0.13.2")).toBe("v0.13.1");
  });

  it("当前 tag 是最早的一个: 无起始 ref,返回 null", () => {
    expect(planFromTag(["v0.1.0"], "v0.1.0")).toBeNull();
  });

  it("仓库没有任何 tag: 返回 null", () => {
    expect(planFromTag([], "v0.13.1")).toBeNull();
  });
});
