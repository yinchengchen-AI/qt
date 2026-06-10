import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    NEXTAUTH_SECRET: z.string().min(32),
    NEXTAUTH_URL: z.string().url().optional(),
    APP_ENC_KEY_HEX: z.string().regex(/^[0-9a-fA-F]{64}$/).default("0".repeat(64)),
    // 对外可访问的 base URL；用于邮件/企微通知里的"查看详情"链接
    // - 开发环境:可省略,默认回落到 NEXTAUTH_URL 或 http://localhost:3000
    // - 生产环境:必须显式配置(启动时 fail-fast)
    APP_PUBLIC_URL: z.string().url().optional(),
    // cron 调用的共享密钥；生产环境必须设置
    CRON_SECRET: z.string().min(16).optional(),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development")
  },
  client: {},
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    APP_ENC_KEY_HEX: process.env.APP_ENC_KEY_HEX,
    APP_PUBLIC_URL: process.env.APP_PUBLIC_URL,
    CRON_SECRET: process.env.CRON_SECRET,
    NODE_ENV: process.env.NODE_ENV
  },
  emptyStringAsUndefined: true
});

// 启动时 fail-fast 校验:仅在生产环境强制关键配置
// 延迟到首次访问时执行,避免在 import 阶段打断构建
let _startupChecked = false;
export function assertProductionConfig(): void {
  if (_startupChecked) return;
  _startupChecked = true;
  if (env.NODE_ENV !== "production") return;
  const missing: string[] = [];
  if (!env.APP_PUBLIC_URL) missing.push("APP_PUBLIC_URL");
  if (!env.CRON_SECRET) missing.push("CRON_SECRET");
  if (!env.NEXTAUTH_URL) missing.push("NEXTAUTH_URL");
  // 拦截 .env.example 里的占位 NEXTAUTH_SECRET
  if (env.NEXTAUTH_SECRET.startsWith("please-change-me")) {
    throw new Error("NEXTAUTH_SECRET 仍是 .env.example 的占位值,生产前必须重生成");
  }
  // 拦截 .env.example 里的占位 APP_ENC_KEY_HEX(全 0)
  if (/^0+$/.test(env.APP_ENC_KEY_HEX)) {
    throw new Error("APP_ENC_KEY_HEX 仍是全 0 占位值,生产前必须生成随机 32 字节 hex");
  }
  if (missing.length > 0) {
    throw new Error(`生产环境缺少必需的环境变量: ${missing.join(", ")}`);
  }
}

// 解析最终对外 base URL(供邮件/企微通知链接使用)
export function getPublicBaseUrl(): string {
  assertProductionConfig();
  return (env.APP_PUBLIC_URL ?? env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}