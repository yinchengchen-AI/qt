import { useEffect, useState } from "react";
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
  // 当前选中的 category:用于过滤 parentCode 选项
  const category = Form.useWatch("category", form);
  // 拉取同 category 下所有字典项 (含父级引用)
  const [parentOptions, setParentOptions] = useState<{ code: string; label: string; parentCode: string | null }[]>([]);
  const [parentLoading, setParentLoading] = useState(false);
  useEffect(() => {
    if (!open || !category) { setParentOptions([]); return; }
    let cancelled = false;
    setParentLoading(true);
    fetch(`/api/dictionaries?category=${encodeURIComponent(category)}&pageSize=200&includeInactive=true`, { credentials: "include" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.code === 0) setParentOptions(j.data.list);
        else setParentOptions([]);
      })
      .catch(() => { if (!cancelled) setParentOptions([]); })
      .finally(() => { if (!cancelled) setParentLoading(false); });
    return () => { cancelled = true; };
  }, [open, category]);

  async function onSubmit() {
    try {
      const v = await form.validateFields();
      // 提交时把空 parentCode 删掉,让后端按"无"处理
      if (v.parentCode === "" || v.parentCode === undefined) delete v.parentCode;
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
      message.success("字典项已新增");
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
      width={520}
    >
      <Form layout="vertical" form={form} initialValues={{ category: defaultCategory, sort: 0 }}>
        <Form.Item name="category" label="分类" rules={[{ required: true }]}>
          <Select
            options={ALLOWED_DICTIONARY_CATEGORIES.map((c) => ({
              value: c,
              label: DICTIONARY_CATEGORY_LABEL[c] ?? c
            }))}
            showSearch
            onChange={() => form.setFieldValue("parentCode", undefined)}
          />
        </Form.Item>
        <Form.Item
          name="code"
          label="代码"
          tooltip="同 category 内唯一；树形字典建议采用 R{父 ID}.{ID} 或 {父}.{子} 的形式"
          rules={[
            { required: true, max: 40 },
            { pattern: /^[A-Z][A-Z0-9_.]*$/, message: "需以大写字母开头，仅允许大写字母、数字、下划线、点" }
          ]}
        >
          <Input placeholder="如：R2.30" />
        </Form.Item>
        <Form.Item name="label" label="标签" rules={[{ required: true, max: 80 }]}>
          <Input maxLength={80} showCount />
        </Form.Item>
        <Form.Item
          name="parentCode"
          label="父级代码"
          tooltip="仅树形字典（如 REGION）使用；留空则为顶级；选择父级后，code 需与父级 code 保持一致（后端校验）"
        >
          <Select
            allowClear
            loading={parentLoading}
            disabled={!category}
            placeholder={category ? "不选则为顶级（无父级）" : "请先选择类目"}
            showSearch
            optionFilterProp="label"
            options={parentOptions.map((p) => ({
              value: p.code,
              label: `${p.code}  ·  ${p.label}${p.parentCode ? `  (父 ${p.parentCode})` : "  (顶级)"}`
            }))}
          />
        </Form.Item>
        <Form.Item name="sort" label="排序" rules={[{ type: "number", min: 0, max: 9999 }]}>
          <InputNumber min={0} max={9999} style={{ width: "100%" }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
