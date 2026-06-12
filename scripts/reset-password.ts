#!/usr/bin/env tsx
/**
 * 重置任意用户的密码 (按 employeeNo 或 id)。
 * 用法:
 *   pnpm reset-password --employeeNo admin                       # 自动生成 20 字符强密码
 *   pnpm reset-password --employeeNo admin --password 'xxx'    # 显式指定
 *   pnpm reset-password --id <cuid> --password 'xxx'
 *
 * 适用: 用户忘记密码 / 密码重置 modal 复制失败等场景 (不依赖 web UI, 救火用)。
 */
import { prisma } from "@/lib/prisma";
import bcrypt from "bcrypt";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { randomBytes } from "node:crypto";

type Args = {
  id?: string;
  employeeNo?: string;
  password?: string;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    switch (a) {
      case "--id":          out.id = argv[++i]; break;
      case "--employeeNo":  out.employeeNo = argv[++i]; break;
      case "--password":    out.password = argv[++i]; break;
      case "-h": case "--help":
        console.log("Usage: pnpm reset-password --employeeNo <id> [--password <pwd>]");
        console.log("       pnpm reset-password --id <cuid> [--password <pwd>]");
        process.exit(0);
      default:
        if (a.startsWith("--")) {
          console.error(`Unknown flag: ${a}`);
          process.exit(2);
        }
    }
  }
  return out;
}

function generatePassword(len = 20): string {
  // 20 字符 base64url-ish, 避免 /+= 字符; 取前 len 个
  return randomBytes(32).toString("base64").replace(/[/+=]/g, "").slice(0, len);
}

async function promptPassword(): Promise<string> {
  if (!input.isTTY) {
    console.error("No --password and stdin is not a TTY. Pass --password or RESET_PASSWORD env.");
    process.exit(2);
  }
  const rl = readline.createInterface({ input, output });
  try {
    return await rl.question("New password (>=8 chars): ");
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.id && !args.employeeNo) {
    console.error("Missing --id or --employeeNo");
    process.exit(2);
  }

  // Resolve target user
  const user = await prisma.user.findFirst({
    where: args.id
      ? { id: args.id }
      : { employeeNo: args.employeeNo },
    select: { id: true, employeeNo: true, name: true, email: true, status: true, deletedAt: true }
  });
  if (!user || user.deletedAt) {
    console.error(`User not found: ${args.id ?? args.employeeNo}`);
    process.exit(1);
  }
  if (user.status !== "ACTIVE") {
    console.error(`User not ACTIVE: ${user.employeeNo} status=${user.status}`);
    process.exit(1);
  }

  // Resolve password
  let pwd = args.password ?? process.env.RESET_PASSWORD;
  if (!pwd) pwd = await promptPassword();
  if (pwd.length < 8) {
    console.error("Password too short (min 8 chars).");
    process.exit(2);
  }

  const passwordHash = await bcrypt.hash(pwd, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash }
  });

  console.log(JSON.stringify({
    ok: true,
    user: { id: user.id, employeeNo: user.employeeNo, name: user.name, email: user.email }
  }, null, 2));
  console.log(`\n[OK] ${user.employeeNo} (${user.name}) 密码已重置为上面的 ${pwd.length} 字符值。`);
  console.log(`     请立即复制走或首次登录后改密。`);
}

main()
  .catch((e) => {
    console.error("FAILED:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
