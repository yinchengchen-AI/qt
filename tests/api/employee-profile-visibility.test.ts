// 员工档案可见性收紧回归 (plan: .omo/plans/role-browse-permissions.md todo 2)
//
// 规则:
//   - 完整员工档案 (getEmployeeProfile / getUserFullProfile / 5 子表 list / with-profile 路由)
//     仅 本人 / ADMIN / OPS 可见; SALES / FINANCE / EXPERT 一律 403。
//   - 敏感字段: 本人与 ADMIN 看全量(含 salary); OPS 看他人时仅 salary 置 null,
//     idCard / bankAccount / bankName 等仍可见。
//   - /api/certificates/expiring: ADMIN + OPS → 200, 其余角色 403。
//   - 员工档案附件 (canReadAttachment): 仅 上传者 / 档案本人 / ADMIN / OPS 可读,
//     FINANCE 的全员放行不再覆盖档案附件 (PII, 含身份证照)。
//
// DB 不可达时整组 skip (与 tests/api/ownership-isolation.test.ts 同模式)。
// 路由用例通过 vi.mock("@/lib/session") 注入 actor, 断言行进 HTTP status。

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";

import { getEmployeeProfile, getUserFullProfile, updateEmployeeProfile } from "@/server/services/employee-profile";
import { listEmployeeEducations } from "@/server/services/employee-education";
import { canReadAttachment, getAttachmentForRead } from "@/server/storage/presign";
import { GET as getExpiringCertificates } from "@/app/api/certificates/expiring/route";
import { GET as getWithProfile } from "@/app/api/users/[id]/with-profile/route";

function mkUser(roleCode: SessionUser["roleCode"], id: string): SessionUser {
  return { id, employeeNo: id, name: id, email: `${id}@t.local`, roleCode, permissions: [] };
}

// 路由测试用: mock requireSession 返回当前 actor (per-case 注入)
const sessionHolder = vi.hoisted(() => ({ actor: null as SessionUser | null }));
vi.mock("@/lib/session", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/session")>();
  return {
    ...mod,
    requireSession: async (): Promise<SessionUser> => {
      if (!sessionHolder.actor) throw new ApiError(ERROR_CODES.UNAUTHORIZED, "请先登录", 401);
      return sessionHolder.actor;
    }
  };
});

const SENSITIVE = {
  idCard: "110101199001011237",
  bankAccount: "6222021234567890123",
  bankName: "工商银行",
  salary: 15000,
  position: "可见性测试岗"
};

let dbReachable = false;
let adminId: string | null = null;
let salesId: string | null = null;
let opsId: string | null = null;
let financeId: string | null = null;
let targetUserId: string | null = null;
let targetProfileId: string | null = null;
let targetAttachmentId: string | null = null;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const [adminRow, salesRow, opsRow, financeRow, anyRole] = await Promise.all([
    prisma.user.findFirst({ where: { role: { code: "ADMIN" }, deletedAt: null }, select: { id: true } }),
    prisma.user.findFirst({ where: { role: { code: "SALES" }, deletedAt: null, isSystem: false }, select: { id: true } }),
    prisma.user.findFirst({ where: { role: { code: "OPS" }, deletedAt: null, isSystem: false }, select: { id: true } }),
    prisma.user.findFirst({ where: { role: { code: "FINANCE" }, deletedAt: null, isSystem: false }, select: { id: true } }),
    prisma.role.findFirst({ select: { id: true } })
  ]);
  if (!adminRow || !anyRole) {
    dbReachable = false;
    return;
  }
  adminId = adminRow.id;
  salesId = salesRow?.id ?? null;
  opsId = opsRow?.id ?? null;
  financeId = financeRow?.id ?? null;

  // 建一个带完整敏感字段档案的临时用户作为"他人"
  const ts = Date.now();
  const target = await prisma.user.create({
    data: {
      employeeNo: `VIS_${ts}`,
      name: "可见性测试-他人",
      email: `vis_${ts}@qt.local`,
      passwordHash: "x",
      roleId: anyRole.id
    }
  });
  targetUserId = target.id;
  // 走 service 写入,保证敏感字段按生产路径加密落库
  await updateEmployeeProfile(mkUser("ADMIN", adminId), target.id, { ...SENSITIVE });
  const profile = await prisma.employeeProfile.findUnique({ where: { userId: target.id }, select: { id: true } });
  targetProfileId = profile?.id ?? null;
  if (targetProfileId) {
    const att = await prisma.attachment.create({
      data: {
        objectKey: `visibility-test/${ts}`,
        bucket: "visibility-test",
        originalName: "vis-test.pdf",
        mimeType: "application/pdf",
        size: 1,
        uploadedById: adminId,
        employeeProfileId: targetProfileId
      },
      select: { id: true }
    });
    targetAttachmentId = att.id;
  }
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
    if (targetAttachmentId) {
      await prisma.attachment.deleteMany({ where: { id: targetAttachmentId } });
    }
    if (targetProfileId) {
      await prisma.operationLog.deleteMany({ where: { entity: "EmployeeProfile", entityId: targetProfileId } });
      await prisma.employeeProfile.deleteMany({ where: { id: targetProfileId } });
    }
    if (targetUserId) {
      await prisma.user.deleteMany({ where: { id: targetUserId } });
    }
  } catch {
    // ignore cleanup errors
  }
  await prisma.$disconnect();
});

