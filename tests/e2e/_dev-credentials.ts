/**
 * E2E 测试共享: dev 测试账号密码。
 *
 * 跟 app/login/page.tsx 快速填充卡 + scripts/shared/seed-test-users.ts 共用
 * 同一个 env 源 (DEV_QUICK_FILL_PASSWORD), 默认 "dev-only-fill"。
 *
 * 跑 e2e 前请确认:
 *   1) .env 里 DEV_QUICK_FILL_PASSWORD 已设 (或接受默认)
 *   2) 已经 `pnpm seed:dev-users` 把 admin/sales/finance/ops 建好
 *
 * 自动加载 .env (跟 auto-login.spec.ts 一致, 不依赖 Playwright 全局 setup)。
 */
import * as dotenv from "dotenv";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .env 缺失也别抛 — 让 dotenv 静默, 默认值兜底
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const DEFAULT_DEV_PASSWORD = "dev-only-fill";

export const DEV_PASSWORD: string =
  process.env.DEV_QUICK_FILL_PASSWORD ?? DEFAULT_DEV_PASSWORD;
