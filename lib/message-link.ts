// 消息中心 / 仪表盘 shell 都要把消息 link.kind 翻成前端路径.
// 历史上两处 (app/(app)/messages/page.tsx + components/dashboard-shell.tsx)
// 各自 inline 了一份 map, 加 kind 容易漏改一边. 抽到这里统一维护.
//
// buildLinkHref 同时做防御性归一化: link 为 null / id 缺失 / 未知 kind
// 一律视为无跳转目标, 避免出现 `${undefined}/...` 这种坏 URL.

export const MESSAGE_LINK_PATH: Record<string, string> = {
  contract: "/contracts",
  invoice: "/invoices",
  payment: "/payments",
  project: "/projects",
  customer: "/customers",
  asset: "/assets"
};

export type MessageLink = { kind: string; id?: string | null } | null;

export function buildMessageLinkHref(link: MessageLink): string | null {
  if (!link || !link.id) return null;
  const base = MESSAGE_LINK_PATH[link.kind];
  if (!base) return null;
  return `${base}/${link.id}`;
}
