"use client";
import { App as AntdApp, Form, Input, InputNumber, Modal, Select } from "antd";
import {
  ALLOWED_DICTIONARY_CATEGORIES,
  DICTIONARY_CATEGORY_LABEL
} from "@/lib/dictionary-categories";

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  defaultCategory?: string;
};

export function CreateDictModal({ open, onClose, onSaved, defaultCategory }: Props) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();

  async function onSubmit() {
    try {
      const v = await form.validateFields();
      const r = await fetch("/api/dictionaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(v)
      });
      const j = await r.json();
      if (j.code !== 0) {
        message.error(j.message);
        return;
      }
      message.success("已新增");
      form.resetFields();
      onSaved();
      onClose();
    } catch {
      /* ignore */
    }
  }

  return (
    <Modal
      title="新增字典项"
      open={open}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      onOk={onSubmit}
      okText="保存"
      cancelText="取消"
    >
      <Form layout="vertical" form={form} initialValues={{ category: defaultCategory, sort: 0 }}>
        <Form.Item name="category" label="分类" rules={[{ required: true }]}>
          <Select
            options={ALLOWED_DICTIONARY_CATEGORIES.map((c) => ({
              value: c,
              label: DICTIONARY_CATEGORY_LABEL[c] ?? c
            }))}
            showSearch
          />
        </Form.Item>
        <Form.Item
          name="code"
          label="代码"
          rules={[
            { required: true, max: 40 },
            { pattern: /^[A-Z][A-Z0-9_]*$/, message: "大写字母/数字/下划线,以大写字母开头" }
          ]}
        >
          <Input placeholder="如 新类型" />
        </Form.Item>
        <Form.Item name="label" label="标签" rules={[{ required: true, max: 80 }]}>
          <Input maxLength={80} showCount />
        </Form.Item>
        <Form.Item name="sort" label="排序" rules={[{ type: "number", min: 0, max: 9999 }]}>
          <InputNumber min={0} max={9999} style={{ width: "100%" }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
