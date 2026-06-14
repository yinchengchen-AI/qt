#!/usr/bin/env tsx
/**
 * Create an ADMIN (or any role) user from CLI.
 * Required: --employeeNo, --name, --email
 * Auth: --password <pwd>  (or env CREATE_ADMIN_PASSWORD, or interactive prompt)
 * Optional: --role <code> default ADMIN, --phone <num>
 *
 * Usage:
 *   pnpm create-admin --employeeNo admin --name "系统管理员" --email admin@example.com --password 's0me-Strong-Pwd!'
 */
import { prisma } from "@/lib/prisma";
import bcrypt from "bcrypt";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

type RawArgs = {
  employeeNo?: string;
  name?: string;
  email?: string;
  password?: string;
  role: string;
  phone?: string;
};

type ValidatedArgs = {
  employeeNo: string;
  name: string;
  email: string;
  password?: string;
  role: string;
  phone?: string;
};

function printHelp(): void {
  console.log(`Usage:
  pnpm create-admin --employeeNo <id> --name <name> --email <email> [--password <pwd>] [--role <code>] [--phone <num>]

Options:
  --employeeNo <id>      工号 (必填, 唯一)
  --name <name>          姓名 (必填)
  --email <email>        邮箱 (必填, 唯一, RFC 5322 简版)
  --password <pwd>       明文密码 (>=8 字符); 不传则读 env CREATE_ADMIN_PASSWORD, 再否则交互式 prompt
  --role <code>          角色 code, 默认 ADMIN; 需先存在于 Role 表
  --phone <num>          手机号 (可选)
  -h | --help            本帮助
`);
}

function nextValue(argv: string[], i: number, flag: string): string {
  const v = argv[i + 1];
  if (v === undefined) {
    console.error(`Flag ${flag} requires a value`);
    process.exit(2);
  }
  return v;
}

function parseArgs(argv: string[]): RawArgs {
  const out: RawArgs = { role: "ADMIN" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    switch (a) {
      case "--employeeNo": out.employeeNo = nextValue(argv, i, a); i++; break;
      case "--name":       out.name = nextValue(argv, i, a);       i++; break;
      case "--email":      out.email = nextValue(argv, i, a);      i++; break;
      case "--password":   out.password = nextValue(argv, i, a);   i++; break;
      case "--role":       out.role = nextValue(argv, i, a);       i++; break;
      case "--phone":      out.phone = nextValue(argv, i, a);      i++; break;
      case "-h": case "--help": printHelp(); process.exit(0);
      default:
        if (a.startsWith("--")) {
          console.error(`Unknown flag: ${a}`);
          printHelp();
          process.exit(2);
        }
    }
  }
  return out;
}

function validate(raw: RawArgs): ValidatedArgs {
  // Pull optionals into locals for narrowing
  const employeeNo = raw.employeeNo;
  const name = raw.name;
  const email = raw.email;
  const missing: string[] = [];
  if (!employeeNo) missing.push("--employeeNo");
  if (!name)       missing.push("--name");
  if (!email)      missing.push("--email");
  if (missing.length) {
    console.error(`Missing required: ${missing.join(", ")}`);
    printHelp();
    process.exit(2);
  }
  // After the missing check, locals are narrowed to `string`
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email!)) {
    console.error(`Invalid email: ${email}`);
    process.exit(2);
  }
  const password = raw.password;
  if (password !== undefined && password.length < 8) {
    console.error("Password too short (min 8 chars).");
    process.exit(2);
  }
  return {
    employeeNo: employeeNo!,
    name: name!,
    email: email!,
    password,
    role: raw.role || "ADMIN",
    phone: raw.phone
  };
}

async function promptPassword(): Promise<string> {
  if (!input.isTTY) {
    console.error("No --password and stdin is not a TTY. Pass --password or set CREATE_ADMIN_PASSWORD.");
    process.exit(2);
  }
  const rl = readline.createInterface({ input, output });
  try {
    return await rl.question("Password (>=8 chars): ");
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const args = validate(parseArgs(process.argv.slice(2)));

  // Resolve password
  let pwd = args.password ?? process.env.CREATE_ADMIN_PASSWORD;
  if (!pwd) pwd = await promptPassword();
  if (pwd.length < 8) {
    console.error("Password too short (min 8 chars).");
    process.exit(2);
  }

  // Find role
  const role = await prisma.role.findFirst({ where: { code: args.role } });
  if (!role) {
    console.error(`Role not found: ${args.role}. Run \`pnpm seed\` first if DB is empty.`);
    process.exit(1);
  }

  // Uniqueness pre-check
  const existing = await prisma.user.findFirst({
    where: { OR: [{ employeeNo: args.employeeNo }, { email: args.email }] },
    select: { id: true, employeeNo: true, email: true, deletedAt: true }
  });
  if (existing && !existing.deletedAt) {
    console.error(`User already exists: employeeNo=${existing.employeeNo} email=${existing.email} id=${existing.id}`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(pwd, 12);

  const user = await prisma.user.create({
    data: {
      employeeNo: args.employeeNo,
      name: args.name,
      email: args.email,
      phone: args.phone ?? null,
      passwordHash,
      roleId: role.id,
      status: "ACTIVE"
    },
    select: { id: true, employeeNo: true, name: true, email: true, roleId: true, status: true, createdAt: true }
  });

  console.log(JSON.stringify({ ok: true, user }, null, 2));
  console.log(`\n[OK] ${args.role} user created. Log in at NEXTAUTH_URL with:`);
  console.log(`    employeeNo: ${user.employeeNo}`);
  console.log(`    password:   (the one you provided; not echoed)`);
}

main()
  .catch((e) => {
    console.error("FAILED:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
