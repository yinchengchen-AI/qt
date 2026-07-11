// 催收记录 Drawer: 表单 + 列表
"use client";
import { useCallback, useEffect, useState } from "react";
import {
  App as AntdApp,
  Badge,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Tag,
  Typography,
  DatePicker,
  Space as AntSpace
} from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useT } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format";
import { Authority } from "@/components/authority";
import { useResponsive } from "@/lib/use-breakpoint";
import { RESOURCE, ACTION } from "@/lib/permissions";

const { Text } = Typography;

export type DunningStatus = "CONTACTED" | "PROMISED" | "DISPUTED" | "LEGAL";
export type DunningChannel = "PHONE" | "WECHAT" | "EMAIL" | "VISIT";

export type DunningNote = {
  id: string;
  invoiceId: string;
  invoiceNo: string | null;
  status: DunningStatus;
  promisedDate: string | null;
  lastContactAt: string;
  channel: DunningChannel;
  remark: string | null;
  actorId: string;
  actorName: string;
  createdAt: string;
  updatedAt: string;
};

const STATUS_COLOR: Record<DunningStatus, string> = {
  CONTACTED: "blue",
  PROMISED: "green",
  DISPUTED: "orange",
  LEGAL: "red"
};

type Props = {
  open: boolean;
  invoiceId: string | null;
  invoiceNo?: string;
  onClose: () => void;
  /** 提交 / 删除 / 列表刷新后回调(用于刷新明细行的 Badge) */
  onChanged?: () => void;
};

type FormValues = {
  status: DunningStatus;
  promisedDate?: Dayjs;
  lastContactAt: Dayjs;
  channel: DunningChannel;
  remark?: string;
};

