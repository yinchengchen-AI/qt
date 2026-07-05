import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { runCleanExpiredDingtalkCodes } from "@/server/jobs/clean-expired-dingtalk-codes";

let dbReachable = false;
const createdIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
});

afterAll(async () => {
  if (!dbReachable) return;
  if (createdIds.length > 0) {
    await prisma.dingtalkLoginCode.deleteMany({ where: { id: { in: createdIds } } });
  }
  await prisma.$disconnect();
});

describe("cleanExpiredDingtalkCodes", () => {
  it("removes PENDING/EXPIRED/CANCELLED with expiresAt < now-1d", async () => {
    if (!dbReachable) return;
    const oldPending = await prisma.dingtalkLoginCode.create({
      data: { state: "test-old-pending-" + Date.now(), tmpCode: "x", status: "PENDING", expiresAt: new Date(Date.now() - 2 * 86400_000) },
    });
    const oldExpired = await prisma.dingtalkLoginCode.create({
      data: { state: "test-old-expired-" + Date.now(), tmpCode: "x", status: "EXPIRED", expiresAt: new Date(Date.now() - 2 * 86400_000) },
    });
    const newPending = await prisma.dingtalkLoginCode.create({
      data: { state: "test-new-pending-" + Date.now(), tmpCode: "x", status: "PENDING", expiresAt: new Date(Date.now() + 60_000) },
    });
    const consumed = await prisma.dingtalkLoginCode.create({
      data: { state: "test-old-consumed-" + Date.now(), tmpCode: "x", status: "CONSUMED", expiresAt: new Date(Date.now() - 2 * 86400_000) },
    });
    createdIds.push(newPending.id, consumed.id);

    const r = await runCleanExpiredDingtalkCodes();
    expect(r.deleted).toBeGreaterThanOrEqual(2);

    const after = await prisma.dingtalkLoginCode.findMany({ where: { id: { in: [oldPending.id, oldExpired.id] } } });
    expect(after.length).toBe(0);
    const keptNew = await prisma.dingtalkLoginCode.findUnique({ where: { id: newPending.id } });
    expect(keptNew).toBeTruthy();
    const keptConsumed = await prisma.dingtalkLoginCode.findUnique({ where: { id: consumed.id } });
    expect(keptConsumed).toBeTruthy();
  });
});