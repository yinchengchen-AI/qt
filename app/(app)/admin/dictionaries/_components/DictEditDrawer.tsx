"use client";
import { App as AntdApp, Alert, Button, Drawer, Form, Input, InputNumber, Space, Switch, Tag } from "antd";
import { useEffect, useState } from "react";
import { DICT_META } from "@/lib/dict-domain";
import type { DictRow } from "./DictTableView";

type Props = {
  open: boolean;
  dict: DictRow | null;
  onClose: () => void;
  onSaved: () => void;
};

export function DictEditDrawer({ open, dict, onClose, onSaved }: Props) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (dict) {
      form.setFieldsValue({
        label: dict.label,
        sort: dict.sort,
        isActive: dict.isActive
      });
    }
  }, [dict, form]);

  const readonlyByCategory = dict ? (DICT_META[dict.code]?.readonly ?? false) : false;

  async function onSubmit() {
    try {
      const v = await form.validateFields();
      if (!dict) return;
      setSubmitting(true);
      const r = await fetch(`/api/dictionaries/${dict.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(v)
      });
      const j = await r.json();
      if (j.code !== 0) {
        message.error(j.message);
        return;
      }
      message.success("保存成功");
      onSaved();
      onClose();
    } catch {
      /* ignore */
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer
      title={dict ? `编辑 ${dict.code}` : "编辑"}
      open={open}
      onClose={onClose}
      size={480}
      forceRender
      extra={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" onClick={onSubmit} loading={submitting} disabled={readonlyByCategory}>
            保存
          </Button>
        </Space>
      }
    >
      {dict ? (
        <>
          {readonlyByCategory ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              title="系统字典 · 不可在 UI 中编辑"
              description="该类目由同步脚本管理,仅查看。"
            />
          ) : null}
          <Form layout="vertical" form={form} disabled={readonlyByCategory}>
            <Form.Item label="分类 & 代码">
              <Space size={4} wrap>
                <Tag color="blue">{dict.parentCode ? `${dict.parentCode}  ·  ` : ""}{dict.code.startsWith("REGION") ? "REGION" : ""}</Tag>
                <Tag>{dict.code}</Tag>
              </Space>
            </Form.Item>
            <Form.Item
              name="label"
              label="标签"
              rules={[{ required: true, max: 80 }]}
            >
              <Input maxLength={80} showCount />
            </Form.Item>
            <Form.Item name="sort" label="排序" rules={[{ type: "number", min: 0, max: 9999 }]}>
              <InputNumber min={0} max={9999} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="isActive" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Form>
        </>
      ) : null}
    </Drawer>
  );
}