export function DunningDrawer({ open, invoiceId, invoiceNo, onClose, onChanged }: Props) {
  const t = useT();
  const { message } = AntdApp.useApp();
  const { isMobile } = useResponsive();
  const [form] = Form.useForm<FormValues>();
  const [notes, setNotes] = useState<DunningNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!invoiceId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/statistics/aging/dunning-notes?invoiceId=${invoiceId}`, {
        credentials: "include"
      });
      const j = await r.json();
      if (j.code !== 0) throw new Error(j.message);
      setNotes(j.data as DunningNote[]);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [invoiceId, message]);

  useEffect(() => {
    if (open && invoiceId) {
      load();
      form.resetFields();
      form.setFieldsValue({ status: "CONTACTED", lastContactAt: dayjs(), channel: "PHONE" });
    }
  }, [open, invoiceId, load, form]);

  const handleSubmit = async () => {
    if (!invoiceId) return;
    try {
      const v = await form.validateFields();
      setSubmitting(true);
      const body = {
        invoiceId,
        status: v.status,
        promisedDate: v.promisedDate ? v.promisedDate.toISOString() : null,
        lastContactAt: v.lastContactAt.toISOString(),
        channel: v.channel,
        remark: v.remark ?? null
      };
      const r = await fetch("/api/statistics/aging/dunning-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body)
      });
      const j = await r.json();
      if (j.code !== 0) throw new Error(j.message);
      message.success("已添加催收记录");
      form.resetFields();
      form.setFieldsValue({ status: "CONTACTED", lastContactAt: dayjs(), channel: "PHONE" });
      await load();
      onChanged?.();
    } catch (e) {
      // antd validation error is an object
      if (e && typeof e === "object" && "errorFields" in (e as Record<string, unknown>)) return;
      message.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const r = await fetch(`/api/statistics/aging/dunning-notes/${id}`, {
        method: "DELETE",
        credentials: "include"
      });
      const j = await r.json();
      if (j.code !== 0) throw new Error(j.message);
      message.success("已删除");
      await load();
      onChanged?.();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const status: DunningStatus = Form.useWatch("status", form) ?? "CONTACTED";

  // status 切换时清空 promisedDate, 避免 PROMISED 时填的值在切到 CONTACTED 后残留,
  // 再次切回 PROMISED 时被误当成新填的(issue #8 from review)
  useEffect(() => {
    if (status !== "PROMISED") {
      form.setFieldValue("promisedDate", null);
    }
  }, [status, form]);

  return (
    <Drawer
      title={t("aging.dunning.title") + (invoiceNo ? ` · ${invoiceNo}` : "")}
      open={open}
      onClose={onClose}
      width={isMobile ? "100%" : 520}
      destroyOnHidden
    >
      <Authority resource={RESOURCE.DUNNING} action={ACTION.CREATE}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ status: "CONTACTED", lastContactAt: dayjs(), channel: "PHONE" }}
          style={{ marginBottom: 16 }}
        >
          <Form.Item name="status" label={t("aging.dunning.field.status")} rules={[{ required: true }]}>
            <Segmented
              options={[
                { label: t("aging.dunning.status.CONTACTED"), value: "CONTACTED" },
                { label: t("aging.dunning.status.PROMISED"), value: "PROMISED" },
                { label: t("aging.dunning.status.DISPUTED"), value: "DISPUTED" },
                { label: t("aging.dunning.status.LEGAL"), value: "LEGAL" }
              ]}
              block
            />
          </Form.Item>
          <AntSpace style={{ width: "100%" }} size={12} wrap>
            <Form.Item
              name="lastContactAt"
              label={t("aging.dunning.field.lastContactAt")}
              rules={[{ required: true }]}
              style={{ flex: 1, minWidth: 200 }}
            >
              <DatePicker showTime style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              name="channel"
              label={t("aging.dunning.field.channel")}
              rules={[{ required: true }]}
              style={{ flex: 1, minWidth: 160 }}
            >
              <Select
                options={[
                  { label: t("aging.dunning.channel.PHONE"), value: "PHONE" },
                  { label: t("aging.dunning.channel.WECHAT"), value: "WECHAT" },
                  { label: t("aging.dunning.channel.EMAIL"), value: "EMAIL" },
                  { label: t("aging.dunning.channel.VISIT"), value: "VISIT" }
                ]}
              />
            </Form.Item>
          </AntSpace>
          {status === "PROMISED" ? (
            <Form.Item
              name="promisedDate"
              label={t("aging.dunning.field.promisedDate")}
              rules={[{ required: true, message: "客户承诺状态必填承诺付款日" }]}
            >
              <DatePicker style={{ width: "100%" }} />
            </Form.Item>
          ) : (
            <Form.Item name="promisedDate" label={t("aging.dunning.field.promisedDate")}>
              <DatePicker style={{ width: "100%" }} />
            </Form.Item>
          )}
          <Form.Item name="remark" label={t("aging.dunning.field.remark")}>
            <Input.TextArea rows={3} maxLength={1000} showCount />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" icon={<PlusOutlined />} loading={submitting} onClick={handleSubmit} block>
              添加催收记录
            </Button>
          </Form.Item>
        </Form>
      </Authority>

      <Text type="secondary" style={{ fontSize: 12 }}>历史记录 ({notes.length})</Text>
      <div style={{ marginTop: 8 }}>
        {loading ? (
          <Text type="secondary">加载中…</Text>
        ) : notes.length === 0 ? (
          <Empty description={t("aging.dunning.empty")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <List
            dataSource={notes}
            renderItem={(n) => (
              <List.Item
                key={n.id}
                actions={[
                  <Authority key="del" resource={RESOURCE.DUNNING} action={ACTION.DELETE}>
                    <Popconfirm title="删除该催收记录?" onConfirm={() => handleDelete(n.id)} okText="删除" cancelText="取消">
                      <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Authority>
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      <Tag color={STATUS_COLOR[n.status]}>{t(`aging.dunning.status.${n.status}`)}</Tag>
                      <Text type="secondary" style={{ fontSize: 12 }}>{t(`aging.dunning.channel.${n.channel}`)}</Text>
                      {n.promisedDate ? (
                        <Text type="secondary" style={{ fontSize: 12 }}>承诺: {n.promisedDate.slice(0, 10)}</Text>
                      ) : null}
                    </Space>
                  }
                  description={
                    <>
                      <div style={{ fontSize: 12, color: "rgba(0,0,0,0.65)" }}>{n.remark || "—"}</div>
                      <div style={{ fontSize: 11, color: "rgba(0,0,0,0.45)", marginTop: 2 }}>
                        {n.actorName} · {formatDateTime(n.lastContactAt)}
                      </div>
                    </>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </div>
    </Drawer>
  );
}

/** 简单的"有 N 条催收" Badge, 供明细表行内使用 */
export function DunningBadge({ count }: { count: number }) {
  if (count === 0) return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
  return <Badge count={count} showZero color="blue" />;
}
