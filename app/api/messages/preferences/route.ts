import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { listPreferences, updatePreferences } from "@/server/services/message-preference";

const body = z.object({
  preferences: z
    .array(
      z.object({
        type: z.string().min(1).max(64),
        enabled: z.boolean()
      })
    )
    .min(1)
    .max(50)
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const data = await listPreferences(user);
      return ok({ preferences: data });
    } catch (e) {
      return err(e);
    }
  });
}

export async function PUT(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const json = await req.json().catch(() => ({}));
      const input = body.parse(json);
      const data = await updatePreferences(user, input.preferences);
      return ok({ preferences: data });
    } catch (e) {
      return err(e);
    }
  });
}
