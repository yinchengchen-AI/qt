// 请求上下文：用 AsyncLocalStorage 在 API 路由 → service → audit() 之间传递
// 一次请求的"环境信息"（IP / UA / 请求 ID / method / path），让 audit() 不需要
// 每个调用方都手动塞进去。
//
// 用法:
//   // 路由入口
//   export async function POST(req: Request) {
//     return runWithRequestContext(req, async () => {
//       const user = await requireSession();
//       await createCustomer(user, body);
//       return ok({});
//     });
//   }
//
//   // service / audit() 内任意深度
//   const ctx = getRequestContext();
//   audit(tx, { actorId, action, entity, entityId });  // 自动从 ctx 取 IP/UA/...
//
// 设计取舍:
//   - 用 ALS 而不是透传参数：60+ 处 audit() 调用方零改动
//   - 拿不到 ctx 时（脚本 / 测试 / job 触发） audit 仍可工作，新字段为 null
//   - requestId 优先取 header（便于排查方关联前后端日志），否则按需生成
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type RequestContext = {
  /** 客户端 IP（从 x-forwarded-for / x-real-ip 取首跳） */
  ip: string | null;
  /** User-Agent 截断到 500 字符 */
  userAgent: string | null;
  /** 请求 ID；优先 X-Request-Id header，否则当场生成 */
  requestId: string;
  /** HTTP method */
  method: string;
  /** 请求路径（不含 query string） */
  path: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

const UA_MAX = 500;

/** 从标准 Request 头里抽取 IP / UA / requestId / method / path */
function buildContext(req: Request): RequestContext {
  const url = new URL(req.url);
  const xff = req.headers.get("x-forwarded-for");
  const real = req.headers.get("x-real-ip");
  const ip = xff?.split(",")[0]?.trim() || real || null;
  const uaRaw = req.headers.get("user-agent");
  const userAgent = uaRaw
    ? uaRaw.length > UA_MAX
      ? uaRaw.slice(0, UA_MAX)
      : uaRaw
    : null;
  const headerRid =
    req.headers.get("x-request-id") || req.headers.get("x-correlation-id");
  const requestId = headerRid || randomUUID();
  return {
    ip,
    userAgent,
    requestId,
    method: req.method.toUpperCase(),
    path: url.pathname,
  };
}

/** 把 ctx 写入 ALS 并执行 fn；推荐在每个 API route 入口调用一次 */
export function runWithRequestContext<T>(
  req: Request,
  fn: () => Promise<T> | T,
): Promise<T> {
  return Promise.resolve(storage.run(buildContext(req), fn));
}

/** 读取当前请求 ctx；没有上下文（脚本 / 单元测试）时返回 null */
export function getRequestContext(): RequestContext | null {
  return storage.getStore() ?? null;
}
