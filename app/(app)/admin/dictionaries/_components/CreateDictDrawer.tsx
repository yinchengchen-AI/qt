"use client";
import { useEffect, useState } from "react";
import { App as AntdApp, Alert, Button, Drawer, Form, Input, InputNumber, Select, Space } from "antd";
import { ALLOWED_DICTIONARY_CATEGORIES, DICTIONARY_CATEGORY_LABEL } from "@/lib/dictionary-categories";
import { DICT_META, isSystemCategory } from "@/lib/dict-domain";

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** 默认选中的 category; 上下文传入(从 Sider 当前选中) */
  defaultCategory?: string;
  /** 树形类用,预填 parentCode(从"新增子级"按钮触发) */
  defaultParentCode?: string;
};

type FormValues = {
  category: string;
  code: string;
  label: string;
  parentCode?: string;
  sort?: number;
};

export function CreateDictDrawer({ open, onClose, onSaved, defaultCategory, defaultParentCode }: Props) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<FormValues>();
  const category = Form.useWatch("category", form);
  // 拉取同 category 下所有字典项 (含父级引用, 树形类用)
  const [parentOptions, setParentOptions] = useState<{ code: string; label: string; parentCode: string | null }[]>([]);
  const [parentLoading, setParentLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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

  // 打开时重置表单
  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        category: defaultCategory,
        parentCode: defaultParentCode,
        sort: 0
      });
    }
  }, [open, defaultCategory, defaultParentCode, form]);

  const isTree = DICT_META[category]?.shape === "tree";
  const isSystem = isSystemCategory(category);

  async function onSubmit() {
    try {
      const v = await form.validateFields();
      if (v.parentCode === "" || v.parentCode === undefined) delete v.parentCode;
      setSubmitting(true);
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
    } finally {
      setSubmitting(false);
    }
  }

  // open=false 时:不渲染 Drawer (避免内部 Portal SSR/hydration mismatch),
  // 但渲染一个 hidden Form 元素保持 useForm connected (避免 antd 警告)
  if (!open) {
    return (
      <div style={{ display: "none" }} aria-hidden="true">
        <Form form={form} />
      </div>
    );
  }

  return (
    <Drawer
      title="新增字典项"
      open={open}
      onClose={() => {
        form.resetFields();
        onClose();
      }}
      size={480}
      extra={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" onClick={onSubmit} loading={submitting} disabled={isSystem}>
            保存
          </Button>
        </Space>
      }
    >
      {isSystem ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title="系统字典不可在 UI 中新增"
          description="该类目由同步脚本管理，请在对应的数据源中修改。"
        />
      ) : null}
      <Form layout="vertical" form={form} disabled={isSystem}>
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
        {isTree ? (
          <Form.Item
            name="parentCode"
            label="父级代码"
            tooltip="留空则为顶级；选择父级后，code 应以父级 code 开头（后端校验）"
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
        ) : null}
        <Form.Item name="sort" label="排序" rules={[{ type: "number", min: 0, max: 9999 }]}>
          <InputNumber min={0} max={9999} style={{ width: "100%" }} />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
