// 证书到期 cron 任务 (PR9)
// 每日扫 EmployeeCertificate expiryDate <= now + 30 天,
// 按 30 / 15 / 7 天三个阈值各发一次 Message(收件人:证书持有人 + 所有 ADMIN)。
// 去重:CertificateExpiryNotice 表(certificateId, threshold) 联合唯一。
// 触发:POST /api/jobs/certificates/expire-check(CRON_SECRET 鉴权)
import { prisma } from "@/lib/prisma";
import { emit, listAdminUserIds } from "@/server/events/bus";

const THRESHOLDS = [30, 15, 7] as const;

export type CertificateExpiryCheckResult = {
  scanned: number;
  sent: number;
  skipped: number;
  errors: number;
};

export async function runCertificateExpiryCheck(now: Date = new Date()): Promise<CertificateExpiryCheckResult> {
  const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const certs = await prisma.employeeCertificate.findMany({
    where: {
      deletedAt: null,
      expiryDate: { gte: now, lte: horizon }
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

    for (const threshold of THRESHOLDS) {
      if (daysLeft > threshold) continue;  // 还没到这一档
      try {
        // 去重:CertificateExpiryNotice @@unique(certificateId, threshold)
        // create 失败说明已经发过这一档
        const result = await prisma.certificateExpiryNotice.create({
          data: { certificateId: c.id, threshold }
        });
        // 实际发消息
        await emit(prisma, {
          type: "CERTIFICATE_EXPIRING",
          payload: {
            certificateId: c.id,
            userId,
            certName: c.name,
            expiryDate: c.expiryDate.toISOString(),
            daysLeft
          },
          receivers: [userId, ...adminIds]
        });
        sent++;
        void result;
      } catch (e) {
        // P2002 = unique violation = 已发过,跳过
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
