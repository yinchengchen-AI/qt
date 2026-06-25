import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      requirePermission(actor.roleCode, RESOURCE.USER, ACTION.READ);
      const url = new URL(req.url);
      const days = Number(url.searchParams.get("days") ?? "60");
      if (!Number.isFinite(days) || days <= 0) {
        return ok({ data: [] });
      }
      const now = new Date();
      const horizon = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

      const rows = await prisma.employeeCertificate.findMany({
        where: {
          deletedAt: null,
          expiryDate: { gte: now, lte: horizon }
        },
        include: {
          profile: { include: { user: { select: { id: true, employeeNo: true, name: true } } } }
        },
        orderBy: { expiryDate: "asc" }
      });

      return ok({
        data: rows.map((r) => ({
          certificateId: r.id,
          userId: r.profile.user.id,
          employeeNo: r.profile.user.employeeNo,
          name: r.profile.user.name,
          certName: r.name,
          expiryDate: r.expiryDate!.toISOString(),
          daysLeft: Math.floor((r.expiryDate!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        }))
      });
    } catch (e) {
      return err(e);
    }
  });
}
