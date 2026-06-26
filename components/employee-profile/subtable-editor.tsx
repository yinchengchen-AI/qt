"use client";
import { ProFormList, ProFormText, ProFormDatePicker, ProFormSelect, ProFormTextArea, ProFormSwitch, ProFormDigit, ProFormUploadButton } from "@ant-design/pro-components";
import { Button, Card, Space, Tag, Typography } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { uploadFileToMinIO } from "@/lib/upload-client";

const { Text } = Typography;

type Field = {
  name: string;
  label: string;
  valueType: "text" | "date" | "select" | "digit" | "switch" | "textarea" | "upload";
  options?: { value: string; label: string }[];
  required?: boolean;
  /** 仅 upload 类型有效:附件分类 */
  uploadCategory?: "GENERAL" | "AVATAR" | "ID_CARD_FRONT" | "ID_CARD_BACK" | "CERTIFICATE";
};

type Props = {
  name: string;
  label: string;
  fields: Field[];
  initialValue?: Record<string, unknown>[];
  /** 顶部说明文案,放在 label 右侧 */
  hint?: React.ReactNode;
  /** 每行右上角的标签 (例如 "证书 1") */
  itemLabelIndex?: boolean;
};

/**
 * 表单子表编辑器:
 * - 每条记录用无边框 Card 包裹,字段网格排列,右上角放"删除"
 * - 新增按钮:整组底部居中,虚线 dashed 风格,引导加新行
 * - 字段宽: text/date/select/digit/upload 默认 md;
 *    textarea 与 switch 占满一整行
 */
export function SubtableEditor({ name, label, fields, initialValue, hint, itemLabelIndex }: Props) {
  return (
    <ProFormList
      name={name}
      label={
        <Space size={8} wrap>
          <span>{label}</span>
          {hint ? <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>{hint}</Text> : null}
        </Space>
      }
      initialValue={initialValue ?? []}
      creatorButtonProps={{
        creatorButtonText: `新增${label}`,
        icon: <PlusOutlined />,
        position: "bottom",
        style: { width: "100%" }
      }}
      itemRender={({ listDom, action }, { index, record }) => {
        const a = action as { remove?: (key: unknown) => void };
        return (
          <Card
            size="small"
            style={{
              marginBottom: 12,
              background: "var(--qt-bg-subtle)",
              border: "1px solid var(--qt-border-soft)"
            }}
            styles={{ body: { padding: 16 } }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Space size={6}>
                <Tag color="blue" style={{ margin: 0 }}>
                  {label} #{typeof index === "number" ? index + 1 : "-"}
                </Tag>
                {itemLabelIndex && (record as { _label?: string })?._label ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {(record as { _label?: string })._label}
                  </Text>
                ) : null}
              </Space>
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => a.remove?.(record.key)}
                aria-label={`删除${label}`}
              >
                删除
              </Button>
            </div>
            {listDom}
          </Card>
        );
      }}
      copyIconProps={false}
    >
      {(field, index) => (
        <div
          key={index}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "12px 16px"
          }}
        >
          {fields.map((f) => {
            // textarea 与 switch 占满整行
            const fullWidth = f.valueType === "textarea" || f.valueType === "switch";
            const wrapStyle: React.CSSProperties = fullWidth
              ? { gridColumn: "1 / -1" }
              : {};
            if (f.valueType === "text") {
              return (
                <div key={f.name} style={wrapStyle}>
                  <ProFormText
                    name={f.name}
                    label={f.label}
                    width="md"
                    rules={f.required ? [{ required: true, message: `${f.label}必填` }] : []}
                  />
                </div>
              );
            }
            if (f.valueType === "date") {
              return (
                <div key={f.name} style={wrapStyle}>
                  <ProFormDatePicker
                    name={f.name}
                    label={f.label}
                    width="md"
                    rules={f.required ? [{ required: true }] : []}
                  />
                </div>
              );
            }
            if (f.valueType === "select") {
              return (
                <div key={f.name} style={wrapStyle}>
                  <ProFormSelect
                    name={f.name}
                    label={f.label}
                    width="md"
                    options={f.options}
                    rules={f.required ? [{ required: true }] : []}
                  />
                </div>
              );
            }
            if (f.valueType === "digit") {
              return (
                <div key={f.name} style={wrapStyle}>
                  <ProFormDigit name={f.name} label={f.label} width="md" />
                </div>
              );
            }
            if (f.valueType === "switch") {
              return (
                <div key={f.name} style={wrapStyle}>
                  <ProFormSwitch name={f.name} label={f.label} />
                </div>
              );
            }
            if (f.valueType === "textarea") {
              return (
                <div key={f.name} style={wrapStyle}>
                  <ProFormTextArea
                    name={f.name}
                    label={f.label}
                    fieldProps={{ maxLength: 2000, showCount: true, autoSize: { minRows: 2, maxRows: 5 } }}
                  />
                </div>
              );
            }
            if (f.valueType === "upload") {
              return (
                <div key={f.name} style={wrapStyle}>
                  <ProFormUploadButton
                    name={f.name}
                    label={f.label}
                    max={1}
                    width="md"
                    fieldProps={{
                      name: "file",
                      listType: "text",
                      customRequest: async (options: { file?: File | unknown; onSuccess?: (res: unknown, xhr: XMLHttpRequest) => void; onError?: (err: Error) => void }) => {
                        const file = options.file as File | undefined;
                        if (!file) {
                          options.onError?.(new Error("空文件"));
                          return;
                        }
                        try {
                          const res = await uploadFileToMinIO(file, { category: f.uploadCategory ?? "GENERAL" });
                          options.onSuccess?.(res, new XMLHttpRequest());
                        } catch (e) {
                          options.onError?.(e as Error);
                        }
                      }
                    }}
                  />
                </div>
              );
            }
            return null;
          })}
        </div>
      )}
    </ProFormList>
  );
}
