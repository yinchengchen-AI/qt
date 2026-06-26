"use client";

import { useParams, useRouter } from "next/navigation";
import { useGoBack } from "@/lib/navigation";
import useSWR from "swr";
import { FormPageSkeleton } from "@/components/form-page-skeleton";
import { CustomerForm, type CustomerFormValues } from "@/components/customers/customer-form";

export default function EditCustomerPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const goBack = useGoBack("/customers");
  const { data, isLoading } = useSWR<CustomerFormValues & { code: string }>(`/api/customers/${id}`);

  if (isLoading || !data) {
    return (
      <CustomerForm
        mode="edit"
        title="编辑客户"
        back={goBack}
        submitText="保存"
        onSubmit={async () => ({ ok: false, message: "数据加载中" })}
      >
        <FormPageSkeleton />
      </CustomerForm>
    );
  }

  return (
    <CustomerForm
      mode="edit"
      title={`编辑 ${data.name ?? ""}`}
      subtitle={`客户编号 ${data.code} 不可修改;创建人 / 创建时间详见详情页`}
      submitText="保存"
      back={goBack}
      initialValues={data}
      onSubmit={async (values: CustomerFormValues) => {
        const res = await fetch(`/api/customers/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(values)
        });
        const j = await res.json();
        if (j.code !== 0) {
          return { ok: false, message: j.message };
        }
        router.push(`/customers/${id}`);
        return { ok: true };
      }}
    />
  );
}
