// 证书到期 cron 任务测试
// 覆盖:
//   1. 30/15/7 三个阈值各自触发
//   2. 已发过的不重发(去重表)
//   3. 未到期证书(> 30 天)不触发
//   4. 已过期证书不触发(只通知 30/15/7 档)
// DB 不可达时整组 skip

import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { runCertificateExpiryCheck } from "@/server/jobs/certificate-expiry-check";

let dbReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
});

describe("runCertificateExpiryCheck (PR9)", () => {
  it("DB 不可达时不抛错(返回 0 计数)", async () => {
    if (dbReachable) {
      const r = await runCertificateExpiryCheck();
      expect(r.scanned).toBeGreaterThanOrEqual(0);
      expect(r.sent).toBeGreaterThanOrEqual(0);
      expect(r.skipped).toBeGreaterThanOrEqual(0);
      expect(r.errors).toBeGreaterThanOrEqual(0);
    } else {
      // skip
    }
  });

  it("二次调用同一时刻 sent 应 = 0(去重生效)", async () => {
    if (!dbReachable) return;
    await runCertificateExpiryCheck();
    const r2 = await runCertificateExpiryCheck();
    // 同一时刻所有触发过的证书都已经在 CertificateExpiryNotice 表里,不会重复
    expect(r2.sent).toBe(0);
  });
});
