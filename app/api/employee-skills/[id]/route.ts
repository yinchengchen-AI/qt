import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { updateEmployeeSkill, deleteEmployeeSkill } from "@/server/services/employee-skill";
import { employeeSkillUpdateSchema } from "@/lib/validators/employee-skill";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      const { id } = await params;
      const input = employeeSkillUpdateSchema.parse(await req.json());
      return ok({ data: await updateEmployeeSkill(actor, id, input) });
    } catch (e) { return err(e); }
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      const { id } = await params;
      await deleteEmployeeSkill(actor, id);
      return ok({ data: { id } });
    } catch (e) { return err(e); }
  });
}
