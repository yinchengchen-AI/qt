import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { createEmployeeSkill, listEmployeeSkills } from "@/server/services/employee-skill";
import { employeeSkillCreateSchema } from "@/lib/validators/employee-skill";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      const url = new URL(req.url);
      const profileId = url.searchParams.get("profileId");
      if (!profileId) return ok({ data: [] });
      return ok({ data: await listEmployeeSkills(actor, profileId) });
    } catch (e) { return err(e); }
  });
}

export async function POST(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      const body = await req.json();
      const input = employeeSkillCreateSchema.parse(body);
      return ok({ data: await createEmployeeSkill(actor, input) });
    } catch (e) { return err(e); }
  });
}
