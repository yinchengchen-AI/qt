import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { updateEmployeeEmergencyContact, deleteEmployeeEmergencyContact } from "@/server/services/employee-emergency-contact";
import { employeeEmergencyContactUpdateSchema } from "@/lib/validators/employee-emergency-contact";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      const { id } = await params;
      const input = employeeEmergencyContactUpdateSchema.parse(await req.json());
      return ok({ data: await updateEmployeeEmergencyContact(actor, id, input) });
    } catch (e) { return err(e); }
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      const { id } = await params;
      await deleteEmployeeEmergencyContact(actor, id);
      return ok({ data: { id } });
    } catch (e) { return err(e); }
  });
}
