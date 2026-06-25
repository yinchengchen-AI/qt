"use client";
import { ProFormList, ProFormText, ProFormDatePicker, ProFormSelect, ProFormTextArea, ProFormSwitch, ProFormDigit } from "@ant-design/pro-components";
import { Button, Space } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";

type Field = {
  name: string;
  label: string;
  valueType: "text" | "date" | "select" | "digit" | "switch" | "textarea";
  options?: { value: string; label: string }[];
  required?: boolean;
};

type Props = {
  name: string;
  label: string;
  fields: Field[];
  initialValue?: Record<string, unknown>[];
};

export function SubtableEditor({ name, label, fields, initialValue }: Props) {
  return (
    <ProFormList
      name={name}
      label={label}
      initialValue={initialValue ?? []}
      creatorButtonProps={{
        creatorButtonText: `新增${label}`,
        icon: <PlusOutlined />
      }}
      itemRender={({ listDom, action }, { record }) => {
        const a = action as { remove?: (key: unknown) => void };
        return (
          <Space.Compact style={{ display: "flex", width: "100%" }}>
            {listDom}
            <Button
              type="text"
              icon={<DeleteOutlined />}
              onClick={() => a.remove?.(record.key)}
              danger
              style={{ marginLeft: 8 }}
            />
          </Space.Compact>
        );
      }}
      copyIconProps={false}
    >
      {(field, index) => (
        <Space key={index} wrap size="small" style={{ width: "100%" }}>
          {fields.map((f) => {
            if (f.valueType === "text") return <ProFormText key={f.name} name={f.name} label={f.label} width="md" rules={f.required ? [{ required: true, message: `${f.label}必填` }] : []} />;
            if (f.valueType === "date") return <ProFormDatePicker key={f.name} name={f.name} label={f.label} width="md" rules={f.required ? [{ required: true }] : []} />;
            if (f.valueType === "select") return <ProFormSelect key={f.name} name={f.name} label={f.label} width="md" options={f.options} rules={f.required ? [{ required: true }] : []} />;
            if (f.valueType === "digit") return <ProFormDigit key={f.name} name={f.name} label={f.label} width="md" />;
            if (f.valueType === "switch") return <ProFormSwitch key={f.name} name={f.name} label={f.label} />;
            if (f.valueType === "textarea") return <ProFormTextArea key={f.name} name={f.name} label={f.label} fieldProps={{ maxLength: 2000 }} />;
            return null;
          })}
        </Space>
      )}
    </ProFormList>
  );
}
