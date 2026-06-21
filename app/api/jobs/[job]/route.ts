// 定时任务入口：POST /api/jobs/{job}
// - job=run-all：跑全部 5 个
// - job=contract-expiring / invoice-overdue / project-due / customer-inactive / contract-expiry：单跑
// 鉴权：仅 ADMIN 可调；生产环境建议用 CRON_SECRET header
import { z } from "zod";
import { ok, err, ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { requireSession } from "@/lib/session";
import { runAllJobs, contractExpiringJob, invoiceOverdueJob, projectDueJob, customerInactiveJob, runContractExpiryJob } from "@/server/jobs/runner";

const jobEnum = z.enum(["run-all", "contract-expiring", "invoice-overdue", "project-due", "customer-inactive", "contract-expiry"]);

export async function POST(_req: Request, { params }: { params: Promise<{ job: string }> }) {
  try {
    const user = await requireSession();
    if (user.roleCode !== "ADMIN") {
      throw new ApiError(ERROR_CODES.FORBIDDEN, "仅管理员可触发定时任务", 403);
    }
    const { job } = await params;
    const parsed = jobEnum.parse(job);
    const now = new Date();
    const results =
      parsed === "run-all"
        ? await runAllJobs(now)
        : parsed === "contract-expiring"
        ? [await contractExpiringJob(now)]
        : parsed === "invoice-overdue"
        ? [await invoiceOverdueJob(now)]
        : parsed === "project-due"
        ? [await projectDueJob(now)]
        : parsed === "contract-expiry"
        ? [await runContractExpiryJob(now)]
        : [await customerInactiveJob(now)];
    return ok({ at: now.toISOString(), results });
  } catch (e) {
    return err(e);
  }
}
