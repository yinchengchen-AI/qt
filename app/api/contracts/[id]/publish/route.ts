import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { publishContract } from "@/server/services/contract";

/**
 * admin 强制发布: DRAFT → ACTIVE 兜底入口
 * 正常情况下 createContract / updateContract 已自动触发, 这里是 admin 在字段/附件不满足自动条件时的兜底
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const data = await publishContract(user, id);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
