import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { createEmployeeWorkExperience, listEmployeeWorkExperiences } from "@/server/services/employee-work-experience";
import { employeeWorkExperienceCreateSchema } from "@/lib/validators/employee-work-experience";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      const url = new URL(req.url);
      const profileId = url.searchParams.get("profileId");
      if (!profileId) return ok({ data: [] });
      return ok({ data: await listEmployeeWorkExperiences(actor, profileId) });
    } catch (e) { return err(e); }
  });
}

export async function POST(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      const body = await req.json();
      const input = employeeWorkExperienceCreateSchema.parse(body);
      return ok({ data: await createEmployeeWorkExperience(actor, input) });
    } catch (e) { return err(e); }
  });
}