const itDb = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable || !targetUserId || !targetProfileId) return;
    await fn();
  });

describe("getEmployeeProfile 可见性", () => {
  itDb("SALES 读他人档案 → 403 FORBIDDEN", async () => {
    const actor = mkUser("SALES", salesId ?? "vis-sales-other");
    if (actor.id === targetUserId) actor.id = "vis-sales-other";
    await expect(getEmployeeProfile(actor, targetUserId!)).rejects.toMatchObject({
      status: 403,
      errorCode: ERROR_CODES.FORBIDDEN
    });
  });

  itDb("FINANCE 读他人档案 → 403 FORBIDDEN", async () => {
    const actor = mkUser("FINANCE", financeId ?? "vis-finance-other");
    if (actor.id === targetUserId) actor.id = "vis-finance-other";
    await expect(getEmployeeProfile(actor, targetUserId!)).rejects.toMatchObject({
      status: 403,
      errorCode: ERROR_CODES.FORBIDDEN
    });
  });

  itDb("EXPERT 读他人档案 → 403 FORBIDDEN", async () => {
    await expect(getEmployeeProfile(mkUser("EXPERT", "vis-expert-other"), targetUserId!)).rejects.toMatchObject({
      status: 403,
      errorCode: ERROR_CODES.FORBIDDEN
    });
  });

  itDb("本人读自己 → 200 且含 salary / idCard (解密后明文)", async () => {
    const out = await getEmployeeProfile(mkUser("SALES", targetUserId!), targetUserId!);
    expect(out).toBeTruthy();
    expect(out?.salary).toBe(SENSITIVE.salary);
    expect(out?.idCard).toBe(SENSITIVE.idCard);
    expect(out?.bankAccount).toBe(SENSITIVE.bankAccount);
  });

  itDb("OPS 读他人 → 200, salary 为 null 但 idCard / bank 字段保留", async () => {
    const out = await getEmployeeProfile(mkUser("OPS", opsId ?? "vis-ops"), targetUserId!);
    expect(out).toBeTruthy();
    expect(out?.salary).toBeNull();
    expect(out?.idCard).toBe(SENSITIVE.idCard);
    expect(out?.bankAccount).toBe(SENSITIVE.bankAccount);
    expect(out?.bankName).toBe(SENSITIVE.bankName);
    expect(out?.position).toBe(SENSITIVE.position);
  });

  itDb("ADMIN 读他人 → 200 全量 (含 salary)", async () => {
    const out = await getEmployeeProfile(mkUser("ADMIN", adminId!), targetUserId!);
    expect(out).toBeTruthy();
    expect(out?.salary).toBe(SENSITIVE.salary);
    expect(out?.idCard).toBe(SENSITIVE.idCard);
  });
});

describe("getUserFullProfile 可见性", () => {
  itDb("SALES 读他人 full profile → 403 FORBIDDEN", async () => {
    await expect(getUserFullProfile(mkUser("SALES", "vis-sales-other"), targetUserId!)).rejects.toMatchObject({
      status: 403,
      errorCode: ERROR_CODES.FORBIDDEN
    });
  });

  itDb("OPS 读他人 full profile → salary null, 5 子表数组正常返回", async () => {
    const out = await getUserFullProfile(mkUser("OPS", opsId ?? "vis-ops"), targetUserId!);
    expect(out).toBeTruthy();
    expect(out?.profile.salary).toBeNull();
    expect(out?.profile.idCard).toBe(SENSITIVE.idCard);
    expect(Array.isArray(out?.educations)).toBe(true);
    expect(Array.isArray(out?.workExperiences)).toBe(true);
    expect(Array.isArray(out?.certificates)).toBe(true);
    expect(Array.isArray(out?.skills)).toBe(true);
    expect(Array.isArray(out?.emergencyContacts)).toBe(true);
  });
});

