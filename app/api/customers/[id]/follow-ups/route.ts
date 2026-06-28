// 客户跟进 API — 已下线
//
// 2026-06: 跟进 (FollowUp) 功能下线, 状态机建议信号改用 lastActivityAt (合同/回款/客户更新时间).
// 历史 FollowUp 数据保留在 DB, 仅供运维查询, 不再开放读写.
//
// 行为: 任何方法 (GET / POST) 都返回 410 Gone + 明确原因, 避免客户端缓存或脚本静默失效.
import { err, ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { runWithRequestContext } from "@/lib/request-context";

export async function GET(): Promise<Response> {
  return runWithRequestContext(new Request("http://internal/"), async () => {
    return err(
      new ApiError(
        ERROR_CODES.INTERNAL_ERROR,
        "客户跟进功能已下线, 历史数据请走运维查询",
        410,
      ),
    );
  });
}

export async function POST(): Promise<Response> {
  return runWithRequestContext(new Request("http://internal/"), async () => {
    return err(
      new ApiError(
        ERROR_CODES.INTERNAL_ERROR,
        "客户跟进功能已下线, 状态变更请走手动 PATCH /api/customers/[id]",
        410,
      ),
    );
  });
}
