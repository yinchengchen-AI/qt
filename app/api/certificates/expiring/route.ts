// 到期证书列表 API (ADMIN only)。
// - days=60 默认扫描窗口,只取"已过期 365 天内 + 未来 60 天内"
// - level= 精确档位过滤(expired / critical / high / medium / all / near)
// - counts 返回四个档位的命中数,供前端概览卡使用
import { ok, err } from "@/lib/api";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getExpiryStatus, statusToLevel } from "@/lib/employee-profile-expiry";

const EXPIRED_FLOOR_DAYS = 365;
const DEFAULT_HORIZON_DAYS = 60;

type Level = "expired" | "critical" | "high" | "medium" | "all" | "near";

const LEVEL_TO_RANK: Record<Level, number> = {
  expired: 0,
  critical: 1,
  high: 2,
  medium: 3,
  near: 4,
  all: 5
};

function parseLevel(v: string | null): Level {
  if (v === "expired" || v === "critical" || v === "high" || v === "medium" || v === "all" || v === "near") {
    return v;
  }
  return "near";
}

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      // P0-6: spec §6 明确仅 ADMIN 可见全公司证书到期日。
      if (actor.roleCode !== "ADMIN") {
        throw new ApiError(ERROR_CODES.FORBIDDEN, "仅管理员可查询到期证书", 403);
      }
      const url = new URL(req.url);
      const daysParam = Number(url.searchParams.get("days") ?? String(DEFAULT_HORIZON_DAYS));
      const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : DEFAULT_HORIZON_DAYS;
      const level = parseLevel(url.searchParams.get("level"));

      const now = new Date();
      const horizon = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      const expiredFloor = new Date(now.getTime() - EXPIRED_FLOOR_DAYS * 24 * 60 * 60 * 1000);

      const rows = await prisma.employeeCertificate.findMany({
        where: {
          deletedAt: null,
          expiryDate: { gte: expiredFloor, lte: horizon }
        },
        include: {
          profile: { include: { user: { select: { id: true, employeeNo: true, name: true } } } }
        },
        orderBy: { expiryDate: "asc" }
      });

      const counts = { expired: 0, critical: 0, high: 0, medium: 0 };
      const items = rows
        .map((r) => {
          if (!r.expiryDate || !r.profile?.user) return null;
          const expiryIso = r.expiryDate.toISOString();
          const status = getExpiryStatus(expiryIso, now);
          if (status.kind === "none") return null;
          const levelKey = statusToLevel(status);
          if (!levelKey) return null;
          counts[levelKey] += 1;
          if (level !== "all" && level !== "near" && LEVEL_TO_RANK[level] !== LEVEL_TO_RANK[levelKey]) {
            return null;
          }
          return {
            certificateId: r.id,
            userId: r.profile.user.id,
            employeeNo: r.profile.user.employeeNo,
            name: r.profile.user.name,
            certName: r.name,
            certNumber: r.number ?? null,
            issuer: r.issuer ?? null,
            expiryDate: expiryIso,
            daysLeft: status.kind === "expired" ? -status.days : status.days,
            level: levelKey
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      return ok({ data: items, counts, total: items.length });
    } catch (e) {
      return err(e);
    }
  });
}
