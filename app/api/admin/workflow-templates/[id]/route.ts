import { z } from "zod";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getTemplate, updateTemplate } from "@/server/services/workflow-template";

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional()
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const data = await getTemplate(user, id);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const body = await req.json();
    const input = patchSchema.parse(body);
    const data = await updateTemplate(user, id, input);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
