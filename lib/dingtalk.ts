// 钉钉企业内部应用 - 扫码登录 upstream 封装
// 设计要点:
//   - access_token 内存缓存,TTL 7000s(钉钉 7200s 留 200s 缓冲),按 appKey 索引
//   - 不引入新 SDK,直接 fetch 钉钉 OpenAPI
//   - endpoint 常量集中在本文件,后续钉钉文档变更只动这里
import { env } from "./env";
import { ApiError } from "./api";
import { ERROR_CODES } from "@/types/errors";

const TOKEN_TTL_MS = 7000 * 1000;
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

const ENDPOINT_GET_TOKEN = "https://oapi.dingtalk.com/gettoken";
const ENDPOINT_QRCODE = "https://oapi.dingtalk.com/connect/oauth2/sns_authorize";
const ENDPOINT_POLL = "https://oapi.dingtalk.com/connect/oauth2/sns_token";
const ENDPOINT_USER_INFO_BY_CODE = "https://oapi.dingtalk.com/topapi/v2/user/getuserinfo";
const ENDPOINT_USER_GET = "https://oapi.dingtalk.com/topapi/v2/user/get";

function requireCreds() {
  if (!env.DINGTALK_APP_KEY || !env.DINGTALK_APP_SECRET) {
    throw new ApiError(ERROR_CODES.DINGTALK_NOT_CONFIGURED, "钉钉未配置", 503);
  }
  return { appKey: env.DINGTALK_APP_KEY, appSecret: env.DINGTALK_APP_SECRET };
}

async function getAccessToken(): Promise<string> {
  const { appKey, appSecret } = requireCreds();
  const cached = tokenCache.get(appKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const url = `${ENDPOINT_GET_TOKEN}?appkey=${encodeURIComponent(appKey)}&appsecret=${encodeURIComponent(appSecret)}`;
  const res = await fetch(url);
  if (!res.ok) throw new ApiError(ERROR_CODES.DINGTALK_UPSTREAM_ERROR, `gettoken HTTP ${res.status}`, 502);
  const json = (await res.json()) as { access_token?: string; errcode?: number; errmsg?: string };
  if (!json.access_token) throw new ApiError(ERROR_CODES.DINGTALK_UPSTREAM_ERROR, `gettoken: ${json.errmsg ?? "no token"}`, 502);
  tokenCache.set(appKey, { token: json.access_token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return json.access_token;
}

export type QrCodeResult = { qrcodeUrl: string; tmpCode: string; expiresIn: number };

export async function getQrCode(): Promise<QrCodeResult> {
  const { appKey } = requireCreds();
  const accessToken = await getAccessToken();
  const url = `${ENDPOINT_QRCODE}?access_token=${accessToken}&appid=${appKey}&response_type=code&scope=snsapi_login&state=`;
  const res = await fetch(url);
  if (!res.ok) throw new ApiError(ERROR_CODES.DINGTALK_UPSTREAM_ERROR, `qrcode HTTP ${res.status}`, 502);
  const json = (await res.json()) as { tmpCode?: string; expiresIn?: number; qrcodeUrl?: string; errmsg?: string };
  if (!json.tmpCode) throw new ApiError(ERROR_CODES.DINGTALK_UPSTREAM_ERROR, `qrcode: ${json.errmsg ?? "no tmpCode"}`, 502);
  return {
    qrcodeUrl: json.qrcodeUrl ?? url + (json.tmpCode ?? ""),
    tmpCode: json.tmpCode,
    expiresIn: json.expiresIn ?? 180,
  };
}

export type PollResult =
  | { status: "PENDING" }
  | { status: "WAITING_CONFIRM" }
  | { status: "CANCELLED" }
  | { status: "CONFIRMED"; authCode: string };

export async function pollQrCode(tmpCode: string): Promise<PollResult> {
  const accessToken = await getAccessToken();
  const url = `${ENDPOINT_POLL}?access_token=${accessToken}&tmpCode=${encodeURIComponent(tmpCode)}`;
  const res = await fetch(url);
  if (!res.ok) throw new ApiError(ERROR_CODES.DINGTALK_UPSTREAM_ERROR, `poll HTTP ${res.status}`, 502);
  const json = (await res.json()) as { status?: string; authCode?: string; errmsg?: string };
  switch (json.status) {
    case "PENDING":
      return { status: "PENDING" };
    case "WAITING_CONFIRM":
      return { status: "WAITING_CONFIRM" };
    case "CANCELLED":
      return { status: "CANCELLED" };
    case "CONFIRMED":
      if (!json.authCode) throw new ApiError(ERROR_CODES.DINGTALK_UPSTREAM_ERROR, "poll: missing authCode", 502);
      return { status: "CONFIRMED", authCode: json.authCode };
    default:
      throw new ApiError(ERROR_CODES.DINGTALK_UPSTREAM_ERROR, `poll: ${json.errmsg ?? "unknown status"}`, 502);
  }
}

export type UserInfo = { unionid: string; mobile: string; nick: string };

export async function getUserInfoByAuthCode(authCode: string): Promise<UserInfo> {
  const accessToken = await getAccessToken();
  // 1) authCode -> userid (即 unionid)
  const r1 = await fetch(`${ENDPOINT_USER_INFO_BY_CODE}?access_token=${accessToken}&code=${encodeURIComponent(authCode)}`);
  if (!r1.ok) throw new ApiError(ERROR_CODES.DINGTALK_UPSTREAM_ERROR, `userinfo HTTP ${r1.status}`, 502);
  const j1 = (await r1.json()) as { result?: { userid?: string }; errmsg?: string };
  const userid = j1.result?.userid;
  if (!userid) throw new ApiError(ERROR_CODES.DINGTALK_UPSTREAM_ERROR, `userinfo: ${j1.errmsg ?? "no userid"}`, 502);

  // 2) userid -> mobile / nick
  const r2 = await fetch(`${ENDPOINT_USER_GET}?access_token=${accessToken}&userid=${encodeURIComponent(userid)}`);
  if (!r2.ok) throw new ApiError(ERROR_CODES.DINGTALK_UPSTREAM_ERROR, `user.get HTTP ${r2.status}`, 502);
  const j2 = (await r2.json()) as { result?: { mobile?: string; nick?: string }; errmsg?: string };
  const mobile = j2.result?.mobile;
  if (!mobile) throw new ApiError(ERROR_CODES.DINGTALK_UPSTREAM_ERROR, `user.get: ${j2.errmsg ?? "no mobile"}`, 502);
  return { unionid: userid, mobile, nick: j2.result?.nick ?? "" };
}
