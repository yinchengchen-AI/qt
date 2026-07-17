"use client";
// AppRelease 管理页:
//   - 列表:publishedAt 倒序,important 优先;每行展示 version / title / summary / publishedAt
//   - 单一 Modal:发布/编辑走同一个表单;表单顶部一颗"从 git 自动填充"
//     副按钮,点击后调用 /api/app-releases/preview-from-git 把推荐文本写进表单字段,
//     管理员审阅后直接保存。手动模式和自动模式共享表单行为,省去第二份 Modal。
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
import { App as AntdApp, Button, Modal, Space, Tag, Typography } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { makeListRequest } from "@/lib/use-list-request";
import { DateTimeCell } from "@/components/table-cells";
import { FormCard } from "@/components/form";
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
};

type FormValues = {
  version: string;
  title: string;
  summary: string;
  content: string;
  important?: boolean;
};

export default function ReleasesAdminPage() {
  const t = useT();
  const { message, modal } = AntdApp.useApp();
  const actionRef = useRef<ActionType>(undefined);
  const [form] = ProForm.useForm<FormValues>();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [autoFillBusy, setAutoFillBusy] = useState(false);

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

  const onFinish = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const url = editingId ? `/api/app-releases/${editingId}` : "/api/app-releases";
      const r = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          version: values.version.trim(),
          title: values.title,
          summary: values.summary,
          content: values.content,
          important: values.important ?? false
        })
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

  // 表单内"从 git 自动填充"按钮:拉取预览文本,只覆盖空字段;version 始终覆盖
  const autoFillFromGit = async () => {
    setAutoFillBusy(true);
    try {
      const r = await fetch("/api/app-releases/preview-from-git", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      const j = await r.json();
      if (j.code !== 0) {
        message.error(j.message);
        return;
      }
      const data = j.data as { version: string; title: string; summary: string; content: string; commitCount: number };
      const current = form.getFieldsValue();
      form.setFieldsValue({
        version: data.version,
        title: current.title?.trim() ? current.title : data.title,
        summary: current.summary?.trim() ? current.summary : data.summary,
        content: current.content?.trim() ? current.content : data.content
      });
      message.success(t("releases.toast.autoFilled").replace("{n}", String(data.commitCount)));
    } finally {
      setAutoFillBusy(false);
    }
  };

  const columns: ProColumns<AppRelease>[] = [
    {
      title: t("releases.column.version"),
      dataIndex: "version",
      width: 120,
      fixed: "left",
      render: (_, r) => (
        <Space size={6}>
          {r.important && <Tag color="red">{t("releases.tag.important")}</Tag>}
          <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontWeight: 500 }}>{r.version}</span>
        </Space>
      )
    },
    {
      title: t("releases.column.title"),
      dataIndex: "title",
      width: 240,
      ellipsis: true,
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
      width: 140,
      fixed: "right",
      render: (_, r) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>
            {t("releases.edit")}
          </Button>
          <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r)}>
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
          <Button key="add" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            {t("releases.publishManual")}
          </Button>
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

      <Modal
        title={editingId ? t("releases.edit") : t("releases.publishManual")}
        open={modalOpen}
        onCancel={closeModal}
        destroyOnHidden
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
          <ProForm<FormValues>
            form={form}
            layout="vertical"
            submitter={false}
            preserve={false}
            onFinish={onFinish}
          >
            <div
              style={{
                marginBottom: 12,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8
              }}
            >
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t("releases.autoFillHint")}
              </Text>
              <Button size="small" loading={autoFillBusy} onClick={autoFillFromGit}>
                {t("releases.autoFill")}
              </Button>
            </div>

            <ProFormText
              name="version"
              label={t("releases.field.version")}
              placeholder={t("releases.field.version.placeholder")}
              rules={[
                { required: true, pattern: /^v\d/, message: t("releases.field.version.rule") }
              ]}
              fieldProps={{ size: "large", maxLength: 50 }}
            />
            <ProFormSwitch
              name="important"
              label={t("releases.field.important")}
              tooltip={t("releases.field.important.tooltip")}
            />
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
              fieldProps={{ size: "large", rows: 10, maxLength: 10000, showCount: true }}
            />
          </ProForm>
        </FormCard>
      </Modal>
    </Page>
  );
}
