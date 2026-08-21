import { ok, err, ApiError } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { getContractEnhancedRisk } from "@/server/services/contract/workbench";
import { ERROR_CODES } from "@/types/errors";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const data = await getContractEnhancedRisk(user, id);
      if (!data) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
