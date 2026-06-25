import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { updateEmployeeCertificate, deleteEmployeeCertificate } from "@/server/services/employee-certificate";
import { employeeCertificateUpdateSchema } from "@/lib/validators/employee-certificate";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      const { id } = await params;
      const input = employeeCertificateUpdateSchema.parse(await req.json());
      return ok({ data: await updateEmployeeCertificate(actor, id, input) });
    } catch (e) { return err(e); }
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      const { id } = await params;
      await deleteEmployeeCertificate(actor, id);
      return ok({ data: { id } });
    } catch (e) { return err(e); }
  });
}
