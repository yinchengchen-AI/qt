import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import {
  getCustomer,
  updateCustomer,
  changeCustomerStatus,
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
      // 先加载现有客户, 状态未变化时不要把 status 传给 changeCustomerStatus
      // (状态机把同状态写入视为非法, 避免 noop 绕过审计)
      const existing = await getCustomer(user, id);
      if (input.status !== undefined && input.status !== existing.status) {
        await changeCustomerStatus(user, id, input.status, input.reason);
      }
      // 剩余字段走 updateCustomer; 此时 status 已单独处理, 避免被 updateCustomer 覆盖
      const { status: _status, reason: _reason, ...rest } = input;
      const data = await updateCustomer(user, id, rest);
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
