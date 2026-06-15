"use client";
import { App } from "antd";
import { useRouter } from "next/navigation";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { AssetForm } from "@/components/assets/asset-form";

export default function NewAssetPage() {
  const router = useRouter();
  const { message } = App.useApp();

  return (
    <Page compact>
      <PageHeader
        title="录入企业资产"
        back={() => router.push("/assets")}
        subtitle="资产编号、录入人、录入时间由系统自动生成"
      />
      <AssetForm
        mode="create"
        onCancel={() => router.push("/assets")}
        onSubmit={async (values) => {
          try {
            const body = {
              ...values,
              tags: Array.isArray(values.tags) ? values.tags : [],
              validFrom: values.validFrom || undefined,
              validTo: values.validTo || undefined
            };
            const res = await fetch("/api/assets", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify(body)
            });
            const j = await res.json();
            if (j.code !== 0) {
              message.error(j.message ?? "创建失败");
              return false;
            }
            message.success("创建成功");
            return { id: j.data.id as string };
          } catch (e) {
            message.error(`创建失败: ${(e as Error).message}`);
            return false;
          }
        }}
        redirectOnSave={({ id }) => `/assets/${id}`}
      />
    </Page>
  );
}
