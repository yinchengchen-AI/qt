"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import dayjs from "dayjs";
import { ProTable, type ProColumns, type ActionType } from "@ant-design/pro-components";
import {
  ProForm,
  ProFormText,
  ProFormTextArea,
  ProFormSelect,
  ProFormDateRangePicker,
  ProFormSwitch
} from "@ant-design/pro-components";
import { App as AntdApp, Button, Modal, Space, Tag } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { ROLE_LABEL } from "@/lib/status";
import { makeListRequest } from "@/lib/use-list-request";
import { DateTimeCell } from "@/components/table-cells";
import { FormCard, FormSection, FormGrid } from "@/components/form";
import { useT } from "@/lib/i18n";

type Announcement = {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  targetRoles: string[];
  publishUserId: string;
  publishAt: string;
};

const TARGET_ROLE_OPTIONS = Object.entries(ROLE_LABEL).map(([value, label]) => ({
  value,
  label
}));

export default function AnnouncementsPage() {
  const t = useT();
  const { message, modal } = AntdApp.useApp();
  const actionRef = useRef<ActionType>(undefined);
  const [form] = ProForm.useForm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  const openEdit = (a: Announcement) => {
    setEditingId(a.id);
    form.setFieldsValue({
      title: a.title,
      content: a.content,
      pinned: a.pinned,
      targetRoles: a.targetRoles,
      effectiveRange: [
        a.effectiveFrom ? dayjs(a.effectiveFrom) : undefined,
        a.effectiveTo ? dayjs(a.effectiveTo) : undefined
      ]
    });
    setModalOpen(true);
  };

  const handleDelete = (a: Announcement) => {
    modal.confirm({
      title: t("announcements.deleteConfirm.title"),
      content: t("announcements.deleteConfirm.content").replace("{title}", a.title),
      okText: t("announcements.delete"),
      okType: "danger",
      cancelText: t("announcements.cancel"),
      onOk: async () => {
        const r = await fetch(`/api/announcements/${a.id}`, {
          method: "DELETE",
          credentials: "include"
        });
        const j = await r.json();
        if (j.code === 0) {
          message.success(t("announcements.toast.deleted"));
          actionRef.current?.reload();
        } else {
          message.error(j.message);
        }
      }
    });
  };

  const onFinish = async (values: Record<string, unknown>) => {
    setSubmitting(true);
    try {
      const range = values.effectiveRange as
        | [dayjs.Dayjs | null | undefined, dayjs.Dayjs | null | undefined]
        | undefined;
      const body = {
        title: values.title,
        content: values.content,
        pinned: values.pinned ?? false,
        effectiveFrom: range?.[0] ? range[0].toISOString() : null,
        effectiveTo: range?.[1] ? range[1].toISOString() : null,
        targetRoles: (values.targetRoles as string[] | undefined) ?? []
      };
      const url = editingId ? `/api/announcements/${editingId}` : "/api/announcements";
      const r = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body)
      });
      const j = await r.json();
      if (j.code === 0) {
        message.success(editingId ? t("announcements.toast.saved") : t("announcements.toast.published"));
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

  const columns: ProColumns<Announcement>[] = [
    {
      title: t("announcements.column.title"),
      dataIndex: "title",
      width: 260,
      render: (_, r) => (
        <Space>
          {r.pinned && <Tag color="red">{t("announcements.tag.pinned")}</Tag>}
          <Link href={`/announcements/${r.id}`}>{r.title}</Link>
        </Space>
      )
    },
    {
      title: t("announcements.column.recipients"),
      dataIndex: "targetRoles",
      width: 180,
      render: (v) => {
        const arr = (Array.isArray(v) ? v : []) as string[];
        if (arr.length === 0) return <Tag>{t("announcements.recipients.all")}</Tag>;
        return (
          <Space size={4} wrap>
            {arr.map((r) => (
              <Tag key={r} color="blue">
                {ROLE_LABEL[r] ?? r}
              </Tag>
            ))}
          </Space>
        );
      }
    },
    {
      title: t("announcements.column.effectivePeriod"),
      dataIndex: "effectiveFrom",
      width: 240,
      render: (_, r) =>
        `${r.effectiveFrom ? new Date(r.effectiveFrom).toLocaleDateString("zh-CN") : "—"} ~ ${r.effectiveTo ? new Date(r.effectiveTo).toLocaleDateString("zh-CN") : t("announcements.effectivePeriod.forever")}`
    },
    {
      title: t("announcements.column.publishTime"),
      dataIndex: "publishAt",
      width: 180,
      render: (_, r) => <DateTimeCell value={r.publishAt} />
    },
    {
      title: t("announcements.column.actions"),
      width: 160,
      fixed: "right",
      render: (_, r) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>
            {t("announcements.edit")}
          </Button>
          <Button
            type="link"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(r)}
          >
            {t("announcements.delete")}
          </Button>
        </Space>
      )
    }
  ];

  return (
    <Page>
      <PageHeader
        title={t("announcements.title")}
        subtitle={t("announcements.subtitle")}
        actions={
          <Button key="add" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            {t("announcements.create")}
          </Button>
        }
      />
      <ProTable<Announcement>
        rowKey="id"
        search={false}
        actionRef={actionRef}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        request={makeListRequest<Announcement>("/api/announcements")}
        cardBordered={false}
        columns={columns}
      />

      <Modal
        title={editingId ? t("announcements.edit") : t("announcements.create")}
        open={modalOpen}
        onCancel={closeModal}
        destroyOnClose
        width={760}
        footer={
          <Space>
            <Button onClick={closeModal}>{t("announcements.cancel")}</Button>
            <Button type="primary" loading={submitting} onClick={() => form.submit()}>
              {editingId ? t("announcements.save") : t("announcements.publish")}
            </Button>
          </Space>
        }
      >
        <FormCard headerHint={t("announcements.hint")}>
          <ProForm
            form={form}
            layout="vertical"
            submitter={false}
            preserve={false}
            onFinish={onFinish}
          >
            <FormSection title={t("announcements.section.content")}>
              <FormGrid columns={1}>
                <ProFormText
                  name="title"
                  label={t("announcements.field.title")}
                  placeholder={t("announcements.field.title.placeholder")}
                  rules={[{ required: true, min: 2, max: 200, message: "标题为 2 — 200 个字符（必填）" }]}
                  fieldProps={{ size: "large", maxLength: 200, showCount: true }}
                />
                <ProFormTextArea
                  name="content"
                  label={t("announcements.field.content")}
                  placeholder={t("announcements.field.content.placeholder")}
                  rules={[{ required: true, min: 1, max: 10000, message: "公告内容不能超过 10000 个字符（必填）" }]}
                  fieldProps={{
                    size: "large",
                    rows: 6,
                    maxLength: 10000,
                    showCount: true
                  }}
                />
              </FormGrid>
            </FormSection>

            <FormSection title={t("announcements.section.options")}>
              <FormGrid columns={2}>
                <ProFormSwitch
                  name="pinned"
                  label={t("announcements.field.pinned")}
                  tooltip={t("announcements.field.pinned.tooltip")}
                />
                <ProFormSelect
                  name="targetRoles"
                  label={t("announcements.field.targetRoles")}
                  placeholder={t("announcements.field.targetRoles.placeholder")}
                  options={TARGET_ROLE_OPTIONS}
                  mode="multiple"
                  fieldProps={{ size: "large", allowClear: true }}
                />
                <ProFormDateRangePicker
                  name="effectiveRange"
                  label={t("announcements.field.effectiveRange")}
                  fieldProps={{ size: "large", style: { width: "100%" } }}
                />
              </FormGrid>
            </FormSection>
          </ProForm>
        </FormCard>
      </Modal>
    </Page>
  );
}
