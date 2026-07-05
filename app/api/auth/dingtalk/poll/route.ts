import { ok, err } from "@/lib/api";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { prisma } from "@/lib/prisma";
import { runWithRequestContext } from "@/lib/request-context";
import { audit } from "@/server/audit";
import { pollQrCode, getUserInfoByAuthCode } from "@/lib/dingtalk";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    const url = new URL(req.url);
    const state = url.searchParams.get("state");
    if (!state) return err(new ApiError(ERROR_CODES.DINGTALK_STATE_NOT_FOUND, undefined, 404));

    const row = await prisma.dingtalkLoginCode.findUnique({ where: { state } });
    if (!row) return err(new ApiError(ERROR_CODES.DINGTALK_STATE_NOT_FOUND, undefined, 404));
    if (Date.now() > row.expiresAt.getTime()) {
      return ok({ status: "EXPIRED" });
    }
    if (row.status === "READY" || row.status === "CONSUMED") {
      return ok({ status: row.status });
    }
    if (row.status !== "PENDING") {
      return ok({ status: row.status });
    }

    try {
      const poll = await pollQrCode(row.tmpCode);
      if (poll.status === "PENDING" || poll.status === "WAITING_CONFIRM") {
        return ok({ status: "PENDING" });
      }
      if (poll.status === "CANCELLED") {
        await prisma.dingtalkLoginCode.updateMany({
          where: { id: row.id, status: "PENDING" },
          data: { status: "CANCELLED" },
        });
        return ok({ status: "CANCELLED" });
      }
      // CONFIRMED: fetch user info then mark READY
      const info = await getUserInfoByAuthCode(poll.authCode);
      await prisma.dingtalkLoginCode.updateMany({
        where: { id: row.id, status: "PENDING" },
        data: { status: "READY", unionid: info.unionid, mobile: info.mobile, nick: info.nick },
      });
      return ok({ status: "READY" });
    } catch (e) {
      // upstream failure: return PENDING so frontend keeps polling, log audit
      await prisma.$transaction(async (tx) => {
        await audit(tx, {
          actorId: null,
          action: "dingtalk_poll",
          entity: "DingtalkLoginCode",
          entityId: row.id,
          status: "FAILURE",
          errorMessage: e instanceof Error ? e.message : String(e),
        });
      });
      return ok({ status: "PENDING" });
    }
  });
}