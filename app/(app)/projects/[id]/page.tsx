"use client";
import { ProCard, ProDescriptions, ProTable } from "@ant-design/pro-components";
import { Button, Space } from "antd";
import { useParams, useRouter } from "next/navigation";
import type { Project as ProjectEntity } from "@/lib/types/entities";
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
  const { data, isLoading, mutate } = useSWR<{ data: ProjectEntity }>(`/api/projects/${id}`);
  const project = data?.data;
  const { run } = useActionCall({ baseUrl: `/api/projects/${id}`, reload: () => mutate() });

  if (isLoading || !project) {
    return (
      <Page>
        <PageHeader back={() => router.push("/projects")} title="项目详情" />
        <DetailPageSkeleton />
      </Page>
    );
  }

  const allowed = (() => {
    const s = project.status;
    if (s === "PLANNED") return ["start", "cancel"];
    if (s === "IN_PROGRESS") return ["suspend", "deliver", "cancel"];
    if (s === "SUSPENDED") return ["resume", "cancel"];
    if (s === "DELIVERED") return ["accept"];
    if (s === "ACCEPTED") return ["close"];
    return [];
  })();

  const contractNo = project.contract?.contractNo ?? project.contractNo ?? "-";

  return (
    <Page>
      <PageHeader
        back={() => router.push("/projects")}
        title={`${project.name} · ${project.projectNo}`}
        subtitle={`所属合同: ${contractNo}`}
        meta={<StatusTag status={project.status} domain="project" />}
        actions={
          <Space>
            {["PLANNED", "SUSPENDED"].includes(project.status) && (
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
          { title: "起期", dataIndex: "startDate", render: (v) => <DateTimeCell value={v as string} /> },
          { title: "止期", dataIndex: "endDate", render: (v) => <DateTimeCell value={v as string} /> },
          { title: "预算", dataIndex: "budgetAmount", render: (v) => <CurrencyCell value={v as string} /> }
        ]} />
      </ProCard>
      <PageHeader level="section" title="服务范围" />
      <ProCard>
        <div style={{ whiteSpace: "pre-wrap" }}>{project.serviceScope}</div>
      </ProCard>
      <PageHeader level="section" title="进度日志" />
      <ProCard>
        <ProTable rowKey="id" search={false} options={false} pagination={{ pageSize: 10 }} dataSource={project.progressLogs ?? []} columns={[
          { title: "时间", dataIndex: "at", valueType: "dateTime", width: 180, render: (_, r) => <DateTimeCell value={r.at as string} /> },
          { title: "进度", dataIndex: "percent", width: 100, render: (v) => `${v as number}%` },
          { title: "说明", dataIndex: "remark" }
        ]} />
      </ProCard>
    </Page>
  );
}
