import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { getEmployeeProfile, updateEmployeeProfile } from "@/server/services/employee-profile";
import { employeeProfileUpdateSchema } from "@/lib/validators/employee-profile";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const data = await getEmployeeProfile(user, id);
      return ok({ data });
    } catch (e) {
      return err(e);
    }
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const body = await req.json();
      const input = employeeProfileUpdateSchema.parse(body);
      const data = await updateEmployeeProfile(user, id, input);
      return ok({ data });
    } catch (e) {
      return err(e);
    }
  });
}
