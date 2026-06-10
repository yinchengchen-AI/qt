"use client";
import { ProCard, ProDescriptions, ProTable } from "@ant-design/pro-components";
import { Button, Space } from "antd";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { DetailPageSkeleton } from "@/components/detail-page-skeleton";
import { StatusTag } from "@/components/status-tag";
import { useActionCall } from "@/lib/use-action-call";
import { CurrencyCell, DateTimeCell } from "@/components/table-cells";

const ACTION_LABEL: Record<string, string> = {
  start: "开始", suspend: "暂停", resume: "恢复", deliver: "交付",
  accept: "验收", close: "关闭", cancel: "取消"
};

export default function ProjectDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { data, isLoading, mutate } = useSWR<any>(`/api/projects/${id}`);
  const { run } = useActionCall({ baseUrl: `/api/projects/${id}`, reload: () => mutate() });

  if (isLoading || !data) {
    return (
      <Page>
        <PageHeader back={() => router.push("/projects")} title="项目详情" />
        <DetailPageSkeleton />
      </Page>
    );
  }

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
                onClick={() => run(a)}
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
          { title: "起期", dataIndex: "startDate", render: (v: any) => <DateTimeCell value={v} /> },
          { title: "止期", dataIndex: "endDate", render: (v: any) => <DateTimeCell value={v} /> },
          { title: "预算", dataIndex: "budgetAmount", render: (v: any) => <CurrencyCell value={v} /> }
        ]} />
      </ProCard>
      <ProCard title="服务范围">
        <div style={{ whiteSpace: "pre-wrap" }}>{data.serviceScope}</div>
      </ProCard>
      <ProCard title="进度日志">
        <ProTable rowKey="id" search={false} options={false} pagination={{ pageSize: 10 }} dataSource={data.progressLogs ?? []} columns={[
          { title: "时间", dataIndex: "at", valueType: "dateTime", width: 180, render: (_, r: any) => <DateTimeCell value={r.at} /> },
          { title: "进度", dataIndex: "percent", width: 100, render: (v: any) => `${v}%` },
          { title: "说明", dataIndex: "remark" }
        ]} />
      </ProCard>
    </Page>
  );
}
