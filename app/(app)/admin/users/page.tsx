"use client";
import { Alert } from "antd";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";

export default function UsersPage() {
  return (
    <Page>
      <PageHeader
        title="用户管理"
        subtitle="系统用户、角色与权限"
      />
      <Alert
        type="info"
        showIcon
        message="用户管理 UI 计划在 P3 实施"
        description="当前版本仅支持通过 Prisma Studio (pnpm prisma:studio) 或 psql 直接管理用户；测试账号 admin/sales/finance/ops 已在 seed 阶段创建。"
      />
    </Page>
  );
}
