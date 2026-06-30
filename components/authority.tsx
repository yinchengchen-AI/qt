// 简易 Authority 组件: 客户端按 session.permissions 判断, 不通过则不渲染 children
// 用法: <Authority code="DUNNING:CREATE"><Button .../></Authority>
// 也可以用 resource + action: <Authority resource={RESOURCE.DUNNING} action={ACTION.CREATE}>...
// session 从 next-auth/react 拿; 后端仍走 requirePermission 作为硬性兜底
"use client";

import type { ReactNode } from "react";
import { useSession } from "next-auth/react";
import { hasPermission, RESOURCE, ACTION, type Resource, type Action } from "@/lib/permissions";

type Props = {
  children: ReactNode;
  /** 形如 "DUNNING:CREATE" 的快捷方式, 优先级低于 resource+action */
  code?: string;
  resource?: Resource;
  action?: Action;
  /** 找不到权限时显示的占位 (默认 null, 即不渲染) */
  fallback?: ReactNode;
};

function parseCode(code: string): { resource?: Resource; action?: Action } {
  const [r, a] = code.split(":");
  if (!r || !a) return {};
  return { resource: r as Resource, action: a as Action };
}

export function Authority({ children, code, resource, action, fallback = null }: Props) {
  const { data: session } = useSession();
  const role = session?.user?.roleCode;
  if (!role) return <>{fallback}</>;
  let r = resource;
  let a = action;
  if (!r || !a) {
    if (code) {
      const parsed = parseCode(code);
      r = r ?? parsed.resource;
      a = a ?? parsed.action;
    }
  }
  if (!r || !a) return <>{children}</>;
  const allowed = hasPermission(role, r, a);
  return <>{allowed ? children : fallback}</>;
}

// 命名导出 RESOURCE / ACTION, 方便页面直接 import { RESOURCE } from "@/components/authority"
export { RESOURCE, ACTION };
