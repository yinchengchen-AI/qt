import { randomBytes } from "node:crypto";
import { ok, err } from "@/lib/api";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { isDingtalkEnabled } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getQrCode } from "@/lib/dingtalk";

const QR_TTL_SECONDS = 180;
const POLL_INTERVAL_MS = 1500;

export async function GET() {
  if (!isDingtalkEnabled()) {
    return err(new ApiError(ERROR_CODES.DINGTALK_NOT_CONFIGURED, undefined, 503));
  }
  try {
    const upstream = await getQrCode();
    const state = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + QR_TTL_SECONDS * 1000);
    await prisma.dingtalkLoginCode.create({
      data: {
        state,
        tmpCode: upstream.tmpCode,
        status: "PENDING",
        expiresAt,
      },
    });
    return ok({
      qrcodeUrl: upstream.qrcodeUrl,
      state,
      expiresIn: upstream.expiresIn,
      pollIntervalMs: POLL_INTERVAL_MS,
    });
  } catch (e) {
    if (e instanceof ApiError) return err(e);
    console.error("[dingtalk/qrcode] unexpected", e);
    return err(new ApiError(ERROR_CODES.DINGTALK_UPSTREAM_ERROR, undefined, 502));
  }
}