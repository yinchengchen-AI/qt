// Vercel Cron 入口：POST /api/jobs/run-all
// 生产环境用 CRON_SECRET header 鉴权；本地测试用 admin session
import { ok, err, ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { runAllJobs } from "@/server/jobs/runner";
import { requireSession } from "@/lib/session";

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    // 生产环境硬要求 CRON_SECRET，缺失时 500 告警
    if (process.env.NODE_ENV === "production") {
      if (!cronSecret) {
        console.error("[CRON] 生产环境 CRON_SECRET 未配置，拒绝执行定时任务");
        throw new ApiError(ERROR_CODES.INTERNAL_ERROR, "CRON_SECRET 未配置", 500);
      }
      if (auth !== `Bearer ${cronSecret}`) {
        throw new ApiError(ERROR_CODES.UNAUTHORIZED, "鉴权失败", 401);
      }
      const now = new Date();
      const results = await runAllJobs(now);
      return ok({ at: now.toISOString(), results, source: "cron" });
    }

    // 非生产环境：有 cronSecret 就走 cron 鉴权，否则回落到 session
    if (cronSecret && auth === `Bearer ${cronSecret}`) {
      const now = new Date();
      const results = await runAllJobs(now);
      return ok({ at: now.toISOString(), results, source: "cron" });
    }

    // 走 session 鉴权（仅本地/测试）
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
