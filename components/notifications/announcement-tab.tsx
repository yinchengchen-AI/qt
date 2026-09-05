"use client";
// 通知中心 - 公告 Tab (v0.25.0 通知中心重构)
//
// 公告"阅读 + 管理"一体视图:
//   - 全员可见: 置顶优先、发布时间倒序的时间线卡片, 点击标题进入 /announcements/[id] 详情
//   - ADMIN / OPS: 工具栏「发布公告」+ 卡片「编辑 / 删除」, 复用 /api/announcements (零后端改动)
//   - 关键词搜索 + 分页; 移动端单列卡片
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dayjs from "dayjs";
import { useSession } from "next-auth/react";
import {
  App as AntdApp,
  Button,
  Empty,
  Input,
  Modal,
  Space,
  Spin,
  Tag,
  Typography
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  PushpinOutlined,
  SearchOutlined
} from "@ant-design/icons";
import {
  ProForm,
  ProFormText,
  ProFormTextArea,
  ProFormSelect,
  ProFormDateRangePicker,
  ProFormSwitch
} from "@ant-design/pro-components";
import { FormCard, FormSection, FormGrid } from "@/components/form";
import { ROLE_LABEL } from "@/lib/status";
import { DateTimeCell } from "@/components/table-cells";
import { formatDate } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useResponsive } from "@/lib/use-breakpoint";

const { Text, Paragraph } = Typography;

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

/** 公告管理权限: ADMIN / OPS (与 lib/permissions.ts ROLE_PERMISSIONS 对齐) */
const CAN_MANAGE = new Set(["ADMIN", "OPS"]);

export function AnnouncementTab() {
  const t = useT();
  const { message, modal } = AntdApp.useApp();
  const { isMobile } = useResponsive();
  const { data: session } = useSession();
  const roleCode = (session?.user as { roleCode?: string } | undefined)?.roleCode;
  const canManage = !!roleCode && CAN_MANAGE.has(roleCode);

  const [list, setList] = useState<Announcement[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [searchInput, setSearchInput] = useState("");
  const [keyword, setKeyword] = useState("");

  const [form] = ProForm.useForm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(
    async (p: number, kw: string) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams();
        qs.set("page", String(p));
        qs.set("pageSize", String(pageSize));
        if (kw) qs.set("keyword", kw);
        const r = await fetch(`/api/announcements?${qs}`, { credentials: "include" });
        const j = await r.json();
        if (j.code === 0) {
          setList(j.data.list);
          setTotal(j.data.total);
          setPage(p);
        } else {
          message.error(j.message);
        }
      } catch (e) {
        message.error((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [pageSize, message]
  );

  // 搜索防抖 400ms, 命中后回到第 1 页
  useEffect(() => {
    const id = setTimeout(() => setKeyword(searchInput.trim()), 400);
    return () => clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    void load(1, keyword);
  }, [keyword, load, reloadKey]);

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
          setReloadKey((k) => k + 1);
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
        message.success(
          editingId ? t("announcements.toast.saved") : t("announcements.toast.published")
        );
        closeModal();
        setReloadKey((k) => k + 1);
        return true;
      }
      message.error(j.message);
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          marginBottom: 12
        }}
      >
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder={t("announcements.toolbar.searchPlaceholder")}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{ width: isMobile ? "100%" : 260 }}
        />
        {canManage ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            {t("announcements.create")}
          </Button>
        ) : null}
      </div>

      <Spin spinning={loading}>
        {list.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("announcements.empty")}
            style={{ padding: "40px 0" }}
          />
        ) : (
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            {list.map((a) => (
              <div
                key={a.id}
                style={{
                  background: "var(--ant-color-bg-container, #fff)",
                  border: a.pinned
                    ? "1px solid var(--ant-color-warning-border, #ffe58f)"
                    : "1px solid var(--ant-color-border-secondary, #f0f0f0)",
                  borderRadius: 8,
                  padding: "14px 16px"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                    marginBottom: 6
                  }}
                >
                  {a.pinned ? (
                    <Tag
                      color="warning"
                      style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 4 }}
                    >
                      <PushpinOutlined />
                      {t("announcements.tag.pinned")}
                    </Tag>
                  ) : null}
                  {a.targetRoles.length === 0 ? (
                    <Tag style={{ margin: 0 }}>{t("announcements.recipients.all")}</Tag>
                  ) : (
                    a.targetRoles.map((r) => (
                      <Tag key={r} color="blue" style={{ margin: 0 }}>
                        {ROLE_LABEL[r] ?? r}
                      </Tag>
                    ))
                  )}
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t("announcements.detail.publishAt")}：
                    <DateTimeCell value={a.publishAt} />
                  </Text>
                  {a.effectiveFrom || a.effectiveTo ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {t("announcements.column.effectivePeriod")}：
                      {a.effectiveFrom ? formatDate(a.effectiveFrom) : "—"} ~{" "}
                      {a.effectiveTo
                        ? formatDate(a.effectiveTo)
                        : t("announcements.effectivePeriod.forever")}
                    </Text>
                  ) : null}
                </div>
                <div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.4, marginBottom: 4 }}>
                  <Link href={`/announcements/${a.id}`} style={{ color: "inherit" }}>
                    {a.title}
                  </Link>
                </div>
                <Paragraph
                  type="secondary"
                  style={{ marginBottom: 0, fontSize: 13 }}
                  ellipsis={{ rows: 2, expandable: false }}
                >
                  {a.content}
                </Paragraph>
                {canManage ? (
                  <div style={{ marginTop: 8 }}>
                    <Space size={4}>
                      <Button
                        type="link"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => openEdit(a)}
                      >
                        {t("announcements.edit")}
                      </Button>
                      <Button
                        type="link"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => handleDelete(a)}
                      >
                        {t("announcements.delete")}
                      </Button>
                    </Space>
                  </div>
                ) : null}
              </div>
            ))}
          </Space>
        )}
      </Spin>

      {total > pageSize ? (
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <Space>
            <Button disabled={page <= 1} onClick={() => load(page - 1, keyword)}>
              {t("announcements.pagination.prev")}
            </Button>
            <Text type="secondary">
              {page} / {Math.ceil(total / pageSize)}
            </Text>
            <Button
              disabled={page * pageSize >= total}
              onClick={() => load(page + 1, keyword)}
            >
              {t("announcements.pagination.next")}
            </Button>
          </Space>
        </div>
      ) : null}

      <Modal
        title={editingId ? t("announcements.edit") : t("announcements.create")}
        open={modalOpen}
        onCancel={closeModal}
        destroyOnHidden
        width={isMobile ? "100%" : 760}
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
    </div>
  );
}
