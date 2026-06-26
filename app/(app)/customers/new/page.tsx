"use client";

import { useRouter } from "next/navigation";
import { useGoBack } from "@/lib/navigation";
import { CustomerForm, type CustomerFormValues } from "@/components/customers/customer-form";

export default function NewCustomerPage() {
  const router = useRouter();
  const goBack = useGoBack("/customers");
  return (
    <CustomerForm
      mode="create"
      title="新建客户"
      subtitle="客户编号、创建人、创建时间由系统自动生成"
      submitText="创建客户"
      back={goBack}
      onSubmit={async (values: CustomerFormValues) => {
        const res = await fetch("/api/customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(values)
        });
        const j = await res.json();
        if (j.code !== 0) {
          return { ok: false, message: j.message };
        }
        router.push(`/customers/${j.data.id}`);
        return { ok: true };
      }}
    />
  );
}
