"use client";
// AppRelease 管理页(管理员):
//   - "从 git 自动生成":点击后调 /api/app-releases/preview-from-git 拿服务端生成的
//     预览(title/summary/content + commit 列表),确认后发布(不需要手敲内容)
//   - "手写发布":保留旧表单,用于紧急补丁 / 跨版本合并 / 没装 git 的环境
//   - 列表:publishedAt 倒序,important 优先;每行展示 source + commit 数
import { useRef, useState } from "react";
import {
  ProTable,
  ProForm,
  ProFormText,
  ProFormTextArea,
  ProFormSwitch,
  type ProColumns,
  type ActionType
} from "@ant-design/pro-components";
import {
  App as AntdApp,
  Alert,
  Button,
  Modal,
  Space,
  Switch,
  Tag,
  Typography,
  Spin
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ThunderboltOutlined
} from "@ant-design/icons";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { makeListRequest } from "@/lib/use-list-request";
import { DateTimeCell } from "@/components/table-cells";
import { FormCard, FormSection, FormGrid } from "@/components/form";
import { useT } from "@/lib/i18n";

const { Text } = Typography;

type AppRelease = {
  id: string;
  version: string;
  title: string;
  summary: string;
  content: string;
  important: boolean;
  publishedAt: string;
  publishedById: string;
  source: "MANUAL" | "GIT_COMMITS";
  gitFrom: string | null;
  gitTo: string | null;
  gitCommitCount: number | null;
};

type GitCommit = {
  sha: string;
  shortSha: string;
  type: string | null;
  scope: string | null;
  description: string;
  date: string;
};

type GitPreview = {
  commits: GitCommit[];
  formatted: {
    title: string;
    summary: string;
    content: string;
    categoryCounts: Array<{ label: string; order: number; count: number }>;
  };
  version: string;
  from: string;
  to: string;
  commitCount: number;
};

