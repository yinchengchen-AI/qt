#!/usr/bin/env tsx
/**
 * 只插 4 个 system roles (ADMIN/SALES/FINANCE/OPS), 用 lib/permissions 里的
 * ROLE_PERMISSIONS 作为 permissions 字段。不插用户/客户/合同等 demo 数据。
 *
 * 适用场景: 生产部署 (不跑 seed) 但 create-admin.ts 需要 ADMIN role 存在。
 *
 * 用法:
 *   pnpm seed-roles
 */
import { prisma } from "@/lib/prisma";
import { ROLE_PERMISSIONS } from "@/lib/permissions";

const ROLE_DEFS = [
  { code: "ADMIN",   name: "管理员",   description: "系统管理员" },
  { code: "SALES",   name: "业务人员", description: "负责客户/合同/项目推进" },
  { code: "FINANCE", name: "财务人员", description: "负责开票/回款/对账" },
  { code: "OPS",     name: "行政人员", description: "基础信息维护" }
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
  console.log(`\n[OK] ${ROLE_DEFS.length} roles seeded. Now you can run \`pnpm create-admin\`.`);
}

main()
  .catch((e) => {
    console.error("FAILED:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
