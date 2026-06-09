"use client";
import { Result, Button } from "antd";

export default function NotFound() {
  return (
    <Result
      status="404"
      title="404"
      subTitle="抱歉，页面不存在。"
      extra={
        <Button type="primary" href="/dashboard">
          返回工作台
        </Button>
      }
    />
  );
}
