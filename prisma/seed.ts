// 种子：4 角色 + 4 账号 + 字典
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import bcrypt from "bcrypt";
import { ROLE_PERMISSIONS } from "../lib/permissions";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! })
});

async function main() {
  const roleDefs = [
    { code: "ADMIN", name: "管理员", description: "系统管理员" },
    { code: "SALES", name: "业务人员", description: "负责客户/合同/项目推进" },
    { code: "FINANCE", name: "财务人员", description: "负责开票/回款/对账" },
    { code: "OPS", name: "行政人员", description: "基础信息维护" }
  ] as const;

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

  const passwordHash = await bcrypt.hash("123456", 10);
  const userDefs = [
    { employeeNo: "admin", name: "系统管理员", email: "admin@qt.com", roleCode: "ADMIN" },
    { employeeNo: "sales", name: "张业务", email: "sales@qt.com", roleCode: "SALES" },
    { employeeNo: "finance", name: "李财务", email: "finance@qt.com", roleCode: "FINANCE" },
    { employeeNo: "ops", name: "王行政", email: "ops@qt.com", roleCode: "OPS" }
  ] as const;
  for (const u of userDefs) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: u.roleCode } });
    await prisma.user.upsert({
      where: { employeeNo: u.employeeNo },
      update: {},
      create: {
        employeeNo: u.employeeNo,
        name: u.name,
        email: u.email,
        passwordHash,
        roleId: role.id
      }
    });
  }

  const dictDefs: Array<{ category: string; code: string; label: string; sort: number }> = [
    { category: "SERVICE_TYPE", code: "SAFETY_CONSULT", label: "安全咨询", sort: 1 },
    { category: "SERVICE_TYPE", code: "SAFETY_TRAIN", label: "安全培训", sort: 2 },
    { category: "SERVICE_TYPE", code: "HAZARD_ANA", label: "隐患排查", sort: 3 },
    { category: "SERVICE_TYPE", code: "EMERGENCY_PLAN", label: "应急预案", sort: 4 },
    { category: "SERVICE_TYPE", code: "EVALUATION", label: "安全评价", sort: 5 },
    { category: "SERVICE_TYPE", code: "OTHER", label: "其他", sort: 99 },
    { category: "CUSTOMER_TYPE", code: "ENTERPRISE", label: "企业", sort: 1 },
    { category: "CUSTOMER_TYPE", code: "GOV", label: "政府", sort: 2 },
    { category: "CUSTOMER_TYPE", code: "OTHER", label: "其他", sort: 3 },
    { category: "CUSTOMER_LEVEL", code: "A", label: "A 级", sort: 1 },
    { category: "CUSTOMER_LEVEL", code: "B", label: "B 级", sort: 2 },
    { category: "CUSTOMER_LEVEL", code: "C", label: "C 级", sort: 3 },
    { category: "CUSTOMER_LEVEL", code: "D", label: "D 级", sort: 4 }
  ];
  for (const d of dictDefs) {
    await prisma.dictionary.upsert({
      where: { category_code: { category: d.category, code: d.code } },
      update: { label: d.label, sort: d.sort },
      create: d
    });
  }

  console.log("✅ Seed 完成：4 角色 + 4 账号（密码 123456）+ 字典");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
