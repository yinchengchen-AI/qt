"use client";
import { Result, Button, Space } from "antd";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // 生产环境绝不直接渲染 error.message:可能包含 DB 错误文本/文件路径/堆栈片段
  // 仅展示 stable 的 error.digest,详细消息应进 Sentry/日志
  const showMessage = process.env.NODE_ENV !== "production" && !!error.message;
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
          {error.digest ? (
            <p style={{ marginTop: 12, color: "#999", fontSize: 12 }}>
              错误编号: {error.digest}
            </p>
          ) : null}
          {showMessage ? (
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
