#!/usr/bin/env tsx
/**
 * CHANGELOG 草稿生成器(发版闭环里手工条目的半自动化)。
 *
 * 用法(在 npm version 之前跑,版本号是"预发"的下一版):
 *   npm run changelog:draft                     # 上一 release tag → HEAD,版本 = package.json patch+1
 *   npm run changelog:draft -- --minor|--major  # 指定 bump 级别(默认 patch)
 *   npm run changelog:draft -- --from v0.19.0   # 指定起始 ref(默认最新 v* tag)
 *
 * 行为:
 *   1. 取区间内 commits,过滤 chore(release)/docs(release) 噪音(与 release:publish 同口径,
 *      复用 lib/release-plan#filterReleaseNoise)
 *   2. 检测 prisma/migrations / prisma/schema.prisma 在区间内的改动 → 预填 "DB schema" 行
 *   3. 按 conventional type 中文分节,打印 CHANGELOG.md 风格草稿到 stdout(不落盘)
 *
 * 输出是草稿:标题/概述/测试数据是占位符,人工润色后粘贴到 CHANGELOG.md 顶部。
 */
import { execFileSync } from "node:child_process";
import {
  getCommitsInRange,
  getLastReleaseTag,
  readPackageVersion,
  resolveGitRef,
  type GitCommit
} from "@/lib/git";
import { filterReleaseNoise } from "@/lib/release-plan";

type Bump = "patch" | "minor" | "major";

function parseArgs(argv: string[]): { bump: Bump; from: string | null } {
  let bump: Bump = "patch";
  let from: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--patch" || a === "--minor" || a === "--major") {
      bump = a.slice(2) as Bump;
    } else if (a === "--from") {
      const v = argv[++i];
      if (!v) throw new Error("--from 需要一个 ref 参数(如 v0.19.0)");
      from = v;
    } else if (a === "-h" || a === "--help") {
      console.log("用法: npm run changelog:draft -- [--patch|--minor|--major] [--from <ref>]");
      process.exit(0);
    } else {
      throw new Error(`未知参数: ${a}(--help 查看用法)`);
    }
  }
  return { bump, from };
}

function bumpVersion(version: string, bump: Bump): string {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`package.json version 不是 x.y.z 形式: ${version}`);
  let [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (bump === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (bump === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

/** 区间内 migrations / schema 变更文件列表(决定 "DB schema" 行的预填内容) */
function dbSchemaChangedFiles(fromSha: string, toSha: string): string[] {
  const out = execFileSync(
    "git",
    ["diff", "--name-only", `${fromSha}..${toSha}`, "--", "prisma/migrations", "prisma/schema.prisma"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024 }
  );
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

function formatCommitLine(c: GitCommit): string {
  const scope = c.scope ? `(${c.scope})` : "";
  return `- **${c.type ?? "chore"}${scope}**:${c.description.trim()}`;
}

function today(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function main(): void {
  const { bump, from } = parseArgs(process.argv.slice(2));
  const nextVersion = `v${bumpVersion(readPackageVersion(), bump)}`;
  const fromRef = from ?? getLastReleaseTag();
  if (!fromRef) throw new Error("仓库还没有 v* tag,请用 --from 指定起始 ref");
  const fromSha = resolveGitRef(fromRef);
  const toSha = resolveGitRef("HEAD");

  const commits = filterReleaseNoise(getCommitsInRange({ from: fromSha, to: toSha }));
  if (commits.length === 0) {
    console.error(`[changelog:draft] 区间 ${fromRef}..HEAD 内没有可发布的 commit(过滤 release 噪音后)`);
    return;
  }

  const dbFiles = dbSchemaChangedFiles(fromSha, toSha);
  const migrationCount = dbFiles.filter((f) => f.startsWith("prisma/migrations/")).length;
  const dbLine =
    dbFiles.length > 0
      ? `**DB schema 有变化:${migrationCount} 个迁移文件` +
        `${dbFiles.includes("prisma/schema.prisma") ? " + schema.prisma" : ""} 变更,请补充说明` +
        `(新表记得 GRANT qt_app)**。`
      : "**DB schema / migrations: 无变化**。";

  // 按 category(order 升序)分节,与 git-format 的中文桶一致
  const groups = new Map<string, { order: number; commits: GitCommit[] }>();
  for (const c of commits) {
    const g = groups.get(c.category.label) ?? { order: c.category.order, commits: [] };
    g.commits.push(c);
    groups.set(c.category.label, g);
  }
  const sorted = [...groups.values()].sort((a, b) => a.order - b.order);

  const lines: string[] = [];
  lines.push(`## ${nextVersion}(${today()})<一句话标题,请补充>`);
  lines.push("");
  lines.push(`<一段概述,请补充>。${dbLine}`);
  lines.push("");
  lines.push("变更:");
  for (const g of sorted) {
    for (const c of g.commits) lines.push(formatCommitLine(c));
  }
  lines.push("- **测试**:typecheck / lint / vitest 全绿(<N> 文件,<M> 用例)");

  console.error(
    `[changelog:draft] 区间 ${fromRef}..HEAD,${commits.length} 条 commit,目标版本 ${nextVersion} (${bump})`
  );
  console.log(lines.join("\n"));
}

main();
