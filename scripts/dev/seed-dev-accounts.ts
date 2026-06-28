/**
 * Dev/preview 一键建 5 个内置角色账号,配合登录页 QUICK_ACCOUNTS 一键填入。
 *
 * 用途:每次 db push --force-reset 清空 DB 后,跑这个脚本恢复可登录的 dev 账号。
 * 密码与登录页 DEV_QUICK_FILL_PASSWORD 默认值 (dev-only-fill) 对齐,可用 env 覆盖。
 * 邮箱用 dev-{no}@qt.local 前缀,避免与运维手动建的 admin@qt.local 等账号撞唯一约束。
 *
 * 用法:
 *   pnpm tsx scripts/dev/seed-dev-accounts.ts
 *   DEV_QUICK_FILL_PASSWORD=mySecret pnpm tsx scripts/dev/seed-dev-accounts.ts
 */
import { prisma } from "../../lib/prisma";
import bcrypt from "bcrypt";

type Acc = { code: string; no: string; name: string };
const ACCOUNTS: Acc[] = [
  { code: "ADMIN",   no: "admin",   name: "管理员" },
  { code: "SALES",   no: "sales",   name: "业务人员" },
  { code: "FINANCE", no: "finance", name: "财务人员" },
  { code: "OPS",     no: "ops",     name: "行政人员" },
  { code: "EXPERT",  no: "expert",  name: "技术专家" }
];

const PASSWORD = process.env.DEV_QUICK_FILL_PASSWORD ?? "dev-only-fill";

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  for (const acc of ACCOUNTS) {
    const role = await prisma.role.findFirst({ where: { code: acc.code } });
    if (!role) {
      console.error(`[FAIL] Role not found: ${acc.code} (run \`pnpm seed\` first)`);
      process.exit(1);
    }
    const user = await prisma.user.upsert({
      where: { employeeNo: acc.no },
      update: {
        name: acc.name,
        email: `dev-${acc.no}@qt.local`,
        passwordHash,
        roleId: role.id,
        status: "ACTIVE",
        deletedAt: null
      },
      create: {
        employeeNo: acc.no,
        name: acc.name,
        email: `dev-${acc.no}@qt.local`,
        passwordHash,
        roleId: role.id,
        status: "ACTIVE"
      },
      select: { id: true, employeeNo: true, name: true, roleId: true }
    });
    console.log(`[OK] ${acc.code.padEnd(8)} ${acc.no.padEnd(8)} (${acc.name}) -> ${user.id}`);
  }
  console.log(`\nAll 5 dev accounts ready. Password: ${PASSWORD}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
