"use client";
import Link from "next/link";
import { Button, Result, Space } from "antd";
import { Page } from "@/components/page";

export default function NotFound() {
  return (
    <Page centered>
      <Result
        status="404"
        title="404"
        subTitle="抱歉，您访问的页面不存在或已被移动。"
        extra={
          <Space>
            <Link href="/dashboard">
              <Button type="primary">返回工作台</Button>
            </Link>
            <Link href="/login">
              <Button>重新登录</Button>
            </Link>
          </Space>
        }
      />
    </Page>
  );
}
