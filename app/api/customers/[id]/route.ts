import { z } from "zod";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getCustomer, updateCustomer, changeCustomerStatus, softDeleteCustomer } from "@/server/services/customer";
import { customerUpdateSchema } from "@/lib/validators/customer";

const statusBody = z.object({ status: z.enum(["LEAD", "NEGOTIATING", "SIGNED", "LOST", "FROZEN"]) });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const data = await getCustomer(user, id);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const body = await req.json();
    if (body && typeof body === "object" && "status" in body && Object.keys(body).length === 1) {
      const { status } = statusBody.parse(body);
      const data = await changeCustomerStatus(user, id, status);
      return ok(data);
    }
    const input = customerUpdateSchema.parse(body);
    const data = await updateCustomer(user, id, input);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const data = await softDeleteCustomer(user, id);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
