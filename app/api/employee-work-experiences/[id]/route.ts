import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { updateEmployeeWorkExperience, deleteEmployeeWorkExperience } from "@/server/services/employee-work-experience";
import { employeeWorkExperienceUpdateSchema } from "@/lib/validators/employee-work-experience";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      const { id } = await params;
      const input = employeeWorkExperienceUpdateSchema.parse(await req.json());
      return ok({ data: await updateEmployeeWorkExperience(actor, id, input) });
    } catch (e) { return err(e); }
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      const { id } = await params;
      await deleteEmployeeWorkExperience(actor, id);
      return ok({ data: { id } });
    } catch (e) { return err(e); }
  });
}
