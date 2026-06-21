import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { moveDepartment } from "@/server/services/department";
import { departmentMoveSchema } from "@/lib/validators/department";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const body = await req.json();
      const { parentId } = departmentMoveSchema.parse(body);
      const data = await moveDepartment(user, id, parentId);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
