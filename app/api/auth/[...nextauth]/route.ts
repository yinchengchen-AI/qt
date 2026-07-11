import { NextRequest, NextResponse } from "next/server";
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  isIpRateLimited,
  recordIpFail,
  clearIpFails
} from "@/lib/login-rate-limit";

// 包装 NextAuth handler: 在 signin POST 进入前先做 IP 限速
// NextAuth v4 的 authorize() 拿不到请求, 所以 IP 限速只能在 route 这一层
const handler = NextAuth(authOptions);

function getClientIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  // Next 16 + 反代: NextRequest.ip 是 Next.js 计算出的客户端 IP
  const nextIp = (req as NextRequest & { ip?: string }).ip;
  if (nextIp) return nextIp;
  return null;
}

async function wrapped(req: NextRequest, ctx: { params: unknown }) {
  const url = new URL(req.url);
  const isCredentialsSignIn =
    req.method === "POST" &&
    url.pathname.endsWith("/callback/credentials");

  if (isCredentialsSignIn) {
    const ip = getClientIp(req);
    if (ip && isIpRateLimited(ip)) {
      recordIpFail(ip);
      return NextResponse.json(
        { error: "Too many failed attempts. Try again later." },
        { status: 429 }
      );
    }
    // 让 NextAuth 正常处理, 通过 events/authorize 配合 clearIpFails 在成功时清掉
    const res = await handler(req, ctx);
    // 仅当响应是 200 + 没 error 时清 IP 计数; NextAuth 在 signIn 成功时返回 JSON { url }
    if (res.status === 200 && ip) {
      try {
        const clone = res.clone();
        const j = await clone.json();
        if (j && (j.url || (!j.error && !j.code))) {
          clearIpFails(ip);
        }
      } catch {
        // 非 JSON (例如 302 redirect) 视为成功
        clearIpFails(ip);
      }
    } else if (ip) {
      // 失败也算一次 IP 失败 (跟用户计数并行)
      recordIpFail(ip);
    }
    return res;
  }
  return handler(req, ctx);
}

export { wrapped as GET, wrapped as POST };
