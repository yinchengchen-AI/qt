// GET /api/messages/stream — Server-Sent Events 通知流
//
// 用法 (前端):
//   const es = new EventSource("/api/messages/stream", { withCredentials: true });
//   es.addEventListener("kick", () => mutate("/api/messages/unread-count"));
//
// 后端:
//   - 单条 EventSource 长连接,每个用户 1 个
//   - hub.subscribe 把 controller 登记到 Map<userId, Set<Sub>>
//   - 25s 心跳 :keepalive (nginx 默认 proxy_read_timeout 60s,无心跳会切断)
//   - 关闭时 controller.close() → hub unsubscribe
import { NextResponse } from "next/server";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { subscribe, heartbeatFrame } from "@/server/notifications/hub";
import "@/server/notifications/scheduler"; // 启动 5s kick 调度器
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
// 长连接;Next.js dev / Node 生产都允许 maxDuration 上调
export const maxDuration = 3600; // 1 小时
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    let userId: string;
    try {
      const user = await requireSession();
      userId = user.id;
    } catch (e) {
      // 鉴权失败仍按 JSON 错误返回 (EventSource 无法解析非 text/event-stream)
      const message = e instanceof Error ? e.message : "unauthorized";
      return NextResponse.json({ code: 401, errorCode: "UNAUTHORIZED", message }, { status: 401 });
    }

    const encoder = new TextEncoder();
    let cleanup: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // 立刻发一个 ready event:前端 EventSource 立即收到 first frame,
        // 浏览器会认为 stream 已 active,不再触发 immediate reconnect
        controller.enqueue(encoder.encode(`event: ready\ndata: {"userId":"${userId}"}\n\n`));
        // 注册到 hub
        cleanup = subscribe(userId, controller);
        // 心跳
        heartbeat = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(heartbeatFrame());
          } catch {
            closed = true;
            if (heartbeat) clearInterval(heartbeat);
            if (cleanup) cleanup();
          }
        }, HEARTBEAT_MS);
        logger.debug?.(`[messages-stream] open uid=${userId}`);
      },
      cancel() {
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (cleanup) cleanup();
        logger.debug?.(`[messages-stream] close uid=${userId}`);
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        // 强制 nginx / 反代不缓冲
        "X-Accel-Buffering": "no"
      }
    });
  });
}
