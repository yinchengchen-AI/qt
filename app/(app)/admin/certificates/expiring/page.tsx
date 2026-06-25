"use client";
import { ProCard, ProTable, type ProColumns } from "@ant-design/pro-components";
import { Tag, Button, Space } from "antd";
import { useRouter } from "next/navigation";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { useSession } from "next-auth/react";
import { ErrorBox } from "@/components/callout";
import { formatDate } from "@/lib/format";

type Row = {
  certificateId: string;
  userId: string;
  employeeNo: string;
  name: string;
  certName: string;
  expiryDate: string;
  daysLeft: number;
};

export default function ExpiringCertificatesPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const roleCode = (session?.user as { roleCode?: string } | undefined)?.roleCode;
  const isAdmin = roleCode === "ADMIN";

  if (!isAdmin) {
    return (
      <Page>
        <PageHeader back={() => router.push("/admin/users")} title="到期证书" />
        <ErrorBox title="无权限">仅管理员可查看到期证书</ErrorBox>
      </Page>
    );
  }

  const columns: ProColumns<Row>[] = [
    { title: "工号", dataIndex: "employeeNo", width: 100 },
    { title: "姓名", dataIndex: "name", width: 100 },
    { title: "证书名", dataIndex: "certName", width: 200 },
    { title: "到期日", dataIndex: "expiryDate", width: 140, render: (_, r) => formatDate(r.expiryDate) },
    {
      title: "剩余天数",
      dataIndex: "daysLeft",
      width: 120,
      render: (_, r) => {
        if (r.daysLeft < 0) return <Tag color="red">已过期 {Math.abs(r.daysLeft)} 天</Tag>;
        if (r.daysLeft <= 7) return <Tag color="red">{r.daysLeft} 天</Tag>;
        if (r.daysLeft <= 30) return <Tag color="orange">{r.daysLeft} 天</Tag>;
        return <Tag color="default">{r.daysLeft} 天</Tag>;
      }
    },
    {
      title: "操作",
      valueType: "option",
      width: 100,
      render: (_, r) => [
        <a key="view" onClick={() => router.push(`/admin/users/${r.userId}#certs`)}>查看档案</a>
      ]
    }
  ];

  return (
    <Page>
      <PageHeader
        back={() => router.push("/admin/users")}
        title="到期证书"
        subtitle="60 天内到期 / 已过期(未到期的证书不在此列表)"
      />
      <ProCard>
        <ProTable<Row>
          rowKey="certificateId"
          columns={columns}
          search={false}
          request={async () => {
            const r = await fetch("/api/certificates/expiring?days=60", { credentials: "include" });
            const j = await r.json();
            return { data: j.data ?? [], success: j.code === 0 };
          }}
          pagination={{ pageSize: 20 }}
        />
      </ProCard>
    </Page>
  );
}
