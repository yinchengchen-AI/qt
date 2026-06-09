"use client";
import { Result, Button } from "antd";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="zh-CN">
      <body>
        <Result
          status="500"
          title="500"
          subTitle="抱歉，页面出现错误。"
          extra={
            <Button type="primary" onClick={reset}>
              重试
            </Button>
          }
        >
          {error.message ? <div style={{ color: "#999", fontSize: 12 }}>{error.message}</div> : null}
        </Result>
      </body>
    </html>
  );
}
