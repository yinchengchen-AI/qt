// 导出 prisma/schema.prisma 当前目标 schema 的完整 DDL 到 docs/db-schema-snapshot.sql
//
// 用途：排查 drift / 比较 schema 演进 / 给新人一份"schema 长什么样"的参考
// 注意：这是只读参考，不会进入 _prisma_migrations，跟生产 deploy 无冲突
//
// 用法：
//   npx tsx scripts/shared/dump-current-schema.ts
//   npm run db:snapshot
//
// 自定义输出路径：
//   OUTPUT=/tmp/foo.sql npx tsx scripts/shared/dump-current-schema.ts
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");
const SCHEMA_PATH = resolve(REPO_ROOT, "prisma/schema.prisma");
const DEFAULT_OUTPUT = resolve(REPO_ROOT, "docs/db-schema-snapshot.sql");
const OUTPUT_PATH = process.env.OUTPUT
  ? resolve(process.cwd(), process.env.OUTPUT)
  : DEFAULT_OUTPUT;

if (!process.env.DATABASE_URL) {
  console.error("错误: 未设置 DATABASE_URL（.env 缺失或未加载）");
  process.exit(1);
}

console.log(`>> 生成 schema DDL: ${SCHEMA_PATH}`);
console.log(`>> 输出到:         ${OUTPUT_PATH}`);

const sql = execFileSync(
  "npx",
  [
    "prisma",
    "migrate",
    "diff",
    "--from-empty",
    "--to-schema",
    SCHEMA_PATH,
    "--script"
  ],
  {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  }
);

const header = [
  "-- =============================================================",
  `-- 由 scripts/shared/dump-current-schema.ts 生成于 ${new Date().toISOString()}`,
  "-- 数据源: prisma/schema.prisma (从空库到当前 schema 的 DDL)",
  "-- 注意: 这是只读参考,不是迁移;不会进入 _prisma_migrations",
  "-- 重新生成: npm run db:snapshot",
  "-- =============================================================",
  ""
].join("\n");

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, header + sql, "utf8");

const lineCount = sql.split("\n").length;
console.log(`>> 写入完成: ${lineCount} 行 SQL`);
