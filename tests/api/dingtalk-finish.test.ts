import { describe, it, expect, beforeAll, afterAll } from "vitest";

let dbReachable = false;
const cleanupIdentityIds: string[] = [];
const cleanupCodeIds: string[] = [];
const cleanupUserTouched: string[] = [];

describe("POST /api/auth/dingtalk/finish", () => {
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
    if (cleanupIdentityIds.length > 0) {
      await prisma.userIdentity.deleteMany({ where: { id: { in: cleanupIdentityIds } } });
    }
    if (cleanupCodeIds.length > 0) {
      await prisma.dingtalkLoginCode.deleteMany({ where: { id: { in: cleanupCodeIds } } });
    }
    if (cleanupUserTouched.length > 0) {
      await prisma.user.updateMany({
        where: { id: { in: cleanupUserTouched } },
        data: { dingtalkBoundAt: null },
      });
    }
    await prisma.$disconnect();
  });

  it("state missing -> 404", async () => {
    if (!dbReachable) return;
    const { POST } = await import("@/app/api/auth/dingtalk/finish/route");
    const res = await POST(new Request("http://x/api/auth/dingtalk/finish", {
      method: "POST", body: JSON.stringify({ state: "missing" }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(404);
  });

  it("PENDING state -> 409 DINGTALK_STATE_NOT_READY", async () => {
    if (!dbReachable) return;
    const { prisma } = await import("@/lib/prisma");
    const row = await prisma.dingtalkLoginCode.create({
      data: { state: "test-finish-pending", tmpCode: "tc", expiresAt: new Date(Date.now() + 60_000) },
    });
    cleanupCodeIds.push(row.id);
    const { POST } = await import("@/app/api/auth/dingtalk/finish/route");
    const res = await POST(new Request("http://x/api/auth/dingtalk/finish", {
      method: "POST", body: JSON.stringify({ state: "test-finish-pending" }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.errorCode).toBe("DINGTALK_STATE_NOT_READY");
  });

  it("unionid already bound + READY -> set cookie + 200", async () => {
    if (!dbReachable) return;
    const { prisma } = await import("@/lib/prisma");
    const u = await prisma.user.findFirst({ where: { deletedAt: null, status: "ACTIVE", isSystem: false } });
    if (!u || !u.phone) return;
    const ident = await prisma.userIdentity.create({
      data: { userId: u.id, provider: "DINGTALK", providerUserId: "test-unionid-bound", boundBy: "TEST" },
    });
    cleanupIdentityIds.push(ident.id);
    const code = await prisma.dingtalkLoginCode.create({
      data: {
        state: "test-finish-bound", tmpCode: "tc", status: "READY",
        unionid: "test-unionid-bound", mobile: u.phone,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    cleanupCodeIds.push(code.id);
    cleanupUserTouched.push(u.id);

    const { POST } = await import("@/app/api/auth/dingtalk/finish/route");
    const res = await POST(new Request("http://x/api/auth/dingtalk/finish", {
      method: "POST", body: JSON.stringify({ state: "test-finish-bound" }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") || "";
    expect(cookie).toMatch(/next-auth\.session-token/);
    const after = await prisma.dingtalkLoginCode.findUnique({ where: { id: code.id } });
    expect(after!.status).toBe("CONSUMED");
  });

  it("unionid not bound + mobile matched -> auto create identity", async () => {
    if (!dbReachable) return;
    const { prisma } = await import("@/lib/prisma");
    const u = await prisma.user.findFirst({ where: { deletedAt: null, status: "ACTIVE", isSystem: false, phone: { not: null } } });
    if (!u || !u.phone) return;
    const unionid = "test-unionid-newbind-" + Date.now();
    const code = await prisma.dingtalkLoginCode.create({
      data: {
        state: "test-finish-newbind-" + Date.now(), tmpCode: "tc", status: "READY",
        unionid, mobile: u.phone,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    cleanupCodeIds.push(code.id);
    cleanupUserTouched.push(u.id);

    const { POST } = await import("@/app/api/auth/dingtalk/finish/route");
    const res = await POST(new Request("http://x/api/auth/dingtalk/finish", {
      method: "POST", body: JSON.stringify({ state: code.state }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(200);
    const ident = await prisma.userIdentity.findUnique({
      where: { provider_providerUserId: { provider: "DINGTALK", providerUserId: unionid } },
    });
    expect(ident).toBeTruthy();
    expect(ident!.userId).toBe(u.id);
    cleanupIdentityIds.push(ident!.id);
    const updated = await prisma.user.findUnique({ where: { id: u.id } });
    expect(updated!.dingtalkBoundAt).toBeTruthy();
  });

  it("unionid not bound + mobile 0 -> 401 DINGTALK_PHONE_NOT_REGISTERED, not consumed", async () => {
    if (!dbReachable) return;
    const { prisma } = await import("@/lib/prisma");
    const code = await prisma.dingtalkLoginCode.create({
      data: {
        state: "test-finish-unregistered-" + Date.now(), tmpCode: "tc", status: "READY",
        unionid: "test-unionid-orphan-" + Date.now(), mobile: "19999999999",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    cleanupCodeIds.push(code.id);
    const { POST } = await import("@/app/api/auth/dingtalk/finish/route");
    const res = await POST(new Request("http://x/api/auth/dingtalk/finish", {
      method: "POST", body: JSON.stringify({ state: code.state }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.errorCode).toBe("DINGTALK_PHONE_NOT_REGISTERED");
    const after = await prisma.dingtalkLoginCode.findUnique({ where: { id: code.id } });
    expect(after!.status).toBe("READY");
  });

  it("user disabled -> 401 DINGTALK_USER_DISABLED + CONSUMED", async () => {
    if (!dbReachable) return;
    const { prisma } = await import("@/lib/prisma");
    const role = await prisma.role.findFirst({ where: { code: "ADMIN" } });
    if (!role) return;
    const u = await prisma.user.create({
      data: {
        employeeNo: "test-dingtalk-disabled-" + Date.now(), name: "x",
        email: "x-dingtalk-disabled-" + Date.now() + "@test.local",
        passwordHash: "x",
        roleId: role.id, status: "DISABLED", phone: "138" + String(Date.now()).slice(-9),
      },
    });
    cleanupUserTouched.push(u.id);
    const ident = await prisma.userIdentity.create({
      data: { userId: u.id, provider: "DINGTALK", providerUserId: "test-unionid-disabled-" + Date.now(), boundBy: "TEST" },
    });
    cleanupIdentityIds.push(ident.id);
    const code = await prisma.dingtalkLoginCode.create({
      data: {
        state: "test-finish-disabled-" + Date.now(), tmpCode: "tc", status: "READY",
        unionid: ident.providerUserId, mobile: u.phone,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    cleanupCodeIds.push(code.id);
    const { POST } = await import("@/app/api/auth/dingtalk/finish/route");
    const res = await POST(new Request("http://x/api/auth/dingtalk/finish", {
      method: "POST", body: JSON.stringify({ state: code.state }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.errorCode).toBe("DINGTALK_USER_DISABLED");
    const after = await prisma.dingtalkLoginCode.findUnique({ where: { id: code.id } });
    expect(after!.status).toBe("CONSUMED");
  });

  it("concurrent finish same state -> 1 success 1 returns 409", async () => {
    if (!dbReachable) return;
    const { prisma } = await import("@/lib/prisma");
    const u = await prisma.user.findFirst({ where: { deletedAt: null, status: "ACTIVE", isSystem: false, phone: { not: null } } });
    if (!u || !u.phone) return;
    cleanupUserTouched.push(u.id);
    const unionid = "test-unionid-race-" + Date.now();
    const ident = await prisma.userIdentity.create({
      data: { userId: u.id, provider: "DINGTALK", providerUserId: unionid, boundBy: "TEST" },
    });
    cleanupIdentityIds.push(ident.id);
    const code = await prisma.dingtalkLoginCode.create({
      data: {
        state: "test-finish-race-" + Date.now(), tmpCode: "tc", status: "READY",
        unionid, mobile: u.phone,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    cleanupCodeIds.push(code.id);
    const { POST } = await import("@/app/api/auth/dingtalk/finish/route");
    const [r1, r2] = await Promise.all([
      POST(new Request("http://x/api/auth/dingtalk/finish", { method: "POST", body: JSON.stringify({ state: code.state }), headers: { "content-type": "application/json" } })),
      POST(new Request("http://x/api/auth/dingtalk/finish", { method: "POST", body: JSON.stringify({ state: code.state }), headers: { "content-type": "application/json" } })),
    ]);
    const codes = [r1.status, r2.status].sort();
    expect(codes).toEqual([200, 409]);
  });
});