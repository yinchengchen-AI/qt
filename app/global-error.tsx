"use client";
import { Result, Button, Space } from "antd";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, minHeight: "100vh" }}>
        <Result
          status="500"
          title="500"
          subTitle="抱歉，服务在处理您的请求时发生了错误。"
          extra={
            <Space>
              <Button type="primary" onClick={reset}>
                重试
              </Button>
              <Button href="/dashboard">返回工作台</Button>
            </Space>
          }
        >
          {error.message ? (
            <pre
              style={{
                maxWidth: 560,
                margin: "12px auto 0",
                padding: "10px 14px",
                fontSize: 12,
                background: "#f5f5f5",
                border: "1px solid #d9d9d9",
                borderRadius: 6,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word"
              }}
            >
              {error.message}
            </pre>
          ) : null}
        </Result>
      </body>
    </html>
  );
}
