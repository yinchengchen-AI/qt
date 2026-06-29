import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { listPayments, createPayment } from "@/server/services/payment";
import { paymentCreateSchema, paymentListQuerySchema } from "@/lib/validators/payment";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const params = paymentListQuerySchema.parse(Object.fromEntries(url.searchParams));
      const data = await listPayments(user, params);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}

/**
 * admin 强制录回款的 body 扩展 (force + forceReason).
 * 普通调用方 (FINANCE/SALES) 不传 force, 走原有流程.
 * ADMIN 在合同为 CLOSED 时可传 force=true + forceReason 旁路 ACTIVE 校验.
 *
 * 安全约束: 服务端会在 createPayment 里再次校验 user.roleCode === "ADMIN",
 *          非 ADMIN 即便前端塞了 force=true 也会被 403 拒绝.
 */
const forceOverlaySchema = z.object({
  force: z.boolean().optional(),
  forceReason: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const rawBody = await req.json();
      const input = paymentCreateSchema.parse(rawBody);
      // force 字段独立 schema 校验, 不耦合到 paymentCreateSchema (避免污染前端类型)
      const overlay = forceOverlaySchema.parse(rawBody);
      const data = await createPayment(user, input, {
        force: overlay.force,
        forceReason: overlay.forceReason,
      });
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
