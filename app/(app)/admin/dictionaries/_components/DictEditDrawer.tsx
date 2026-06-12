"use client";
import { App as AntdApp, Button, Drawer, Form, Input, InputNumber, Switch, Tag } from "antd";
import { useEffect } from "react";

type Dict = {
  id: string;
  category: string;
  code: string;
  label: string;
  sort: number;
  isActive: boolean;
};

type Props = {
  open: boolean;
  dict: Dict | null;
  onClose: () => void;
  onSaved: () => void;
};

export function DictEditDrawer({ open, dict, onClose, onSaved }: Props) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();

  useEffect(() => {
    if (dict) {
      form.setFieldsValue({
        label: dict.label,
        sort: dict.sort,
        isActive: dict.isActive
      });
    }
  }, [dict, form]);

  async function onSubmit() {
    try {
      const v = await form.validateFields();
      if (!dict) return;
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
    }
  }

  return (
    <Drawer
      title={dict ? `编辑 ${dict.code}` : "编辑"}
      open={open}
      onClose={onClose}
      size={420}
      extra={
        <Button type="primary" onClick={onSubmit}>
          保存
        </Button>
      }
    >
      {dict ? (
        <>
          <Form layout="vertical" form={form}>
            <Form.Item label="分类">
              <Tag color="blue">{dict.category}</Tag>
              <Tag>{dict.code}</Tag>
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
