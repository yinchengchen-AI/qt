import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { createEmployeeEducation, listEmployeeEducations } from "@/server/services/employee-education";
import { employeeEducationCreateSchema } from "@/lib/validators/employee-education";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      const url = new URL(req.url);
      const profileId = url.searchParams.get("profileId");
      if (!profileId) return ok({ data: [] });
      return ok({ data: await listEmployeeEducations(actor, profileId) });
    } catch (e) { return err(e); }
  });
}

export async function POST(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      const body = await req.json();
      const input = employeeEducationCreateSchema.parse(body);
      return ok({ data: await createEmployeeEducation(actor, input) });
    } catch (e) { return err(e); }
  });
}
