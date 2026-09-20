import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { listInvoices, createInvoice } from "@/server/services/invoice";
import { invoiceCreateSchema, invoiceListQuerySchema } from "@/lib/validators/invoice";
import { z } from "zod";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const params = invoiceListQuerySchema.parse(Object.fromEntries(url.searchParams));
      const data = await listInvoices(user, params);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}

/**
 * admin/财务 完结合同补开发票的 body 扩展 (force + forceReason).
 * 普通调用方 (SALES/EXPERT) 不传 force, 走原有流程.
 * ADMIN/FINANCE 在合同为 CLOSED 时可传 force=true + forceReason 旁路 ACTIVE 校验.
 *
 * 安全约束: 服务端会在 createInvoice 里再次校验角色,
 *          非 ADMIN/FINANCE 即便前端塞了 force=true 也会被 403 拒绝.
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
      const input = invoiceCreateSchema.parse(rawBody);
      // force 字段独立 schema 校验, 不耦合到 invoiceCreateSchema (避免污染前端类型)
      const overlay = forceOverlaySchema.parse(rawBody);
      const data = await createInvoice(user, input, {
        force: overlay.force,
        forceReason: overlay.forceReason,
      });
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
