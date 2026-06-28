import { ok, err } from "@/lib/api";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      // P0-6: spec §6 明确只 ADMIN 可看全公司证书到期日。
      // SALES / FINANCE / OPS / EXPERT 拿 RESOURCE.USER READ 没意义,
      // 直接卡死角色。
      if (actor.roleCode !== "ADMIN") {
        throw new ApiError(ERROR_CODES.FORBIDDEN, "仅管理员可查看到期证书", 403);
      }
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
          // P0-7: spec §5.1 含"已过期 365 天内",不光未到期
          expiryDate: { gte: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000), lte: horizon }
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
