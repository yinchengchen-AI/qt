// POST /api/jobs/weekly-report
// 经营周报定时推送入口 (每周一 09:00, 见 ops/qt-jobs.cron)
// CRON_SECRET 鉴权(从请求头 x-cron-secret 读取)
// ?force=1 跳过"仅周一执行"判断, 用于手动补跑 (entityKey 周幂等兜底, 不会重复发)
import { ok, err } from "@/lib/api";
import { runWeeklyBusinessReport } from "@/server/jobs/weekly-business-report";

export async function POST(req: Request) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return new Response(JSON.stringify({ code: 401, message: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" }
    });
  }
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const result = await runWeeklyBusinessReport(new Date(), { force });
    return ok({ data: result });
  } catch (e) {
    return err(e);
  }
}
