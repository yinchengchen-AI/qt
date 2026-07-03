// POST /api/app-releases/preview-from-git
// 服务端跑 git log + 解析,返回生成的 release JSON 给 admin 页预览。
//
// 鉴权:admin session (requirePermission APP_RELEASE CREATE)。
// 输入校验:F-1 防御 — from/to 进来后必须经过 lib/git.resolveGitRef
//   解析成 40 字符 commit SHA,不能直接拼到 git log argv 里,否则恶意
//   ref 语法(如 "HEAD:file.txt")能读仓库任意文件。
// .git 目录: docker 部署镜像需要 COPY .git 进去,否则 503。
import { z } from "zod";
import { execFileSync } from "node:child_process";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err, ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import {
  getCommitsInRange,
  getLastReleaseTag,
  readPackageVersion,
  resolveGitRef
} from "@/lib/git";
import { formatReleaseContent } from "@/lib/git-format";

// M-4: 硬上限。无论 from/to 怎么传,最多取 200 条 commit
// 避免超长历史 (10000+ commits) 把 32MB stdout 缓冲撑爆。
const MAX_COMMITS = 200;

const bodySchema = z.object({
  from: z.string().min(1).max(200).optional(),
  to: z.string().min(1).max(200).optional(),
  version: z.string().min(1).max(50).optional(),
  important: z.boolean().optional()
});

export async function POST(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      requirePermission(user.roleCode, RESOURCE.APP_RELEASE, ACTION.CREATE);

      // 1) 解析 body
      const raw = await req.json().catch(() => ({}));
      const input = bodySchema.parse(raw);

      // 2) 必要的 env:得有 .git
      const cwd = process.cwd();
      try {
        execFileSync("git", ["rev-parse", "--git-dir"], { cwd, stdio: "ignore" });
      } catch {
        throw new ApiError(
          ERROR_CODES.INTERNAL_ERROR,
          "服务器找不到 .git 目录,无法读取 commit;部署镜像需要 COPY .git 进去",
          503
        );
      }

      // 3) version 默认走 package.json
      let version: string;
      try {
        version = input.version ?? readPackageVersion({ cwd });
      } catch (e) {
        throw new ApiError(ERROR_CODES.INTERNAL_ERROR, `读 package.json 失败: ${(e as Error).message}`, 500);
      }
      // 归一化带 v 前缀
      const versionNorm = version.startsWith("v") ? version : `v${version}`;

      // 4) 解析 ref → commit SHA (F-1 防御层)
      //    所有用户输入的 from/to 先 resolveGitRef,失败 400;
      //    缺省值也走 resolveGitRef 拿到 SHA 形式,后续 getCommitsInRange
      //    拿到的 from/to 一定是合法 commit SHA,无法被注入。
      let toSha: string;
      try {
        toSha = resolveGitRef(input.to ?? "HEAD", { cwd });
      } catch (e) {
        throw new ApiError(ERROR_CODES.VALIDATION_FAILED, (e as Error).message, 400);
      }
      let fromSha: string;
      if (input.from) {
        try {
          fromSha = resolveGitRef(input.from, { cwd });
        } catch (e) {
          throw new ApiError(ERROR_CODES.VALIDATION_FAILED, (e as Error).message, 400);
        }
      } else {
        const lastTag = getLastReleaseTag({ cwd });
        try {
          // 缺省起点: 上一个 v* tag (转 SHA);没有 tag 时 HEAD~20 (转 SHA)
          fromSha = lastTag
            ? resolveGitRef(lastTag, { cwd })
            : resolveGitRef("HEAD~20", { cwd });
        } catch (e) {
          // tag 解析失败 (比如 tag 被 force-push 删了) 回退 HEAD~20
          try {
            fromSha = resolveGitRef("HEAD~20", { cwd });
          } catch {
            throw new ApiError(
              ERROR_CODES.INTERNAL_ERROR,
              `无法确定 commit 起点: ${(e as Error).message}`,
              500
            );
          }
        }
      }
      // 兜底: from > to (用户传反了 / 当前版本没有新 commit)
      if (fromSha === toSha) {
        return ok({
          commits: [],
          formatted: {
            title: `${versionNorm} 更新说明`,
            summary: "本次无任何变更",
            content: "本次无任何变更",
            categoryCounts: []
          },
          version: versionNorm,
          from: fromSha,
          to: toSha
        });
      }

      // 5) 读 + 格式化
      const commits = getCommitsInRange({ from: fromSha, to: toSha, cwd, maxCount: MAX_COMMITS });
      if (commits.length === 0) {
        return ok({
          commits: [],
          formatted: {
            title: `${versionNorm} 更新说明`,
            summary: "本次无任何变更",
            content: "本次无任何变更",
            categoryCounts: []
          },
          version: versionNorm,
          from: fromSha,
          to: toSha
        });
      }
      const formatted = formatReleaseContent({ version: versionNorm, commits });

      return ok({
        commits: commits.map((c) => ({
          sha: c.sha,
          shortSha: c.shortSha,
          type: c.type,
          scope: c.scope,
          description: c.description,
          date: c.date
        })),
        formatted,
        version: versionNorm,
        from: fromSha,
        to: toSha,
        commitCount: commits.length,
        // M-4 提示: 当 commit 数达到上限时,前端可显示"还有更多未展示"
        truncated: commits.length >= MAX_COMMITS
      });
    } catch (e) {
      return err(e);
    }
  });
}
