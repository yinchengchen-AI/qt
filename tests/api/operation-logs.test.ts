// 全局操作日志 service 测试
//
// 覆盖矩阵:
//   1) 非 ADMIN(SALES)调用 list/meta/detail 一律 403
//   2) keyword 模糊匹配:命中 路径 / 失败原因 / 对象ID 的记录能被捞出
//   3) actor 富化:系统用户给 isSystem=true, 普通用户带 name/employeeNo
//   4) entityDisplay:Customer 解析为 "code name"; 未知实体回退 entityId
//   5) getOperationLogMeta 返回日志里真实出现过的 entity / action / actor
//   6) getOperationLogDetail:存在则带 entityDisplay, 不存在抛 404
//   7) keyword 命中对象可读名:客户名能捞出挂在该客户上的日志
//   8) 排序:sortBy=action asc/desc 生效;缺省 at desc
//
// DB 不可达时整组 skip；数据用唯一 TAG 前缀，跑完自清理。

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  listOperationLogs,
  getOperationLogMeta,
  getOperationLogDetail,
} from "@/server/services/operation-log";
import { SYSTEM_USER_ID } from "@/lib/system";
import { ApiError } from "@/lib/api";
import type { SessionUser } from "@/lib/session";

let dbReachable = false;
const TAG = `TEST-OPLOG2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminUser: SessionUser | null = null;
let salesUser: SessionUser | null = null;
const cleanupOpLogIds: string[] = [];
const cleanupCustomerIds: string[] = [];
let customerId: string | null = null;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const admin = await prisma.user.findFirst({
    where: { role: { code: "ADMIN" }, deletedAt: null, isSystem: false },
  });
  const sales = await prisma.user.findFirst({
    where: { role: { code: "SALES" }, deletedAt: null, isSystem: false },
  });
  if (!admin || !sales) return;
  adminUser = { id: admin.id, roleCode: "ADMIN" } as SessionUser;
  salesUser = { id: sales.id, roleCode: "SALES" } as SessionUser;

  // 真实客户(验 entityDisplay 解析)
  const c = await prisma.customer.create({
    data: {
      code: `${TAG}-C`,
      name: `${TAG}-客户`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactPhone: "13800000000",
      createdById: admin.id,
      updatedById: admin.id,
      ownerUserId: sales.id,
    },
    select: { id: true },
  });
  customerId = c.id;
  cleanupCustomerIds.push(c.id);

  // 造日志:一条命中 path, 一条命中 errorMessage, 一条挂在客户上, 一条系统 actor
  const seeds = [
    {
      actorId: admin.id,
      action: `${TAG}_ACTION_A`,
      entity: "Dictionary",
      entityId: `${TAG}-d1`,
      path: `/api/x/${TAG}-hit-path`,
    },
    {
      actorId: admin.id,
      action: `${TAG}_ACTION_B`,
      entity: "Dictionary",
      entityId: `${TAG}-d2`,
      status: "FAILURE",
      errorMessage: `boom ${TAG}-hit-error`,
    },
    {
      actorId: admin.id,
      action: `${TAG}_ACTION_C`,
      entity: "Customer",
      entityId: c.id,
    },
    {
      actorId: SYSTEM_USER_ID,
      action: `${TAG}_ACTION_D`,
      entity: "Dictionary",
      entityId: `${TAG}-d4`,
    },
  ];
  for (const s of seeds) {
    const row = await prisma.operationLog.create({ data: s });
    cleanupOpLogIds.push(row.id);
  }
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
    if (cleanupOpLogIds.length > 0) {
      await prisma.operationLog.deleteMany({ where: { id: { in: cleanupOpLogIds } } });
    }
    if (cleanupCustomerIds.length > 0) {
      await prisma.customer.deleteMany({ where: { id: { in: cleanupCustomerIds } } });
    }
  } catch {
    // ignore
  }
  await prisma.$disconnect();
});

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable || !adminUser || !salesUser || !customerId) return;
  await fn();
};

describe("operation-log service", () => {
  it(
    "非 ADMIN 一律 403",
    guard(async () => {
      await expect(
        listOperationLogs(salesUser!, { page: 1, pageSize: 20 }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(getOperationLogMeta(salesUser!)).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        getOperationLogDetail(salesUser!, cleanupOpLogIds[0]!),
      ).rejects.toMatchObject({ status: 403 });
    }),
  );

  it(
    "keyword 命中 path / errorMessage / entityId",
    guard(async () => {
      const byPath = await listOperationLogs(adminUser!, {
        page: 1,
        pageSize: 20,
        keyword: `${TAG}-hit-path`,
      });
      expect(byPath.list).toHaveLength(1);
      expect(byPath.list[0]!.entityId).toBe(`${TAG}-d1`);

      const byErr = await listOperationLogs(adminUser!, {
        page: 1,
        pageSize: 20,
        keyword: `${TAG}-HIT-ERROR`, // 大小写不敏感
      });
      expect(byErr.list).toHaveLength(1);
      expect(byErr.list[0]!.status).toBe("FAILURE");

      const byEntityId = await listOperationLogs(adminUser!, {
        page: 1,
        pageSize: 20,
        keyword: `${TAG}-d4`,
      });
      expect(byEntityId.list).toHaveLength(1);
      expect(byEntityId.list[0]!.actor?.isSystem).toBe(true);
    }),
  );

  it(
    "entityDisplay:Customer 解析为 code+name;Dictionary 回退 entityId",
    guard(async () => {
      const r = await listOperationLogs(adminUser!, {
        page: 1,
        pageSize: 20,
        action: `${TAG}_ACTION_C`,
      });
      expect(r.list).toHaveLength(1);
      expect(r.list[0]!.entityDisplay).toBe(`${TAG}-C ${TAG}-客户`);
      expect(r.list[0]!.entityHref).toBe(`/customers/${customerId}`);
      expect(r.list[0]!.actor?.name).toBeTruthy();

      const r2 = await listOperationLogs(adminUser!, {
        page: 1,
        pageSize: 20,
        action: `${TAG}_ACTION_A`,
      });
      expect(r2.list[0]!.entityDisplay).toBe(`${TAG}-d1`);
      // Dictionary 有详情路径(静态映射), href 非空
      expect(r2.list[0]!.entityHref).toBe(`/admin/dictionaries/${TAG}-d1`);
    }),
  );

  it(
    "meta 返回真实出现过的 entity / action / actor",
    guard(async () => {
      const meta = await getOperationLogMeta(adminUser!);
      const actions = meta.actions.map((a) => a.value);
      expect(actions).toContain(`${TAG}_ACTION_A`);
      expect(actions).toContain(`${TAG}_ACTION_D`);
      const entities = meta.entities.map((e) => e.value);
      expect(entities).toContain("Customer");
      const sys = meta.actors.find((a) => a.value === SYSTEM_USER_ID);
      expect(sys?.isSystem).toBe(true);
    }),
  );

  it(
    "keyword 命中对象可读名(客户名/客户编号)",
    guard(async () => {
      // 客户名只存在于 Customer.name,日志的 entityId 是 cuid 不含 TAG —— 只能靠可读名解析命中
      const byName = await listOperationLogs(adminUser!, {
        page: 1,
        pageSize: 20,
        keyword: `${TAG}-客户`,
      });
      expect(byName.list).toHaveLength(1);
      expect(byName.list[0]!.entity).toBe("Customer");
      expect(byName.list[0]!.entityId).toBe(customerId);

      const byCode = await listOperationLogs(adminUser!, {
        page: 1,
        pageSize: 20,
        keyword: `${TAG}-C`,
      });
      expect(byCode.list.some((l) => l.entityId === customerId)).toBe(true);
    }),
  );

  it(
    "排序:sortBy=action asc/desc;缺省 at desc",
    guard(async () => {
      // keyword=TAG 命中 d1/d2/d4(entityId contains) + 客户日志(可读名解析),共 4 条
      const asc = await listOperationLogs(adminUser!, {
        page: 1,
        pageSize: 20,
        keyword: TAG,
        sortBy: "action",
        sortOrder: "asc",
      });
      expect(asc.list.map((l) => l.action)).toEqual([
        `${TAG}_ACTION_A`,
        `${TAG}_ACTION_B`,
        `${TAG}_ACTION_C`,
        `${TAG}_ACTION_D`,
      ]);

      const desc = await listOperationLogs(adminUser!, {
        page: 1,
        pageSize: 20,
        keyword: TAG,
        sortBy: "action",
        sortOrder: "desc",
      });
      expect(desc.list.map((l) => l.action)).toEqual([
        `${TAG}_ACTION_D`,
        `${TAG}_ACTION_C`,
        `${TAG}_ACTION_B`,
        `${TAG}_ACTION_A`,
      ]);

      // 缺省 at desc:最后创建的 ACTION_D 在最前
      const byDefault = await listOperationLogs(adminUser!, {
        page: 1,
        pageSize: 20,
        keyword: TAG,
      });
      expect(byDefault.list[0]!.action).toBe(`${TAG}_ACTION_D`);
    }),
  );

  it(
    "detail:存在返回 entityDisplay;不存在 404",
    guard(async () => {
      const d = await getOperationLogDetail(adminUser!, cleanupOpLogIds[2]!);
      expect(d.entity).toBe("Customer");
      expect(d.entityDisplay).toBe(`${TAG}-C ${TAG}-客户`);

      await expect(
        getOperationLogDetail(adminUser!, `${TAG}-not-exist`),
      ).rejects.toBeInstanceOf(ApiError);
      await expect(
        getOperationLogDetail(adminUser!, `${TAG}-not-exist`),
      ).rejects.toMatchObject({ status: 404 });
    }),
  );
});
