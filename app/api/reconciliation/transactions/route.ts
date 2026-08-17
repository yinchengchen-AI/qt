import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { listBankTransactions } from "@/server/services/reconciliation";
import { bankTransactionListQuerySchema } from "@/lib/validators/reconciliation";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const params = bankTransactionListQuerySchema.parse(Object.fromEntries(url.searchParams));
      const data = await listBankTransactions(user, params);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
