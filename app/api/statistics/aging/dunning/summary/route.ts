// 催收汇总卡片
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getDunningSummary } from "@/server/services/dunning";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const data = await getDunningSummary(user);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
