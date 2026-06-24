// 消息中心 / 仪表盘 shell 都要把消息 link.kind 翻成前端路径.
// 历史上两处 (app/(app)/messages/page.tsx + components/dashboard-shell.tsx)
// 各自 inline 了一份 map, 加 kind 容易漏改一边. 抽到这里统一维护.
//
// buildLinkHref 同时做防御性归一化: link 为 null / id 缺失 / 未知 kind
// 一律视为无跳转目标, 避免出现 `${undefined}/...` 这种坏 URL.
//
// 额外字段（如 CUSTOMER_STATUS_SUGGEST 的 suggest）会作为 query string 拼回，
// 保证通知跳转能携带业务上下文。

export const MESSAGE_LINK_PATH: Record<string, string> = {
  contract: "/contracts",
  invoice: "/invoices",
  payment: "/payments",
  project: "/projects",
  customer: "/customers",
};

export type MessageLink = { kind: string; id?: string | null } & Record<string, unknown>;

export function buildMessageLinkHref(link: MessageLink | null): string | null {
  if (!link || !link.id) return null;
  const { kind, id, ...rest } = link;
  const base = MESSAGE_LINK_PATH[kind];
  if (!base) return null;

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      params.set(k, String(v));
    }
  }
  const qs = params.toString();
  return `${base}/${id}${qs ? `?${qs}` : ""}`;
}
