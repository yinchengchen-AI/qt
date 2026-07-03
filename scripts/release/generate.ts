#!/usr/bin/env tsx
/**
 * 从 git commits 自动生成 release 记录
 *
 * 工作流:
 *   1. 读取 package.json 的 version(也可 --version 覆盖)
 *   2. 从 git 取自上次 release tag(或 --from 指定的 SHA)到 HEAD 的 commit
 *   3. 解析 conventional commits,按 type 分组(feat/fix/refactor/...)
 *   4. 生成大白话中文 title/summary/content
 *   5. 写库 (prisma) + 写 operation log
 *   6. (默认) 直接入库;(--dry-run) 只打印 JSON 不写库
 *
 * 跟传统人工填写 release 的区别:
 *   - 完全自动:不要管理员 copy commit 列表再翻译
 *   - 内容直白:从 commit subject 1:1 映射到分节列表,无 AI 二次创作
 *   - 可追溯:gitFrom / gitTo / gitCommitCount 三个字段把"基于哪段 commit"锁死,
 *     后续审计能直接 git log <from>..<to> 复现
 *
 * 用法:
 *   pnpm release:generate
 *   pnpm release:generate --dry-run
 *   pnpm release:generate --from abc1234 --to def5678
 *   pnpm release:generate --version 0.7.1   # 默认读 package.json
 *   pnpm release:generate --important       # 标记为重要(强提示用户看)
 *
 * 环境依赖:
 *   - DATABASE_URL 已设置(.env 自动加载)
 *   - 仓库根目录可执行 git
 *   - 不要在 detached HEAD 下跑(找不到 tag / 后续 git describe 会异常)
 */
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { getCommitsInRange, getLastReleaseTag, readPackageVersion, resolveGitRef } from "../../lib/git";
import { formatReleaseContent } from "../../lib/git-format";

type Args = {
  from?: string;
  to?: string;
  version?: string;
  important?: boolean;
  dryRun?: boolean;
  cwd?: string;
};

/** 简单 CLI 参数解析(避免引 commander/yargs 这种重库) */
function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from") out.from = argv[++i];
    else if (a === "--to") out.to = argv[++i];
    else if (a === "--version") out.version = argv[++i];
    else if (a === "--important") out.important = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--cwd") out.cwd = argv[++i];
    else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`[release:generate] 未知参数: ${a}`);
      printHelp();
      process.exit(2);
    }
  }
  return out;
}

function printHelp() {
  console.log(`用法: pnpm release:generate [options]

  --from <sha|tag>     起始 commit (默认: 上一个 v* tag,或 HEAD~20)
  --to <sha|tag>       目标 commit (默认: HEAD)
  --version <ver>      版本号 (默认: 读 package.json)
  --important          标记为重要更新
  --dry-run            只打印生成的 release,不写库
  --cwd <dir>          git 仓库根 (默认: 当前目录)
  -h, --help           显示帮助`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = args.cwd ?? process.cwd();

  // 1) version
  const version = args.version ?? readPackageVersion({ cwd });
  console.log(`[release:generate] version = ${version}`);

  // 2) git 区间 (F-1 防御: 即使 CLI 可信, --from/--to 也走 resolveGitRef
  //    跟 API 端点行为一致;恶意 ref 语法会被 git 拒掉)
  const toRaw = args.to ?? "HEAD";
  const fromRaw = args.from ?? getLastReleaseTag({ cwd }) ?? "HEAD~20";
  let to: string;
  let from: string;
  try {
    to = resolveGitRef(toRaw, { cwd });
  } catch (e) {
    console.error(`[release:generate] --to 无效: ${(e as Error).message}`);
    process.exit(2);
  }
  try {
    from = resolveGitRef(fromRaw, { cwd });
  } catch (e) {
    console.error(`[release:generate] --from 无效 (${fromRaw}): ${(e as Error).message}`);
    process.exit(2);
  }
  console.log(`[release:generate] range = ${from.slice(0, 10)}..${to.slice(0, 10)}`);

  // 3) 读 commits
  const commits = getCommitsInRange({ from, to, cwd });
  if (commits.length === 0) {
    console.log(`[release:generate] 区间内无 commit,无需生成。`);
    return;
  }
  console.log(`[release:generate] 解析到 ${commits.length} 条 commit:`);
  for (const c of commits) {
    console.log(`  ${c.shortSha} [${c.type ?? "-"}] ${c.description}`);
  }

  // 4) 格式化
  const formatted = formatReleaseContent({ version, commits });
  console.log("");
  console.log("=== 生成结果 ===");
  console.log(`title:   ${formatted.title}`);
  console.log(`summary: ${formatted.summary}`);
  console.log(`content:`);
  console.log(formatted.content.split("\n").map((l) => `  ${l}`).join("\n"));

  if (args.dryRun) {
    console.log("\n[dry-run] 未写库。");
    return;
  }

  // 5) 防重复:同 version 已有 release 直接拒绝
  const existing = await prisma.appRelease.findFirst({
    where: { version, deletedAt: null }
  });
  if (existing) {
    console.error(`[release:generate] 已有 version=${version} 的 release (id=${existing.id}),如要更新内容请先在 admin /admin/releases 删除旧的。`);
    process.exit(1);
  }

  // 6) 写库
  // publishedById: 这个脚本在 trusted env 跑,沿用 prisma/seed.ts 的 SYSTEM_USER 约定
  // 写一个 "system" 占位 user (isSystem=true 不会被当作真人),后续 audit 也用它
  const SYSTEM_USER_ID = "system";
  await prisma.user.upsert({
    where: { id: SYSTEM_USER_ID },
    update: {},
    create: {
      id: SYSTEM_USER_ID,
      employeeNo: "SYSTEM",
      name: "System",
      email: "system@internal.local",
      passwordHash: "$2b$10$ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
      roleId: await getOrCreateSystemRoleId(),
      status: "ACTIVE",
      isSystem: true
    }
  });

  const release = await prisma.appRelease.create({
    data: {
      version: `v${version.replace(/^v/, "")}`, // 保证带 v 前缀
      title: formatted.title,
      summary: formatted.summary,
      content: formatted.content,
      important: args.important ?? false,
      source: "GIT_COMMITS",
      gitFrom: from,
      gitTo: to,
      gitCommitCount: commits.length,
      publishedById: SYSTEM_USER_ID
    }
  });

  await audit(prisma, {
    actorId: SYSTEM_USER_ID,
    action: "APP_RELEASE_CREATE_FROM_GIT",
    entity: "AppRelease",
    entityId: release.id,
    after: {
      version: release.version,
      title: release.title,
      important: release.important,
      gitFrom: from,
      gitTo: to,
      gitCommitCount: commits.length
    }
  });

  console.log(`\n[release:generate] 已发布 release id=${release.id},version=${release.version}`);
  console.log(`[release:generate] 用户登录 dashboard 后会在 components/release-popup.tsx 弹窗看到`);
}

/** 拿 ADMIN 角色的 id;没有则报错(脚本依赖 seed 已跑) */
async function getOrCreateSystemRoleId(): Promise<string> {
  const role = await prisma.role.findUnique({ where: { code: "ADMIN" } });
  if (!role) {
    throw new Error("ADMIN role 不存在;请先跑 pnpm seed。");
  }
  return role.id;
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("[release:generate] 失败:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