describe("子表 list 可见性 (employee-education)", () => {
  itDb("SALES list 他人 profileId → 403 FORBIDDEN", async () => {
    await expect(listEmployeeEducations(mkUser("SALES", "vis-sales-other"), targetProfileId!)).rejects.toMatchObject({
      status: 403,
      errorCode: ERROR_CODES.FORBIDDEN
    });
  });

  itDb("本人 list 自己 → 200 数组", async () => {
    const out = await listEmployeeEducations(mkUser("SALES", targetUserId!), targetProfileId!);
    expect(Array.isArray(out)).toBe(true);
  });

  itDb("OPS list 他人 → 200 数组", async () => {
    const out = await listEmployeeEducations(mkUser("OPS", opsId ?? "vis-ops"), targetProfileId!);
    expect(Array.isArray(out)).toBe(true);
  });

  itDb("ADMIN list 不存在的 profileId → 404 NOT_FOUND (非 500)", async () => {
    await expect(listEmployeeEducations(mkUser("ADMIN", adminId!), "non-existent-profile-id")).rejects.toMatchObject({
      status: 404,
      errorCode: ERROR_CODES.NOT_FOUND
    });
  });
});

describe("/api/certificates/expiring 路由角色门", () => {
  const call = () => getExpiringCertificates(new Request("http://localhost/api/certificates/expiring?days=60"));

  itDb("OPS → 200", async () => {
    sessionHolder.actor = mkUser("OPS", opsId ?? "vis-ops");
    const res = await call();
    expect(res.status).toBe(200);
  });

  itDb("ADMIN → 200", async () => {
    sessionHolder.actor = mkUser("ADMIN", adminId!);
    const res = await call();
    expect(res.status).toBe(200);
  });

  itDb("SALES → 403", async () => {
    sessionHolder.actor = mkUser("SALES", "vis-sales-other");
    const res = await call();
    expect(res.status).toBe(403);
  });

  itDb("FINANCE → 403", async () => {
    sessionHolder.actor = mkUser("FINANCE", "vis-finance-other");
    const res = await call();
    expect(res.status).toBe(403);
  });
});

describe("/api/users/[id]/with-profile 路由", () => {
  const call = (id: string) =>
    getWithProfile(new Request(`http://localhost/api/users/${id}/with-profile`), {
      params: Promise.resolve({ id })
    });

  itDb("SALES 读他人 → 403", async () => {
    sessionHolder.actor = mkUser("SALES", "vis-sales-other");
    const res = await call(targetUserId!);
    expect(res.status).toBe(403);
  });

  itDb("OPS 读他人 → 200 且 salary 为 null", async () => {
    sessionHolder.actor = mkUser("OPS", opsId ?? "vis-ops");
    const res = await call(targetUserId!);
    expect(res.status).toBe(200);
    // 路由返回 ok({ data }) → body 形状 { code: 0, data: { data: FullEmployeeProfileDto } }
    const body = (await res.json()) as { data: { data: { profile: { salary: number | null; idCard: string | null } } } };
    expect(body.data.data.profile.salary).toBeNull();
    expect(body.data.data.profile.idCard).toBe(SENSITIVE.idCard);
  });
});

describe("员工档案附件 canReadAttachment", () => {
  itDb("档案本人 → true", async () => {
    const att = await getAttachmentForRead(targetAttachmentId!);
    expect(att).toBeTruthy();
    await expect(canReadAttachment(att!, targetUserId!)).resolves.toBe(true);
  });

  itDb("OPS → true", async () => {
    if (!opsId) return;
    const att = await getAttachmentForRead(targetAttachmentId!);
    await expect(canReadAttachment(att!, opsId)).resolves.toBe(true);
  });

  itDb("SALES 非本人 → false", async () => {
    if (!salesId || salesId === targetUserId) return;
    const att = await getAttachmentForRead(targetAttachmentId!);
    await expect(canReadAttachment(att!, salesId)).resolves.toBe(false);
  });

  itDb("FINANCE → false (档案附件不走 FINANCE 全员放行)", async () => {
    if (!financeId || financeId === targetUserId) return;
    const att = await getAttachmentForRead(targetAttachmentId!);
    await expect(canReadAttachment(att!, financeId)).resolves.toBe(false);
  });
});
