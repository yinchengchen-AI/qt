import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import {
  listDepartments,
  createDepartment,
} from "@/server/services/department";
import {
  departmentCreateSchema,
  departmentListQuerySchema,
} from "@/lib/validators/department";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const params = departmentListQuerySchema.parse(
        Object.fromEntries(url.searchParams),
      );
      const data = await listDepartments(user, params);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}

export async function POST(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const body = await req.json();
      const input = departmentCreateSchema.parse(body);
      const data = await createDepartment(user, input);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
