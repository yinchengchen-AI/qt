// 验证登录页"7 天内自动登录"复选框实际影响 JWT 寿命。
//
// NextAuth v4 在 NEXTAUTH_SECRET 存在时把 session token 加密成 JWE (5 段)。
// 加密方式: HKDF-SHA256(secret, salt=cookieName, info="Auth.js Generated Encryption Key (salt)")
// 派生 64 字节密钥,再用 A256GCM 加密 payload。
//
// 这里在 Playwright worker (Node.js) 里:
// 1. 用 dotenv 读 .env 拿 NEXTAUTH_SECRET
// 2. 用 jose.hkdf 派生同样的 64 字节密钥
// 3. jose.compactDecrypt 解密 JWE 拿到明文 payload
// 4. 断言 payload.iat / payload.exp 的差值
//
// 只在 chromium project 跑(webkit 登录已知在 dev 环境有 CSRF/cookie 兼容问题)。
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { DEV_PASSWORD } from "./_dev-credentials";
import { jwtDecrypt } from "jose";
import { hkdf } from "@panva/hkdf";
import * as dotenv from "dotenv";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ESM 下 __dirname 不可用;tests/e2e/auto-login.spec.ts → 项目根 2 级父目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });
const SECRET = process.env.NEXTAUTH_SECRET;
if (!SECRET) {
  throw new Error("NEXTAUTH_SECRET not set in .env; cannot decrypt session JWE in test");
}

const ADMIN = { employeeNo: "admin", password: DEV_PASSWORD };
// 登录/签发/解密之间的耗时,加上 60s 容差
const TOLERANCE_SECONDS = 60;
const SESSION_COOKIE = "next-auth.session-token";

interface JwtPayload { iat: number; exp: number; [k: string]: unknown }

async function deriveNextAuthKey(secret: string, salt: string): Promise<Uint8Array> {
  // 与 next-auth/jwt/index.js 中的 getDerivedEncryptionKey 一致:
  // HKDF-SHA256 派生 32 字节;info 字符串以 "NextAuth.js Generated Encryption Key" 开头,
  // salt 非空时括号补 salt;空 salt 时不带括号
  const info = `NextAuth.js Generated Encryption Key${salt ? ` (${salt})` : ""}`;
  const raw = await hkdf("sha256", secret, salt, info, 32);
  return new Uint8Array(raw);
}

async function decryptSessionToken(jwe: string): Promise<JwtPayload> {
  // NextAuth v4 签发 session token 时,getToken 内部 decode 的 salt 默认为空字符串;
  // 即使 NextAuth 看起来"用 cookieName 作 salt",实际从 jwt/index.js 看,session 走的是默认 salt=""
  const key = await deriveNextAuthKey(SECRET!, "");
  const { payload } = await jwtDecrypt(jwe, key);
  return payload as JwtPayload;
}

async function login(page: Page, opts: { uncheckRemember: boolean }) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入工号").fill(ADMIN.employeeNo);
  await page.getByPlaceholder("请输入密码").fill(ADMIN.password);
  if (opts.uncheckRemember) {
    await page.getByRole("checkbox", { name: "7 天内自动登录" }).uncheck();
  }
  await page.getByText("登 录", { exact: true }).first().click();
  await page.waitForURL(/dashboard/, { timeout: 20000 });
}

async function readSessionExp(context: BrowserContext): Promise<{ iat: number; exp: number }> {
  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === SESSION_COOKIE);
  expect(session, `${SESSION_COOKIE} cookie should be set after login`).toBeTruthy();
  const payload = await decryptSessionToken(session!.value);
  expect(typeof payload.iat).toBe("number");
  expect(typeof payload.exp).toBe("number");
  return payload as { iat: number; exp: number };
}

test.describe("7 天内自动登录", () => {
  test("勾选(默认):JWT 寿命 ≈ 7 天", async ({ page, context }) => {
    await login(page, { uncheckRemember: false });
    const { iat, exp } = await readSessionExp(context);
    const lifetime = exp - iat;
    const expected = 7 * 24 * 60 * 60;
    expect(
      Math.abs(lifetime - expected),
      `exp - iat = ${lifetime}s, expected ${expected}s ± ${TOLERANCE_SECONDS}s`
    ).toBeLessThanOrEqual(TOLERANCE_SECONDS);
  });

  test("取消勾选:JWT 寿命 ≈ 8 小时", async ({ page, context }) => {
    await login(page, { uncheckRemember: true });
    const { iat, exp } = await readSessionExp(context);
    const lifetime = exp - iat;
    const expected = 8 * 60 * 60;
    expect(
      Math.abs(lifetime - expected),
      `exp - iat = ${lifetime}s, expected ${expected}s ± ${TOLERANCE_SECONDS}s`
    ).toBeLessThanOrEqual(TOLERANCE_SECONDS);
  });
});
