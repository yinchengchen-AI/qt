import { describe, it, expect, beforeAll, afterAll } from "vitest";

let dbReachable = false;
const cleanupIds: string[] = [];

describe("POST /api/auth/dingtalk/cancel", () => {
  beforeAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
    }
  });

  afterAll(async () => {
    if (!dbReachable) return;
    const { prisma } = await import("@/lib/prisma");
    if (cleanupIds.length > 0) {
      await prisma.dingtalkLoginCode.deleteMany({ where: { id: { in: cleanupIds } } });
    }
    await prisma.$disconnect();
  });

  it("PENDING -> EXPIRED", async () => {
    if (!dbReachable) return;
    const { prisma } = await import("@/lib/prisma");
    const row = await prisma.dingtalkLoginCode.create({
      data: { state: "test-cancel-1-" + Date.now(), tmpCode: "tc", expiresAt: new Date(Date.now() + 60_000) },
    });
    cleanupIds.push(row.id);
    const { POST } = await import("@/app/api/auth/dingtalk/cancel/route");
    const res = await POST(new Request("http://x/api/auth/dingtalk/cancel", {
      method: "POST", body: JSON.stringify({ state: row.state }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(200);
    const after = await prisma.dingtalkLoginCode.findUnique({ where: { id: row.id } });
    expect(after!.status).toBe("EXPIRED");
  });

  it("state missing -> silent 200", async () => {
    if (!dbReachable) return;
    const { POST } = await import("@/app/api/auth/dingtalk/cancel/route");
    const res = await POST(new Request("http://x/api/auth/dingtalk/cancel", {
      method: "POST", body: JSON.stringify({ state: "missing-" + Date.now() }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(200);
  });

  it("already CONSUMED -> no change (silent 200)", async () => {
    if (!dbReachable) return;
    const { prisma } = await import("@/lib/prisma");
    const row = await prisma.dingtalkLoginCode.create({
      data: {
        state: "test-cancel-consumed-" + Date.now(), tmpCode: "tc", status: "CONSUMED",
        expiresAt: new Date(Date.now() + 60_000), consumedAt: new Date(),
      },
    });
    cleanupIds.push(row.id);
    const { POST } = await import("@/app/api/auth/dingtalk/cancel/route");
    const res = await POST(new Request("http://x/api/auth/dingtalk/cancel", {
      method: "POST", body: JSON.stringify({ state: row.state }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(200);
    const after = await prisma.dingtalkLoginCode.findUnique({ where: { id: row.id } });
    expect(after!.status).toBe("CONSUMED");
  });
});