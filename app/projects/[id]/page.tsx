"use client";
import { ProCard, ProDescriptions, ProTable } from "@ant-design/pro-components";
import { Button, Space, App as AntdApp } from "antd";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StatusTag } from "@/components/status-tag";

const ACTION_LABEL: Record<string, string> = {
  start: "开始", suspend: "暂停", resume: "恢复", deliver: "交付",
  accept: "验收", close: "关闭", cancel: "取消"
};

export default function ProjectDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const { data, isLoading, mutate } = useSWR<any>(`/api/projects/${id}`);
  if (isLoading || !data) {
    return (
      <Page>
        <PageHeader back={() => router.push("/projects")} title="项目详情" />
        <EmptyState loading />
      </Page>
    );
  }

  const callAction = async (action: string) => {
    const res = await fetch(`/api/projects/${id}/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({})
    });
    const j = await res.json();
    if (j.code !== 0) { message.error(j.message); return; }
    message.success("已" + (ACTION_LABEL[action] ?? action)); mutate();
  };
  const allowed = (() => {
    const s = data.status;
    if (s === "PLANNED") return ["start", "cancel"];
    if (s === "IN_PROGRESS") return ["suspend", "deliver", "cancel"];
    if (s === "SUSPENDED") return ["resume", "cancel"];
    if (s === "DELIVERED") return ["accept"];
    if (s === "ACCEPTED") return ["close"];
    return [];
  })();

  const contractNo = data.contract?.contractNo ?? data.contractNo ?? "-";

  return (
    <Page>
      <PageHeader
        back={() => router.push("/projects")}
        title={`${data.name} · ${data.projectNo}`}
        subtitle={`所属合同: ${contractNo}`}
        meta={<StatusTag status={data.status} domain="project" />}
        actions={
          <Space>
            {["PLANNED", "SUSPENDED"].includes(data.status) && (
              <Button onClick={() => router.push(`/projects/${id}/edit`)}>编辑</Button>
            )}
            {allowed.map((a) => (
              <Button
                key={a}
                type={a === "cancel" ? "default" : "primary"}
                danger={a === "cancel"}
                onClick={() => callAction(a)}
              >
                {ACTION_LABEL[a] ?? a}
              </Button>
            ))}
          </Space>
        }
      />
      <ProCard>
        <ProDescriptions column={2} dataSource={data} columns={[
          { title: "项目编号", dataIndex: "projectNo" },
          { title: "所属合同", dataIndex: ["contract", "contractNo"], render: () => contractNo },
          { title: "起期", dataIndex: "startDate", valueType: "dateTime" },
          { title: "止期", dataIndex: "endDate", valueType: "dateTime" },
          { title: "预算", dataIndex: "budgetAmount", render: (v: any) => (v ? `¥${v}` : "-") }
        ]} />
      </ProCard>
      <ProCard title="服务范围">
        <div style={{ whiteSpace: "pre-wrap", color: "var(--qt-text-1)" }}>{data.serviceScope}</div>
      </ProCard>
      <ProCard title="进度日志">
        <ProTable rowKey="id" search={false} options={false} pagination={{ pageSize: 10 }} dataSource={data.progressLogs ?? []} columns={[
          { title: "时间", dataIndex: "at", valueType: "dateTime", width: 180 },
          { title: "进度", dataIndex: "percent", width: 100, render: (v: any) => `${v}%` },
          { title: "说明", dataIndex: "remark" }
        ]} />
      </ProCard>
    </Page>
  );
}
