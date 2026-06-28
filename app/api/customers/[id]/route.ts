import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import {
  getCustomer,
  updateCustomer,
  softDeleteCustomer,
} from "@/server/services/customer";
import { customerUpdateSchema } from "@/lib/validators/customer";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const data = await getCustomer(user, id);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const body = await req.json();
      const input = customerUpdateSchema.parse(body);
      const data = await updateCustomer(user, id, input);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const data = await softDeleteCustomer(user, id);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
