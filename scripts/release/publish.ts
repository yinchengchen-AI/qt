#!/usr/bin/env tsx
/**
 * 自动发布更新日志(AppRelease)。
 *
 * 由 scripts/prod/deploy.sh 在 build 成功后调用;也可手动跑:
 *   npm run release:publish
 *
 * 行为:
 *   1. 读 package.json version → "vX.Y.Z"
 *   2. 同 version 且未删除的 AppRelease 已存在 → skip(幂等,保护人工编辑)
 *   3. git log <上一个 release tag>..HEAD → 过滤发版噪音 commit
 *      → lib/git-format 生成 title/summary/content
 *   4. 写 AppRelease(source=GIT_COMMITS,gitFrom/gitTo/gitCommitCount 补齐)+ audit
 *
 * 环境:
 *   DATABASE_URL                   读 .env(deploy.sh 已 source)
 *   RELEASE_PUBLISHER_EMPLOYEE_NO  发布人工号,默认 "admin";查不到回落第一个 ACTIVE 的 ADMIN
 *
 * 失败策略:任一硬错误 exit 1;deploy.sh 对该步只告警不阻断部署。
 */
import { prisma } from "@/lib/prisma";
import {
  getCommitsInRange,
  getHeadSha,
  listReleaseTags,
  readPackageVersion,
  resolveGitRef
} from "@/lib/git";
import { formatReleaseContent } from "@/lib/git-format";
import { filterReleaseNoise, planFromTag, shouldMarkImportant } from "@/lib/release-plan";
import { audit } from "@/server/audit";

/** 首个 release(仓库无 v* tag)时最多回看多少条 commit,避免把全量历史灌进更新日志 */
const FIRST_RELEASE_MAX_COMMITS = 30;
const MAX_COMMITS = 200;

async function resolvePublisherId(): Promise<{ id: string; employeeNo: string }> {
  const employeeNo = process.env.RELEASE_PUBLISHER_EMPLOYEE_NO?.trim() || "admin";
  const named = await prisma.user.findFirst({
    where: { employeeNo, status: "ACTIVE", deletedAt: null },
    select: { id: true, employeeNo: true }
  });
  if (named) return named;
  const fallback = await prisma.user.findFirst({
    where: { status: "ACTIVE", deletedAt: null, role: { code: "ADMIN" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, employeeNo: true }
  });
  if (fallback) {
    console.warn(`[release:publish] 找不到工号 ${employeeNo} 的 ACTIVE 用户,回落到 ${fallback.employeeNo}`);
    return fallback;
  }
  throw new Error(`找不到发布人:工号 ${employeeNo} 不存在,且没有任何 ACTIVE 的 ADMIN 用户`);
}

async function main(): Promise<void> {
  const version = `v${readPackageVersion()}`;

  // 幂等:同 version 已发布则跳过(保护既有内容);
  // 想重新生成需先在 DB 里软删旧记录(UPDATE "AppRelease" SET "deletedAt"=now() ...),再重跑本脚本
  const existing = await prisma.appRelease.findFirst({
    where: { version, deletedAt: null },
    select: { id: true, source: true }
  });
  if (existing) {
    console.log(`[release:publish] ${version} 已存在 (source=${existing.source}),跳过`);
    return;
  }

  const tags = listReleaseTags();
  const fromRef = planFromTag(tags, version);
  const toSha = getHeadSha();
  const fromSha = fromRef ? resolveGitRef(fromRef) : null;
  const commits = filterReleaseNoise(
    getCommitsInRange({
      from: fromSha ?? undefined,
      to: toSha,
      // 无起始 tag(首个 release)时兜底限制条数
      maxCount: fromSha ? MAX_COMMITS : FIRST_RELEASE_MAX_COMMITS
    })
  );

  const formatted = formatReleaseContent({ version, commits });
  const publisher = await resolvePublisherId();

  const release = await prisma.appRelease.create({
    data: {
      version,
      title: formatted.title,
      summary: formatted.summary,
      content: formatted.content,
      important: shouldMarkImportant(commits),
      source: "GIT_COMMITS",
      gitFrom: fromSha,
      gitTo: toSha,
      gitCommitCount: commits.length,
      publishedById: publisher.id
    }
  });
  await audit(prisma, {
    actorId: publisher.id,
    action: "APP_RELEASE_CREATE",
    entity: "AppRelease",
    entityId: release.id,
    after: {
      version: release.version,
      title: release.title,
      important: release.important,
      source: release.source
    }
  });

  const stats = formatted.categoryCounts.map((c) => `${c.label}×${c.count}`).join(" ") || "无变更";
  console.log(
    `[release:publish] 已发布 ${version} (id=${release.id}): ${commits.length} 条 commit ` +
      `(${fromRef ?? "HEAD~"}..${toSha.slice(0, 7)}) — ${stats}` +
      `${release.important ? " [重要]" : ""}`
  );
}

main()
  .catch((e) => {
    console.error(`[release:publish] 失败: ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
