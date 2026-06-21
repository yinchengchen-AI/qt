import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { reviewContract } from "@/server/services/contract";

const schema = z.object({ comment: z.string().max(500).optional() });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const body = await req.json().catch(() => ({}));
      const parsed = schema.parse(body);
      const data = await reviewContract(user, id, {
        action: "APPROVE",
        ...parsed,
      });
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
