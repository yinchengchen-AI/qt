import type { Metadata } from "next";
import Link from "next/link";
import { Button, Result, Space } from "antd";
import { Page } from "@/components/page";

export const metadata: Metadata = {
  title: "服务暂不可用 - 502 Bad Gateway",
  description:
    "后端服务暂时无法响应。请稍后重试,或联系系统管理员。"
};

type SearchParams = {
  /** 触发 502 的原始 URL (可选) */
  from?: string;
  /** 重试间隔秒数, 仅展示用 */
  retryAfter?: string;
};

export default async function BadGatewayPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const from = sp.from;
  const retryAfter = sp.retryAfter;

  return (
    <Page centered>
      <Result
        status="500"
        title="502"
        subTitle="抱歉,后端服务暂时无法响应您的请求。"
        extra={
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Space wrap>
              <Button type="primary" href={from || "/dashboard"}>
                重试
              </Button>
              <Link href="/login">
                <Button>重新登录</Button>
              </Link>
            </Space>
            {retryAfter ? (
              <p style={{ margin: 0, color: "#999", fontSize: 13 }}>
                建议 {retryAfter} 秒后重试
              </p>
            ) : (
              <p style={{ margin: 0, color: "#999", fontSize: 13 }}>
                如多次出现,请联系系统管理员查看服务状态
              </p>
            )}
            {from ? (
              <p
                style={{
                  margin: 0,
                  color: "#bbb",
                  fontSize: 12,
                  maxWidth: 560,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}
                title={from}
              >
                原始请求: {from}
              </p>
            ) : null}
          </Space>
        }
      >
        <p
          style={{
            marginTop: 24,
            color: "#666",
            fontSize: 13,
            maxWidth: 480
          }}
        >
          可能原因:应用服务正在重启、数据库或存储暂时不可用、网关层超时。
          页面不会自动刷新,请点击「重试」或稍候再试。
        </p>
      </Result>
    </Page>
  );
}