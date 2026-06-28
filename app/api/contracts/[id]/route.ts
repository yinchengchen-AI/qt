import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import {
  getContract,
  updateContract,
  softDeleteContract,
} from "@/server/services/contract";
import { contractUpdateSchema } from "@/lib/validators/contract";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const data = await getContract(user, id);
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
      const input = contractUpdateSchema.parse(body);
      const data = await updateContract(user, id, input);
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
      const data = await softDeleteContract(user, id);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
