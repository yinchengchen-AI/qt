import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { updateEmployeeEducation, deleteEmployeeEducation } from "@/server/services/employee-education";
import { employeeEducationUpdateSchema } from "@/lib/validators/employee-education";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      const { id } = await params;
      const input = employeeEducationUpdateSchema.parse(await req.json());
      return ok({ data: await updateEmployeeEducation(actor, id, input) });
    } catch (e) { return err(e); }
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      const { id } = await params;
      await deleteEmployeeEducation(actor, id);
      return ok({ data: { id } });
    } catch (e) { return err(e); }
  });
}
