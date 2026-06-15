"use client";
import { use, useState, useEffect } from "react";
import { App, Spin } from "antd";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { AssetForm } from "@/components/assets/asset-form";
import { ASSET_TYPE_MAP } from "@/lib/enum-maps";

type Asset = {
  id: string;
  type: string;
  name: string;
  description: string | null;
  attributes: Record<string, unknown>;
  tags: string[];
  validFrom: string | null;
  validTo: string | null;
};

export default function EditAssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { message } = App.useApp();
  const { data: asset, isLoading } = useSWR<Asset>(`/api/assets/${id}`);
  const [hydrated, setHydrated] = useState(false);

  // 等 SWR 数据 ready 后再渲染表单,避免 ProForm initialValues 被空对象覆盖
  useEffect(() => { setHydrated(true); }, []);

  if (isLoading || !asset || !hydrated) {
    return <Page><PageHeader title="编辑资产" back={() => router.push(`/assets/${id}`)} /><Spin /></Page>;
  }

  return (
    <Page compact>
      <PageHeader
        title={`编辑资产:${asset.name}`}
        back={() => router.push(`/assets/${id}`)}
        subtitle={`类型:${ASSET_TYPE_MAP[asset.type] ?? asset.type}(不可修改)`}
      />
      <AssetForm
        mode="edit"
        initialValues={{
          type: asset.type,
          name: asset.name,
          description: asset.description,
          tags: asset.tags,
          validFrom: asset.validFrom,
          validTo: asset.validTo,
          attributes: asset.attributes
        }}
        redirectOnSave={`/assets/${id}`}
        onCancel={() => router.push(`/assets/${id}`)}
        onSubmit={async (values) => {
          try {
            const body = {
              name: values.name,
              description: values.description || "",
              tags: Array.isArray(values.tags) ? values.tags : [],
              validFrom: values.validFrom || undefined,
              validTo: values.validTo || undefined,
              attributes: values.attributes
            };
            const res = await fetch(`/api/assets/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify(body)
            });
            const j = await res.json();
            if (j.code !== 0) {
              message.error(j.message ?? "保存失败");
              return false;
            }
            message.success("保存成功");
            return true;
          } catch (e) {
            message.error(`保存失败: ${(e as Error).message}`);
            return false;
          }
        }}
      />
    </Page>
  );
}
