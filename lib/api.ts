// 统一 API 响应封装
import { NextResponse } from "next/server";
import { ERROR_CODES, type ErrorCode } from "@/types/errors";

export type ApiOk<T> = { code: 0; data: T; message?: string };
export type ApiErr = { code: number; errorCode: ErrorCode; message: string; details?: unknown };

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json<ApiOk<T>>({ code: 0, data }, init);
}

export class ApiError extends Error {
  status: number;
  errorCode: ErrorCode;
  details?: unknown;
  constructor(errorCode: ErrorCode, message?: string, status = 400, details?: unknown) {
    super(message ?? errorCode);
    this.errorCode = errorCode;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

export function err(e: unknown) {
  if (e instanceof ApiError) {
    return NextResponse.json<ApiErr>(
      { code: e.status, errorCode: e.errorCode, message: e.message, details: e.details },
      { status: e.status }
    );
  }
  // Zod 错误: 只返回 path + message, 避免把原始输入值/内部字段详情泄漏到响应
  if (e && typeof e === "object" && "issues" in (e as { issues?: unknown })) {
    const rawIssues = (e as { issues: Array<{ path: Array<string | number>; message: string }> }).issues ?? [];
    const issues = rawIssues.map((issue) => ({ path: issue.path, message: issue.message }));
    const firstIssue = issues[0];
    const firstPath = firstIssue ? firstIssue.path.join(".") : "";
    const firstMsg = firstIssue ? firstIssue.message : "数据校验失败";
    const summary = issues.length > 1
      ? `${firstPath ? firstPath + ": " : ""}${firstMsg} (还有 ${issues.length - 1} 个错误)`
      : `${firstPath ? firstPath + ": " : ""}${firstMsg}`;
    return NextResponse.json<ApiErr>(
      {
        code: 400,
        errorCode: ERROR_CODES.VALIDATION_FAILED,
        message: summary || "数据校验失败",
        details: issues
      },
      { status: 400 }
    );
  }
  console.error("Unhandled API error:", e);
  return NextResponse.json<ApiErr>(
    { code: 500, errorCode: ERROR_CODES.INTERNAL_ERROR, message: "服务器内部错误" },
    { status: 500 }
  );
}
