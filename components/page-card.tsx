"use client";
import { ProCard } from "@ant-design/pro-components";
import { Button, Space } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

type Props = {
  title: ReactNode;
  back?: boolean | string; // true → /，或自定义路径
  extra?: ReactNode;
  children: ReactNode;
};

export function PageCard({ title, back, extra, children }: Props) {
  const router = useRouter();
  const head = (
    <Space>
      {back !== undefined && back !== false && (
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => (typeof back === "string" ? router.push(back) : router.back())}
        />
      )}
      <span>{title}</span>
      {extra && <span style={{ marginLeft: "auto" }}>{extra}</span>}
    </Space>
  );
  return (
    <ProCard title={head}>
      {children}
    </ProCard>
  );
}
