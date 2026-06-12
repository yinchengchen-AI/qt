"use client";
import { ProCard, ProDescriptions, ProTable } from "@ant-design/pro-components";
import { Button, Space, Tag, Modal, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useParams, useRouter } from "next/navigation";
import type { Project as ProjectEntity } from "@/lib/types/entities";
import useSWR from "swr";
import { useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { DetailPageSkeleton } from "@/components/detail-page-skeleton";
import { StatusTag } from "@/components/status-tag";
import { useActionCall } from "@/lib/use-action-call";
import { FilePdfOutlined } from "@ant-design/icons";
import { openPrintWindow } from "@/lib/print-client";
import { useUserName } from "@/lib/user-lookup";
import { ProgressLogDrawer } from "@/components/file/progress-log-drawer";
import { CurrencyCell, DateTimeCell } from "@/components/table-cells";
import { useResponsive } from "@/lib/use-breakpoint";
import { WorkflowSection } from "@/components/workflow/workflow-section";
import { UpgradeModal } from "@/components/workflow/upgrade-modal";
import { AppstoreOutlined, DownloadOutlined, ThunderboltOutlined } from "@ant-design/icons";


const ACTION_LABEL: Record<string, string> = {
  start: "开始", suspend: "暂停", resume: "恢复", deliver: "交付",
  accept: "验收", close: "关闭", cancel: "取消"
};

const DESC_COL = { xs: 1, sm: 1, md: 2, lg: 2, xl: 3 } as const;

export default function ProjectDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { isMobile } = useResponsive();
  const { data, isLoading, mutate } = useSWR<ProjectEntity>(`/api/projects/${id}`);
  const project = data;
  const { run } = useActionCall({ baseUrl: `/api/projects/${id}`, reload: () => mutate() });
  const [progressOpen, setProgressOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

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
  // 项目已结束 / 关闭后禁止再记进度(状态机不允许)
  const canLogProgress = ["PLANNED", "IN_PROGRESS", "SUSPENDED"].includes(project.status);
  // 工作流任务实例:同上,结束态不允许流转
  const canEditWorkflow = ["PLANNED", "IN_PROGRESS", "SUSPENDED"].includes(project.status);

  // 取消项目:拉一次工作流,统计未完成必交付任务,二次确认
  const handleCancel = () => {
    let pendingCount = 0;
    fetch(`/api/projects/${id}/workflow`, { credentials: "include" })
      .then((r) => r.json())
      .then((j) => {
        if (j?.code === 0) {
          const tasks = (j.data?.stages ?? []).flatMap((s: { tasks?: { requiresDeliverable: boolean; status: string }[] }) => s.tasks ?? []);
          pendingCount = tasks.filter((t: { requiresDeliverable: boolean; status: string }) => t.requiresDeliverable && t.status !== "COMPLETED" && t.status !== "SKIPPED").length;
        }
        const content = pendingCount > 0
          ? `当前仍有 ${pendingCount} 项必交付任务未完成,确认取消项目?任务将保留为未完成状态作为历史。`
          : "确认取消项目?取消后不可恢复,任务将保留为未完成状态。";
        Modal.confirm({
          title: "取消项目",
          content,
          okText: "确认取消",
          okButtonProps: { danger: true },
          cancelText: "再想想",
          onOk: () => run("cancel")
        });
      })
      .catch(() => {
        Modal.confirm({
          title: "取消项目",
          content: "确认取消项目?取消后不可恢复。",
          okText: "确认取消",
          okButtonProps: { danger: true },
          cancelText: "再想想",
          onOk: () => run("cancel")
        });
      });
  };

  return (
    <Page>
      <PageHeader
        back={() => router.push("/projects")}
        title={`${project.name} · ${project.projectNo}`}
        subtitle={`所属合同: ${contractNo}`}
        meta={<StatusTag status={project.status} domain="project" />}
        actions={
          <Space wrap>
            {canLogProgress && (
              <Button key="progress" icon={<PlusOutlined />} onClick={() => setProgressOpen(true)}>
                记录里程碑
              </Button>
            )}
            <Button key="pdf" icon={<FilePdfOutlined />} onClick={() => openPrintWindow(`/api/projects/${id}/pdf`)}>导出 PDF</Button>
            <Button
              key="board"
              icon={<AppstoreOutlined />}
              onClick={() => router.push(`/workflow/board?projectId=${id}`)}
            >
              看板视图
            </Button>
            {["PLANNED", "SUSPENDED"].includes(project.status) && (
              <Button onClick={() => router.push(`/projects/${id}/edit`)}>编辑</Button>
            )}
            {allowed.map((a) => (
              <Button
                key={a}
                type={a === "cancel" ? "default" : "primary"}
                danger={a === "cancel"}
                onClick={() => (a === "cancel" ? handleCancel() : run(a))}
              >
                {ACTION_LABEL[a] ?? a}
              </Button>
            ))}
          </Space>
        }
      />
      <ProCard>
        <ProDescriptions column={DESC_COL} dataSource={data} columns={[
          { title: "项目编号", dataIndex: "projectNo" },
          { title: "所属合同", dataIndex: ["contract", "contractNo"], render: () => contractNo },
          { title: "起期", dataIndex: "startDate", render: (v) => <DateTimeCell value={v as string} /> },
          { title: "止期", dataIndex: "endDate", render: (v) => <DateTimeCell value={v as string} /> },
          { title: "预算", dataIndex: "budgetAmount", render: (v) => <CurrencyCell value={v as string} /> },
          {
            title: "进度(工作流派生)",
            dataIndex: "progressPct",
            render: (v) => (
              <Space size={4}>
                <Typography.Text strong>{Number(v ?? 0).toFixed(1)}%</Typography.Text>
                <Tag color="blue">基于工作流任务完成度</Tag>
              </Space>
            )
          }
        ]} />
      </ProCard>
      <PageHeader level="section" title="服务范围" />
      <ProCard>
        <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{project.serviceScope}</div>
      </ProCard>
      <PageHeader
        level="section"
        title="服务工作流"
        actions={
          <Space wrap>
            <Button
              icon={<DownloadOutlined />}
              onClick={() => {
                window.open(`/api/projects/${id}/workflow/export`, "_blank");
              }}
            >
              导出 JSON
            </Button>
            <Button
              icon={<ThunderboltOutlined />}
              onClick={() => setUpgradeOpen(true)}
              disabled={!canEditWorkflow}
            >
              升级到最新模板
            </Button>
          </Space>
        }
      />
      <ProCard>
        <WorkflowSection projectId={id} canEdit={canEditWorkflow} />
      </ProCard>
      <UpgradeModal projectId={id} open={upgradeOpen} onClose={() => setUpgradeOpen(false)} onUpgraded={() => mutate()} />
      <PageHeader level="section" title="里程碑日志" subtitle="仅作文字记录,数字进度已并入上方「工作流派生进度」" />
      <ProCard>
        <ProTable
          rowKey="id"
          search={false}
          options={false}
          pagination={{ pageSize: 10, size: isMobile ? "small" : undefined }}
          dataSource={project.progressLogs ?? []}
          scroll={{ x: 'max-content' }}
          sticky={isMobile}
          columns={[
            { title: "时间", dataIndex: "at", valueType: "dateTime", width: 180, render: (_, r) => <DateTimeCell value={r.at as string} /> },
            {
              title: "操作人",
              dataIndex: "userId",
              width: 120,
              render: (_, r) => <ProgressUserName id={r.userId as string} />
            },
            { title: "说明", dataIndex: "remark" }
          ]}
        />
      </ProCard>
      <ProgressLogDrawer
        projectId={id}
        open={progressOpen}
        onClose={() => setProgressOpen(false)}
        onSaved={() => mutate()}
      />
    </Page>
  );
}

// 拆出来是因为 useUserName 必须在 hook 顶层调用;写成内联 render 会破坏 hooks 规则
function ProgressUserName({ id }: { id: string }) {
  const name = useUserName(id, "—");
  return <span>{name}</span>;
}
