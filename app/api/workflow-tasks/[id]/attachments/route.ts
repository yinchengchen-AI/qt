import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { addTaskAttachment } from "@/server/services/workflow";

const schema = z.object({ attachmentId: z.string().min(1) });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const body = await req.json();
      const input = schema.parse(body);
      const data = await addTaskAttachment(user, id, input.attachmentId);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
