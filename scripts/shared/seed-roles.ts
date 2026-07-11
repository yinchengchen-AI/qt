#!/usr/bin/env tsx
/**
 * 插 5 个 system roles (ADMIN/SALES/FINANCE/OPS/EXPERT) + id="system" 的占位 user,
 * 用 lib/permissions 里的 ROLE_PERMISSIONS 作为 permissions 字段。
 *
 * 适用场景: 生产部署 (不跑 seed) 但 create-admin.ts 需要 ADMIN role 存在。
 *
 * 用法:
 *   pnpm seed-roles
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { ROLE_PERMISSIONS } from "@/lib/permissions";

const ROLE_DEFS = [
  { code: "ADMIN",   name: "管理员",   description: "系统管理员" },
  { code: "SALES",   name: "业务人员", description: "负责客户/合同/项目推进" },
  { code: "FINANCE", name: "财务人员", description: "负责开票/回款/对账" },
  { code: "OPS",     name: "行政人员", description: "基础信息维护" },
  { code: "EXPERT",  name: "技术专家", description: "承担现场勘查、报告撰写等专业工作" }
] as const;

async function main(): Promise<void> {
  for (const r of ROLE_DEFS) {
    const role = await prisma.role.upsert({
      where: { code: r.code },
      update: { name: r.name, description: r.description, permissions: ROLE_PERMISSIONS[r.code] as unknown as object, isSystem: true },
      create: {
        code: r.code,
        name: r.name,
        description: r.description,
        permissions: ROLE_PERMISSIONS[r.code] as unknown as object,
        isSystem: true
      }
    });
    console.log(`[OK] upsert role: ${role.code} (${role.name})  id=${role.id}`);
  }

  // System actor: 状态机自动转换/定时任务 等"非人"行为共用 id="system" 的占位 user
  // 见 lib/system.ts SYSTEM_USER_ID;不可登录(isSystem=true 拦在 authorize,密码永不匹配)
  // passwordHash 用 bcrypt(crypto.randomBytes(32)) 一次性随机生成, 杜绝固定占位字符串:
  //   - 旧固定 $2b$10$ZZZ... 在某些 bcrypt 实现里会抛异常或比对结果不稳定
  //   - 随机串永远不会和真实密码撞, 永远不能"侥幸"登入
  const SYSTEM_USER_ID = "system";
  const SYSTEM_USER_PASSWORD_HASH = bcrypt.hashSync(randomBytes(32), 12);
  const adminRole = await prisma.role.findUnique({ where: { code: "ADMIN" } });
  if (!adminRole) throw new Error("ADMIN role not seeded; cannot create system user");
  const sys = await prisma.user.upsert({
    where: { id: SYSTEM_USER_ID },
    update: { isSystem: true, name: "System", email: "system@internal.local", roleId: adminRole.id },
    create: {
      id: SYSTEM_USER_ID,
      employeeNo: "SYSTEM",
      name: "System",
      email: "system@internal.local",
      passwordHash: SYSTEM_USER_PASSWORD_HASH,
      roleId: adminRole.id,
      status: "ACTIVE",
      isSystem: true
    }
  });
  console.log(`[OK] upsert system user: id=${sys.id}  isSystem=${sys.isSystem}`);

  console.log(`\n[OK] ${ROLE_DEFS.length} roles + system user seeded. Now you can run \`pnpm create-admin\`.`);
}

main()
  .catch((e) => {
    console.error("FAILED:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