export default function ReleasesAdminPage() {
  const t = useT();
  const { message, modal } = AntdApp.useApp();
  const actionRef = useRef<ActionType>(undefined);
  const [form] = ProForm.useForm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Git 自动生成 modal
  const [gitModalOpen, setGitModalOpen] = useState(false);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitPreview, setGitPreview] = useState<GitPreview | null>(null);
  const [gitImportant, setGitImportant] = useState(false);

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    form.resetFields();
  };

  const openCreate = () => {
    form.resetFields();
    setEditingId(null);
    setModalOpen(true);
  };

  const openEdit = (r: AppRelease) => {
    setEditingId(r.id);
    form.setFieldsValue({
      version: r.version,
      title: r.title,
      summary: r.summary,
      content: r.content,
      important: r.important
    });
    setModalOpen(true);
  };

  const handleDelete = (r: AppRelease) => {
    modal.confirm({
      title: t("releases.deleteConfirm.title"),
      content: t("releases.deleteConfirm.content").replace("{version}", r.version),
      okText: t("releases.delete"),
      okType: "danger",
      cancelText: t("releases.cancel"),
      onOk: async () => {
        const res = await fetch(`/api/app-releases/${r.id}`, {
          method: "DELETE",
          credentials: "include"
        });
        const j = await res.json();
        if (j.code === 0) {
          message.success(t("releases.toast.deleted"));
          actionRef.current?.reload();
        } else {
          message.error(j.message);
        }
      }
    });
  };

  // 手写表单提交
  const onFinish = async (values: Record<string, unknown>) => {
    setSubmitting(true);
    try {
      const body = {
        version: String(values.version ?? "").trim(),
        title: values.title,
        summary: values.summary,
        content: values.content,
        important: values.important ?? false
      };
      const url = editingId ? `/api/app-releases/${editingId}` : "/api/app-releases";
      const r = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body)
      });
      const j = await r.json();
      if (j.code === 0) {
        message.success(editingId ? t("releases.toast.saved") : t("releases.toast.published"));
        closeModal();
        actionRef.current?.reload();
        return true;
      }
      message.error(j.message);
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  // 点"从 git 自动生成"按钮
  const openGitPreview = async () => {
    setGitModalOpen(true);
    setGitLoading(true);
    setGitPreview(null);
    try {
      const r = await fetch("/api/app-releases/preview-from-git", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      const j = await r.json();
      if (j.code === 0) {
        setGitPreview(j.data);
      } else {
        message.error(j.message);
        setGitModalOpen(false);
      }
    } catch (e) {
      message.error((e as Error).message);
      setGitModalOpen(false);
    } finally {
      setGitLoading(false);
    }
  };

  // 确认发布 git 生成的内容
  const confirmGitPublish = async () => {
    if (!gitPreview) return;
    setSubmitting(true);
    try {
      const r = await fetch("/api/app-releases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          version: gitPreview.version,
          title: gitPreview.formatted.title,
          summary: gitPreview.formatted.summary,
          content: gitPreview.formatted.content,
          important: gitImportant,
          source: "GIT_COMMITS",
          gitFrom: gitPreview.from,
          gitTo: gitPreview.to,
          gitCommitCount: gitPreview.commitCount
        })
      });
      const j = await r.json();
      if (j.code === 0) {
        message.success(t("releases.toast.published"));
        setGitModalOpen(false);
        setGitPreview(null);
        actionRef.current?.reload();
      } else {
        message.error(j.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ProColumns<AppRelease>[] = [
    {
      title: t("releases.column.version"),
      dataIndex: "version",
      width: 100,
      fixed: "left",
      render: (_, r) => (
        <Space size={4} direction="vertical">
          <Space size={4}>
            {r.important && <Tag color="red">{t("releases.tag.important")}</Tag>}
            <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>{r.version}</span>
          </Space>
          {r.source === "GIT_COMMITS" ? (
            <Tag color="geekblue" style={{ margin: 0, fontSize: 11 }}>
              {t("releases.tag.fromGit")} · {r.gitCommitCount ?? 0}
            </Tag>
          ) : null}
        </Space>
      )
    },
    {
      title: t("releases.column.title"),
      dataIndex: "title",
      width: 240,
      render: (_, r) => <span style={{ fontWeight: r.important ? 600 : 400 }}>{r.title}</span>
    },
    {
      title: t("releases.column.summary"),
      dataIndex: "summary",
      width: 360,
      ellipsis: true
    },
    {
      title: t("releases.column.publishedAt"),
      dataIndex: "publishedAt",
      width: 180,
      render: (_, r) => <DateTimeCell value={r.publishedAt} />
    },
    {
      title: t("releases.column.actions"),
      width: 160,
      fixed: "right",
      render: (_, r) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>
            {t("releases.edit")}
          </Button>
          <Button
            type="link"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(r)}
          >
            {t("releases.delete")}
          </Button>
        </Space>
      )
    }
  ];

  return (
    <Page>
      <PageHeader
        title={t("releases.title")}
        subtitle={t("releases.subtitle")}
        actions={
          <Space>
            <Button key="git" icon={<ThunderboltOutlined />} onClick={openGitPreview}>
              {t("releases.fromGit")}
            </Button>
            <Button key="add" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              {t("releases.publishManual")}
            </Button>
          </Space>
        }
      />

      <ProTable<AppRelease>
        rowKey="id"
        search={false}
        actionRef={actionRef}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        request={makeListRequest<AppRelease>("/api/app-releases")}
        cardBordered={false}
        columns={columns}
      />

      {/* 手写表单 Modal(老的发布入口) */}
      <Modal
        title={editingId ? t("releases.edit") : t("releases.publishManual")}
        open={modalOpen}
        onCancel={closeModal}
        destroyOnClose
        width={760}
        footer={
          <Space>
            <Button onClick={closeModal}>{t("releases.cancel")}</Button>
            <Button type="primary" loading={submitting} onClick={() => form.submit()}>
              {editingId ? t("releases.save") : t("releases.publish")}
            </Button>
          </Space>
        }
      >
        <FormCard headerHint={t("releases.hint")}>
          <ProForm
            form={form}
            layout="vertical"
            submitter={false}
            preserve={false}
            onFinish={onFinish}
          >
            <FormSection title={t("releases.section.basic")}>
              <FormGrid columns={2}>
                <ProFormText
                  name="version"
                  label={t("releases.field.version")}
                  placeholder={t("releases.field.version.placeholder")}
                  rules={[
                    { required: true, min: 1, max: 50, message: t("releases.field.version.rule") }
                  ]}
                  fieldProps={{ size: "large", maxLength: 50, showCount: true }}
                />
                <ProFormSwitch
                  name="important"
                  label={t("releases.field.important")}
                  tooltip={t("releases.field.important.tooltip")}
                />
              </FormGrid>
              <FormGrid columns={1}>
                <ProFormText
                  name="title"
                  label={t("releases.field.title")}
                  placeholder={t("releases.field.title.placeholder")}
                  rules={[{ required: true, min: 2, max: 200, message: t("releases.field.title.rule") }]}
                  fieldProps={{ size: "large", maxLength: 200, showCount: true }}
                />
                <ProFormTextArea
                  name="summary"
                  label={t("releases.field.summary")}
                  placeholder={t("releases.field.summary.placeholder")}
                  rules={[{ required: true, min: 1, max: 500, message: t("releases.field.summary.rule") }]}
                  fieldProps={{ size: "large", rows: 2, maxLength: 500, showCount: true }}
                />
                <ProFormTextArea
                  name="content"
                  label={t("releases.field.content")}
                  placeholder={t("releases.field.content.placeholder")}
                  rules={[{ required: true, min: 1, max: 10000, message: t("releases.field.content.rule") }]}
                  fieldProps={{
                    size: "large",
                    rows: 10,
                    maxLength: 10000,
                    showCount: true
                  }}
                />
              </FormGrid>
            </FormSection>
          </ProForm>
        </FormCard>
      </Modal>

      {/* Git 自动生成 Modal */}
      <Modal
        title={t("releases.gitModal.title")}
        open={gitModalOpen}
        onCancel={() => {
          setGitModalOpen(false);
          setGitPreview(null);
        }}
        destroyOnClose
        width={820}
        footer={
          gitPreview && gitPreview.commits.length > 0 ? (
            <Space style={{ width: "100%", justifyContent: "space-between" }}>
              <Space>
                <Switch
                  size="small"
                  checked={gitImportant}
                  onChange={setGitImportant}
                />
                <Text type="secondary">{t("releases.gitModal.markImportant")}</Text>
              </Space>
              <Space>
                <Button
                  onClick={() => {
                    setGitModalOpen(false);
                    setGitPreview(null);
                  }}
                >
                  {t("releases.cancel")}
                </Button>
                <Button type="primary" loading={submitting} onClick={confirmGitPublish}>
                  {t("releases.gitModal.publish")}
                </Button>
              </Space>
            </Space>
          ) : (
            <Button onClick={() => setGitModalOpen(false)}>{t("releases.cancel")}</Button>
          )
        }
      >
        <Spin spinning={gitLoading}>
          {gitPreview && gitPreview.commits.length > 0 ? (
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Alert
                type="info"
                showIcon
                message={t("releases.gitModal.summaryHint")
                  .replace("{version}", gitPreview.version)
                  .replace("{n}", String(gitPreview.commitCount))}
                description={
                  <span>
                    {t("releases.gitModal.range")}:{" "}
                    <Text code style={{ fontSize: 11 }}>{gitPreview.from}</Text> ..{" "}
                    <Text code style={{ fontSize: 11 }}>{gitPreview.to.slice(0, 10)}</Text>
                  </span>
                }
              />
              <div>
                <Text strong>{t("releases.gitModal.previewTitle")}:</Text>
                <div style={{ marginTop: 4, fontSize: 15 }}>{gitPreview.formatted.title}</div>
                <Text type="secondary" style={{ fontSize: 13 }}>
                  {gitPreview.formatted.summary}
                </Text>
              </div>
              <div>
                <Text strong>{t("releases.gitModal.previewContent")}:</Text>
                <pre
                  style={{
                    marginTop: 4,
                    padding: "10px 12px",
                    background: "var(--ant-color-fill-tertiary, #f5f5f5)",
                    borderRadius: 4,
                    fontSize: 13,
                    lineHeight: 1.7,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    // M-3: 内容可能很长 (10000 字符),加 maxHeight + 滚动
                    // 避免 modal 撑到屏幕外
                    maxHeight: 320,
                    overflowY: "auto",
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                  }}
                >
                  {gitPreview.formatted.content}
                </pre>
              </div>
              <details>
                <summary style={{ cursor: "pointer", color: "var(--ant-color-text-secondary)" }}>
                  {t("releases.gitModal.rawCommits").replace("{n}", String(gitPreview.commits.length))}
                </summary>
                <div style={{ marginTop: 8, maxHeight: 240, overflowY: "auto" }}>
                  {gitPreview.commits.map((c) => (
                    <div key={c.sha} style={{ fontSize: 12, padding: "2px 0" }}>
                      <Text code style={{ fontSize: 11 }}>{c.shortSha}</Text>{" "}
                      <Tag style={{ marginLeft: 4, fontSize: 10 }}>{c.type ?? "-"}</Tag>
                      {c.scope ? <Tag color="blue" style={{ marginLeft: 4, fontSize: 10 }}>{c.scope}</Tag> : null}
                      <span style={{ marginLeft: 4 }}>{c.description}</span>
                    </div>
                  ))}
                </div>
              </details>
            </Space>
          ) : gitPreview && gitPreview.commits.length === 0 ? (
            <Alert
              type="warning"
              showIcon
              message={t("releases.gitModal.emptyRange")}
              description={t("releases.gitModal.emptyRangeDesc")}
            />
          ) : null}
        </Spin>
      </Modal>
    </Page>
  );
}
