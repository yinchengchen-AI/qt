// POST /api/app-releases/preview-from-git
// 服务端跑 git log + 解析,返回基于 convention commits 自动生成的 release 文本,
// 给 admin 表单的"从 git 自动填充"按钮消费。
//
// 不创建数据库行:仅返回草稿 (version/title/summary/content),由 admin 在表单里二次审阅后
// 通过 POST /api/app-releases 落库。
//
// 权限:admin session (requirePermission APP_RELEASE CREATE)
// 防注入:任何 git ref 必须经过 lib/git.resolveGitRef 解析成完整 commit SHA,
// 不能直接拼到 git log argv 里,否则恶意 ref 语法 (如 HEAD:file.txt) 能读仓库任意文件。
// .git 目录:docker 部署镜像需要 COPY .git 进去,否则 503。
import { z } from "zod";
import { execFileSync } from "node:child_process";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err, ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import {
  getCommitsInRange,
  readPackageVersion,
  resolveGitRef
} from "@/lib/git";
import { formatReleaseContent } from "@/lib/git-format";

const MAX_COMMITS = 50;

const bodySchema = z.object({}).optional();

export async function POST(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      requirePermission(user.roleCode, RESOURCE.APP_RELEASE, ACTION.CREATE);

      bodySchema.parse(await req.json().catch(() => ({})));

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

      let version: string;
      try {
        version = readPackageVersion({ cwd });
      } catch (e) {
        throw new ApiError(
          ERROR_CODES.INTERNAL_ERROR,
          `读 package.json 失败: ${(e as Error).message}`,
          500
        );
      }
      // 兜底加 v 前缀;管理员在 UI 上仍能手动覆盖
      const versionNorm = version.startsWith("v") ? version : `v${version}`;

      // 取 HEAD 的最近 MAX_COMMITS 条 commit。HEAD 必须先 resolve 成 SHA,防注入。
      let toSha: string;
      try {
        toSha = resolveGitRef("HEAD", { cwd });
      } catch (e) {
        throw new ApiError(ERROR_CODES.VALIDATION_FAILED, (e as Error).message, 400);
      }

      const commits = getCommitsInRange({ to: toSha, cwd, maxCount: MAX_COMMITS });
      if (commits.length === 0) {
        return ok({
          version: versionNorm,
          title: `${versionNorm} 更新说明`,
          summary: "本次无任何变化",
          content: "本次无任何变化",
          commitCount: 0
        });
      }
      const formatted = formatReleaseContent({ version: versionNorm, commits });

      return ok({
        version: versionNorm,
        title: formatted.title,
        summary: formatted.summary,
        content: formatted.content,
        commitCount: commits.length
      });
    } catch (e) {
      return err(e);
    }
  });
}
