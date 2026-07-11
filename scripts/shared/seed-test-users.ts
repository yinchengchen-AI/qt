#!/usr/bin/env tsx
/**
 * Dev 专用: 幂等 upsert 5 个测试账号 (admin / sales / finance / ops / expert),
 * 密码统一从 DEV_QUICK_FILL_PASSWORD 读(默认 "dev-only-fill"),
 * 跟登录页 app/login/page.tsx 的"测试账号 · 快速填充"卡用同一份密码源,
 * 避免 dev 起来后点了快速填充提示"工号或密码错误"。
 *
 * 仅 dev/test 用; 不会写 ADMIN role 之外的权限, 不会跟生产用户冲突
 * (测试账号的 employeeNo 是 admin/sales/finance/ops 这类短码,
 *  生产用户名都是真人工号, 不会撞)。
 *
 * 适用场景:
 *   - 第一次 dev:setup 后, 还没建过任何用户, 跑这个把 5 个测试账号补齐
 *   - 改了 .env 里的 DEV_QUICK_FILL_PASSWORD, 重跑同步
 *   - 已经有 dev 账号但忘记密码了, 重跑覆盖 (会重置密码)
 *
 * 用法:
 *   pnpm seed:dev-users
 *   DEV_QUICK_FILL_PASSWORD='xxx' pnpm seed:dev-users   # 显式指定密码
 */
import { prisma } from "@/lib/prisma";
import bcrypt from "bcrypt";

type TestUserDef = {
  employeeNo: string;
  name: string;
  email: string;
  roleCode: "ADMIN" | "SALES" | "FINANCE" | "OPS" | "EXPERT";
};

// 前 4 个跟 app/login/page.tsx 里 QUICK_ACCOUNTS 一一对应 (登录页快速填充卡);
// expert 不在快速填充卡里, 但权限/角色测试经常要切这个角色, 一起建好方便
const TEST_USERS: TestUserDef[] = [
  { employeeNo: "admin",   name: "测试管理员", email: "admin@dev.local",   roleCode: "ADMIN"   },
  { employeeNo: "sales",   name: "测试业务",   email: "sales@dev.local",   roleCode: "SALES"   },
  { employeeNo: "finance", name: "测试财务",   email: "finance@dev.local", roleCode: "FINANCE" },
  { employeeNo: "ops",     name: "测试运营",   email: "ops@dev.local",     roleCode: "OPS"     },
  { employeeNo: "expert",  name: "测试专家",   email: "expert@dev.local",  roleCode: "EXPERT"  }
];

const DEFAULT_DEV_PASSWORD = "dev-only-fill";
// 8 字符下限跟 create-admin.ts / reset-password.ts 保持一致
const MIN_PASSWORD_LENGTH = 8;
const BCRYPT_COST = 12;

function resolvePassword(): string {
  const pwd = process.env.DEV_QUICK_FILL_PASSWORD ?? DEFAULT_DEV_PASSWORD;
  if (pwd.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `DEV_QUICK_FILL_PASSWORD 长度 ${pwd.length} < ${MIN_PASSWORD_LENGTH}, 拒写。` +
        "如需自定义密码请设成 >= 8 字符的串, 或直接用默认值。"
    );
  }
  return pwd;
}

// 守门: 生产环境禁止跑这个脚本, 避免把 admin/sales/finance/ops/expert 这些
// 短工号覆盖到生产真账号的密码, 或者在生产库里插 5 个弱密码角色。
if (process.env.NODE_ENV === "production") {
  console.error(
    "[FATAL] seed-test-users 拒绝在生产环境运行 (NODE_ENV=production)。\n" +
      "        这些 dev 测试账号 (admin/sales/...) 工号短, 会跟生产真账号冲突。"
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const password = resolvePassword();
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  // 一次性把 5 个 role 都查出来, 跟 seed-roles.ts 同源; 避免循环里 N+1
  const roleCodes = TEST_USERS.map((u) => u.roleCode);
  const roles = await prisma.role.findMany({
    where: { code: { in: roleCodes } },
    select: { id: true, code: true }
  });
  const roleByCode = new Map(roles.map((r) => [r.code, r.id]));
  const missingRoles = roleCodes.filter((c) => !roleByCode.has(c));
  if (missingRoles.length > 0) {
    throw new Error(
      `Role 不存在: ${missingRoles.join(", ")}。请先 pnpm seed 或 pnpm seed-roles 建好 5 个 role。`
    );
  }

  let created = 0;
  let updated = 0;

  for (const u of TEST_USERS) {
    const roleId = roleByCode.get(u.roleCode);
    if (!roleId) continue; // 上面的 missingRoles 已经拦过了, 这里只是 type narrowing

    const existing = await prisma.user.findFirst({
      where: { OR: [{ employeeNo: u.employeeNo }, { email: u.email }] },
      select: { id: true, employeeNo: true, email: true, deletedAt: true }
    });

    if (existing && existing.deletedAt) {
      // 软删用户: 复用 id, 把 deletedAt 清掉 + 重置密码
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          employeeNo: u.employeeNo,
          name: u.name,
          email: u.email,
          passwordHash,
          roleId,
          status: "ACTIVE",
          deletedAt: null
        }
      });
      console.log(`[RESURRECT] ${u.employeeNo} (was soft-deleted, restored + password reset)`);
      updated++;
      continue;
    }

    if (existing) {
      // 已存在: 重置密码 + 同步 role/name/email, 避免权限漂移
      // (dev 场景; 生产别用这个脚本)
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          name: u.name,
          email: u.email,
          passwordHash,
          roleId,
          status: "ACTIVE"
        }
      });
      console.log(`[RESET] ${u.employeeNo} (password reset to DEV_QUICK_FILL_PASSWORD)`);
      updated++;
      continue;
    }

    await prisma.user.create({
      data: {
        employeeNo: u.employeeNo,
        name: u.name,
        email: u.email,
        passwordHash,
        roleId,
        status: "ACTIVE"
      }
    });
    console.log(`[CREATE] ${u.employeeNo} (${u.roleCode})  email=${u.email}`);
    created++;
  }

  console.log(
    `\n[OK] 测试账号 seed 完成: created=${created}, reset=${updated}`
  );
  console.log(
    `[INFO] 密码源: DEV_QUICK_FILL_PASSWORD=${
      process.env.DEV_QUICK_FILL_PASSWORD
        ? "(from env)"
        : `(default: ${DEFAULT_DEV_PASSWORD})`
    }`
  );
  console.log(
    '[INFO] 现在打开 http://localhost:3000/login 可点击"测试账号"快速填充登录。'
  );
}

main()
  .catch((e) => {
    console.error("FAILED:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
