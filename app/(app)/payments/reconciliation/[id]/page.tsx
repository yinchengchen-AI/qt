import { redirect } from "next/navigation";

// 对账中心没有独立详情页: 消息中心链接 (kind=reconciliation) 按 buildMessageLinkHref
// 约定生成 /payments/reconciliation/<txId>, 这里重定向到列表页 ?txId=<id>,
// 由列表页自动打开该流水的详情抽屉。
export default async function ReconciliationTransactionRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/payments/reconciliation?txId=${encodeURIComponent(id)}`);
}
