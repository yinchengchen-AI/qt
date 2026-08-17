import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { importBankTransactions } from "@/server/services/reconciliation";
import { bankTransactionImportSchema } from "@/lib/validators/reconciliation";

export async function POST(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const raw = await req.json();
      const input = bankTransactionImportSchema.parse(raw);
      const data = await importBankTransactions(user, input.rows);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
