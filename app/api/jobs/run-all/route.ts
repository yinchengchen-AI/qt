// Vercel Cron 入口：POST /api/jobs/run-all
// 生产环境用 CRON_SECRET header 鉴权；本地测试用 admin session
import { ok, err, ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { runAllJobs } from "@/server/jobs/runner";
import { requireSession } from "@/lib/session";

export async function POST(req: Request) {
  try {
    // 生产环境：Vercel 自动注入 Authorization: Bearer <CRON_SECRET>
    // 本地测试：必须登录 ADMIN
    const auth = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && auth === `Bearer ${cronSecret}`) {
      const now = new Date();
      const results = await runAllJobs(now);
      return ok({ at: now.toISOString(), results, source: "cron" });
    }
    // 走 session 鉴权
    const user = await requireSession();
    if (user.roleCode !== "ADMIN") {
      throw new ApiError(ERROR_CODES.FORBIDDEN, "仅管理员可触发定时任务", 403);
    }
    const now = new Date();
    const results = await runAllJobs(now);
    return ok({ at: now.toISOString(), results, source: "manual" });
  } catch (e) {
    return err(e);
  }
}
