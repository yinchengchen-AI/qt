"use client";
import { useCallback } from "react";
import { App as AntdApp } from "antd";

export type UseActionCallOptions = {
  /** 例如 `/api/contracts/${id}`,所有 run 调用都会 POST 到 `${baseUrl}/${action}` */
  baseUrl: string;
  /** 操作成功后调用,通常是 SWR 的 mutate */
  reload?: () => unknown;
  /** 成功提示;默认 "操作成功" */
  successMessage?: string;
};

export type RunResult = boolean;

/**
 * 详情页的"动作按钮"共用:POST 到 baseUrl/action,处理错误消息 + 成功提示 + 触发 reload。
 * 模态确认 (Modal.confirm) 仍在各页内实现,因为每个动作的输入字段差异较大。
 */
export function useActionCall(options: UseActionCallOptions) {
  const { message } = AntdApp.useApp();

  const run = useCallback(
    async (action: string, body: unknown = {}): Promise<RunResult> => {
      try {
        const res = await fetch(`${options.baseUrl}/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body)
        });
        const j = await res.json();
        if (j.code !== 0) {
          message.error(j.message);
          return false;
        }
        message.success(options.successMessage ?? "操作成功");
        if (options.reload) await options.reload();
        return true;
      } catch (e) {
        message.error((e as Error).message);
        return false;
      }
    },
    [options, message]
  );

  return { run };
}
