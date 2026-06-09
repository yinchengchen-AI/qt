// 统一的"读当前会话 / 强制鉴权"工具
import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { ApiError } from "./api";
import { ERROR_CODES } from "@/types/errors";
import type { RoleCode } from "@/types/enums";

export type SessionUser = {
  id: string;
  employeeNo: string;
  name: string;
  email: string;
  roleCode: RoleCode;
  permissions: { resource: import("./permissions").Resource; actions: import("./permissions").Action[] }[];
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  return (session?.user as SessionUser | undefined) ?? null;
}

export async function requireSession(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) throw new ApiError(ERROR_CODES.UNAUTHORIZED, "请先登录", 401);
  return u;
}
