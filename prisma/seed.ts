// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck -- 字典/工作流模板用 JS 字面量集中维护, 暂不细化类型
// 种子: 5 角色 + 5 部门 + 字典 (系统管理数据)
// 业务数据 (客户/合同/项目/发票/回款/跟进) 不再 seed, 生产用真实数据
// 初始账号: 跑 pnpm create-admin 自行创建
import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { ROLE_PERMISSIONS } from "../lib/permissions";
import { DICT_DEFS } from "@/scripts/shared/dict-defs";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! })
});




async function main() {
  const roleDefs = [
    { code: "ADMIN",   name: "管理员",   description: "系统管理员" },
    { code: "SALES",   name: "业务人员", description: "负责客户/合同/项目推进" },
    { code: "FINANCE", name: "财务人员", description: "负责开票/回款/对账" },
    { code: "OPS",     name: "行政人员", description: "基础信息维护" },
    { code: "EXPERT",  name: "技术专家", description: "承担现场勘查、报告撰写等专业工作" }
  ] as const;

  // System actor: 状态机自动转换/定时任务 等"非人"行为共用 id="system" 的占位 user
  // 见 lib/system.ts SYSTEM_USER_ID;不可登录(isSystem=true 拦在 authorize,密码永不匹配)
  // passwordHash 用 bcrypt(crypto.randomBytes(32)) 一次性随机, 杜绝固定占位字符串:
  //   - 旧固定 $2b$10$ZZZ... 在某些 bcrypt 实现里会抛异常或 hash 校验失败时返回诡异结果
  //   - 用随机串永远不会和真实密码撞, 永远不会"侥幸"登录成功
  const SYSTEM_RANDOM_HASH = bcrypt.hashSync(randomBytes(32), 12);
  const SYSTEM_USER = {
    id: "system",
    employeeNo: "SYSTEM",
    name: "System",
    email: "system@internal.local",
    passwordHash: SYSTEM_RANDOM_HASH
  };

  for (const r of roleDefs) {
    await prisma.role.upsert({
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
  }

  // ----- System 占位 user: 状态机自动转换/定时任务 共用 actor -----
  // 真实管理员用 scripts/create-admin.ts 创建
  const adminRole = await prisma.role.findUnique({ where: { code: "ADMIN" } });
  if (!adminRole) throw new Error("ADMIN role not seeded; cannot create system user");
  await prisma.user.upsert({
    where: { id: SYSTEM_USER.id },
    update: { isSystem: true, name: SYSTEM_USER.name, email: SYSTEM_USER.email, roleId: adminRole.id },
    create: {
      id: SYSTEM_USER.id,
      employeeNo: SYSTEM_USER.employeeNo,
      name: SYSTEM_USER.name,
      email: SYSTEM_USER.email,
      passwordHash: SYSTEM_USER.passwordHash,
      roleId: adminRole.id,
      status: "ACTIVE",
      isSystem: true
    }
  });

  // ----- 用户不在 seed 中创建 -----
  // 初始管理员用 scripts/create-admin.ts 创建: pnpm create-admin --employeeNo admin --name "..." --email ... --password ...

  for (const d of DICT_DEFS) {
    await prisma.dictionary.upsert({
      where: { category_code: { category: d.category, code: d.code } },
      update: { label: d.label, sort: d.sort },
      create: d
    });
  }


  // ----- 部门 seed -----
  // 3 个顶级部门(业务/技术/财务)+ 2 个技术部下子部门
  const techDept = await prisma.department.upsert({
    where: { code: "tech" },
    update: { name: "技术部", sort: 2, isActive: true },
    create: { id: "dept_seed_tech", code: "tech", name: "技术部", sort: 2, isActive: true }
  });
  const _bizDept = await prisma.department.upsert({
    where: { code: "biz" },
    update: { name: "业务部", sort: 1, isActive: true },
    create: { id: "dept_seed_biz", code: "biz", name: "业务部", sort: 1, isActive: true }
  });
  const _finDept = await prisma.department.upsert({
    where: { code: "fin" },
    update: { name: "财务部", sort: 3, isActive: true },
    create: { id: "dept_seed_fin", code: "fin", name: "财务部", sort: 3, isActive: true }
  });
  const _techOps = await prisma.department.upsert({
    where: { code: "tech_ops" },
    update: { name: "技术运维组", parentId: techDept.id, sort: 1, isActive: true },
    create: { id: "dept_seed_tech_ops", code: "tech_ops", name: "技术运维组", parentId: techDept.id, sort: 1, isActive: true }
  });
  const _techWeb = await prisma.department.upsert({
    where: { code: "tech_web" },
    update: { name: "前端组", parentId: techDept.id, sort: 2, isActive: true },
    create: { id: "dept_seed_tech_web", code: "tech_web", name: "前端组", parentId: techDept.id, sort: 2, isActive: true }
  });

  console.log(`✅ 系统管理 seed 完成: 5 角色 + system actor + 5 部门 + ${DICT_DEFS.length} 字典`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
