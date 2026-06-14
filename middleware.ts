// 简易限流:登录端点 + CRON 端点防爆破
// 设计:
//   - 内存 LRU,按 (ip, route) 桶分计数
//   - 登录:每 IP 5 次/分钟,超过直接 429
//   - CRON:每 IP 10 次/分钟(正常 cron 频率低,留余量)
//
// 注意:Next.js middleware 跑在 Edge runtime;此实现不依赖 Node 特有 API,
// 部署到 Vercel / 自托管 Node 都能用。多实例部署需替换为共享存储(Redis)。

import { NextRequest, NextResponse } from "next/server";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5000;

function getClientIp(req: NextRequest): string {
  // Vercel/Cloudflare/Nginx 反代通用顺序
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count += 1;
  if (b.count > limit) return false;
  return true;
}

function gcIfNeeded() {
  if (buckets.size <= MAX_BUCKETS) return;
  const now = Date.now();
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // 登录端点:NextAuth 把所有 /api/auth/* 都路由过来,这里只对 credentials 回调限流
  // (其它端点如 session/csrf 频次低且安全由 NextAuth 自身管)
  if (pathname === "/api/auth/callback/credentials" || pathname === "/api/auth/signin") {
    const ip = getClientIp(req);
    if (!allow(`login:${ip}`, 5, 60_000)) {
      return new NextResponse("Too Many Requests", { status: 429 });
    }
  } else if (pathname === "/api/jobs/run-all") {
    const ip = getClientIp(req);
    if (!allow(`cron:${ip}`, 10, 60_000)) {
      return new NextResponse("Too Many Requests", { status: 429 });
    }
  }
  gcIfNeeded();
  return NextResponse.next();
}

export const config = {
  // 只对鉴权/CRON 端点跑;其它路径交给路由层
  matcher: [
    "/api/auth/callback/:path*",
    "/api/auth/signin",
    "/api/jobs/run-all"
  ]
};
