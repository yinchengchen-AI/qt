// 证书到期 cron 任务 (PR9 + P0-7 / P0-12)
// 每日扫 EmployeeCertificate:
//   - 未到期 expiryDate in [now, now+30d]:按 30/15/7 三档发提醒
//   - 已过期 expiryDate in [now-365d, now]:补发一次"已过期"提醒(阈值 -1)
//   - 其它过期超过 1 年:不补
// 去重:CertificateExpiryNotice 表(certificateId, threshold) 联合唯一
// P0-12: emit + create notice 放进同事务,emit 失败就整批回滚,不会"notice 占位但没发"
import { prisma } from "@/lib/prisma";
import { emit, listAdminUserIds } from "@/server/events/bus";

const THRESHOLDS = [30, 15, 7] as const;
// 已过期档:用一个负数"阈值"占位,跟正档共用去重表
const EXPIRED_THRESHOLD = -1;

export type CertificateExpiryCheckResult = {
  scanned: number;
  sent: number;
  skipped: number;
  errors: number;
};

export async function runCertificateExpiryCheck(now: Date = new Date()): Promise<CertificateExpiryCheckResult> {
  const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const expiredFloor = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const certs = await prisma.employeeCertificate.findMany({
    where: {
      deletedAt: null,
      // P0-7: 含已过期 365 天内的证书(spec §5.1)
      expiryDate: { gte: expiredFloor, lte: horizon }
    },
    include: {
      profile: {
        include: { user: { select: { id: true, name: true, employeeNo: true } } }
      }
    }
  });

  const adminIds = await listAdminUserIds(prisma);

  let sent = 0, skipped = 0, errors = 0;

  for (const c of certs) {
    if (!c.expiryDate || !c.profile?.user) continue;
    const userId = c.profile.user.id;
    const daysLeft = Math.floor((c.expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    // 决定要走的档:未到期 → 30/15/7;已过期 → -1
    const thresholds: number[] =
      daysLeft < 0
        ? [EXPIRED_THRESHOLD]
        : THRESHOLDS.filter((t) => daysLeft <= t);

    for (const threshold of thresholds) {
      try {
        // P0-12: emit + create notice 放进同一个 $transaction
        // emit 失败 → 整批回滚 → notice 没占位 → 下次 cron 还能再发
        await prisma.$transaction(async (tx) => {
          await emit(tx, {
            type: "CERTIFICATE_EXPIRING",
            payload: {
              certificateId: c.id,
              userId,
              certName: c.name,
              expiryDate: c.expiryDate!.toISOString(),
              daysLeft
            },
            receivers: [userId, ...adminIds]
          });
          await tx.certificateExpiryNotice.create({
            data: { certificateId: c.id, threshold }
          });
        });
        sent++;
      } catch (e) {
        if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") {
          skipped++;
        } else {
          errors++;
          console.error("[cert-expiry-check] failed", { certificateId: c.id, threshold }, e);
        }
      }
    }
  }

  return { scanned: certs.length, sent, skipped, errors };
}
