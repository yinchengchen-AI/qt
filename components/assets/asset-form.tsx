"use client";
// 录入/编辑资产的共享表单组件
// 视觉:type 卡片选择 → 基本信息 → 类型特定字段 → 吸底操作栏
// 优化:2 列网格、快捷日期、推荐标签、字段内 tooltip、Zod 校验联动
import { useState, useMemo, useEffect, useRef } from "react";
import {
  ProForm,
  ProFormText,
  ProFormTextArea,
  ProFormSelect,
  ProFormDateTimePicker
} from "@ant-design/pro-components";
import { Col, Row, Space, Button, Tag, Tooltip, Typography, App } from "antd";
import {
  InfoCircleOutlined,
  CalendarOutlined,
  InfoOutlined
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import dayjs, { type Dayjs } from "dayjs";
import { FormCard, FormSection, FormGrid, SubmitBar } from "@/components/form";
import { AssetTypePicker, ASSET_TYPE_ITEMS } from "@/components/assets/asset-type-picker";
import { AssetTypeFields } from "@/components/assets/asset-type-fields";
import { QuickTagSuggestions } from "@/components/assets/asset-quick-tags";
import { type AssetType as AssetTypeEnum } from "@/types/enums";

const { Text } = Typography;

type Mode = "create" | "edit";

type CommonProps = {
  mode: Mode;
  initialValues?: {
    type?: string;
    name?: string;
    description?: string | null;
    tags?: string[];
    validFrom?: string | null;
    validTo?: string | null;
    attributes?: Record<string, unknown>;
  };
  /**
   * - true  = 成功,按 redirectOnSave(字符串)跳转
   * - false = 失败/取消
   * - { id } = 成功且把新建 id 抛回,让 form 端跳详情(函数式 redirectOnSave)
   */
  onSubmit: (values: Record<string, unknown>) => Promise<boolean | { id: string }>;
  onCancel?: () => void;
  /** 提交成功后跳转路径;支持函数以拿到新建/编辑后的 id */
  redirectOnSave?: string | ((result: { id: string }) => string);
};

export function AssetForm({ mode, initialValues, onSubmit, onCancel, redirectOnSave }: CommonProps) {
  const router = useRouter();
  const { message } = App.useApp();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formRef = useRef<any>(null);
  const [type, setType] = useState<string>(initialValues?.type ?? "LICENSE");
  const [validFrom, setValidFrom] = useState<Dayjs | null>(
    initialValues?.validFrom ? dayjs(initialValues.validFrom) : null
  );
  const isEdit = mode === "edit";

  useEffect(() => {
    if (initialValues?.type) setType(initialValues.type);
    if (initialValues?.validFrom) setValidFrom(dayjs(initialValues.validFrom));
  }, [initialValues?.type, initialValues?.validFrom]);

  const TypeIcon = useMemo(() => {
    const found = ASSET_TYPE_ITEMS.find((i) => i.value === type);
    return found?.icon as React.ComponentType<{ style?: React.CSSProperties }> | undefined;
  }, [type]);

  // 快捷设置到期日(以 validFrom 为基准)
  const handleQuickSet = (years: number) => {
    const base = validFrom ?? dayjs();
    const v = base.add(years, "year");
    formRef.current?.setFieldValue("validTo", v);
    message.success(`已设置到期日期为 ${v.format("YYYY-MM-DD")}`);
  };

  return (
    <ProForm
      formRef={formRef}
      layout="vertical"
      submitter={false}
      initialValues={{
        type: initialValues?.type ?? "LICENSE",
        name: initialValues?.name ?? "",
        description: initialValues?.description ?? "",
        tags: initialValues?.tags ?? [],
        validFrom: initialValues?.validFrom ?? undefined,
        validTo: initialValues?.validTo ?? undefined,
        attributes: initialValues?.attributes ?? {}
      }}
      onValuesChange={(cv) => {
        if (cv.type !== undefined) setType(cv.type);
        if (cv.validFrom !== undefined) setValidFrom(cv.validFrom ? dayjs(cv.validFrom) : null);
      }}
      onFinish={async (values) => {
        // 客户端二次校验:validTo >= validFrom
        if (values.validFrom && values.validTo) {
          const from = dayjs(values.validFrom);
          const to = dayjs(values.validTo);
          if (to.isBefore(from)) {
            message.error("到期日期不能早于生效日期");
            return false;
          }
        }
        // onSubmit 返回 boolean 或带 id 的对象(新建页需要 id 跳详情)
        const result = await onSubmit(values);
        if (result && typeof result === "object" && "id" in result) {
          const redirect = typeof redirectOnSave === "function"
            ? redirectOnSave({ id: result.id })
            : redirectOnSave;
          if (redirect) router.push(redirect);
          return true;
        }
        if (result === true && typeof redirectOnSave === "string") {
          router.push(redirectOnSave);
          return true;
        }
        return result;
      }}
    >
      <FormCard>
        {/* 步骤 1:类型选择 */}
        <FormSection
          title="资产类型"
          description={isEdit ? "资产类型不可修改" : "选择后将切换下方字段"}
          icon={<InfoCircleOutlined />}
        >
          <AssetTypePicker
            value={type as AssetTypeEnum}
            onChange={(v) => {
              setType(v);
              formRef.current?.setFieldValue("type", v);
            }}
            disabled={isEdit}
          />
        </FormSection>

        {/* 步骤 2:基本信息 */}
        <FormSection
          title="基本信息"
          description="标 * 为必填"
          icon={<InfoOutlined />}
        >
          <FormGrid columns={2}>
            <ProFormText
              name="name"
              label="资产名称"
              placeholder="如:某项资质 / 某业绩 / 某人员"
              rules={[{ required: true, message: "请填写资产名称" }, { max: 100, message: "名称最多 100 字" }]}
              fieldProps={{ maxLength: 100, showCount: true }}
            />
            <ProFormSelect
              name="tags"
              label="标签"
              mode="tags"
              fieldProps={{
                tokenSeparators: [",", "，", ";", "；"],
                placeholder: "输入后回车,或点下方推荐"
              }}
            />
          </FormGrid>

          <ProFormTextArea
            name="description"
            label="说明"
            fieldProps={{ rows: 2, maxLength: 2000, showCount: true }}
            placeholder="可填写此项资产的关键说明,如用途、备注等"
          />

          {/* 标签推荐 */}
          <div style={{ marginTop: -8, marginBottom: 16 }}>
            <QuickTagSuggestions
              type={type as AssetTypeEnum}
              selected={(() => {
                const v = formRef.current?.getFieldValue("tags");
                return Array.isArray(v) ? v : [];
              })()}
              onAdd={(t) => {
                const cur = (formRef.current?.getFieldValue("tags") as string[]) ?? [];
                if (!cur.includes(t)) {
                  formRef.current?.setFieldValue("tags", [...cur, t]);
                }
              }}
            />
          </div>

          {/* 有效期 + 快捷按钮 */}
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ fontSize: 14, display: "block", marginBottom: 8 }}>
              有效期
              <Text type="secondary" style={{ fontSize: 12, marginLeft: 8, fontWeight: 400 }}>
                留空表示永久有效
              </Text>
            </Text>
            <Row gutter={12} align="middle">
              <Col xs={24} sm={11}>
                <ProFormDateTimePicker
                  name="validFrom"
                  label="生效日期"
                  fieldProps={{ style: { width: "100%" }, format: "YYYY-MM-DD HH:mm" }}
                />
              </Col>
              <Col xs={24} sm={2} style={{ textAlign: "center", padding: "0 8px", color: "#999" }}>
                →
              </Col>
              <Col xs={24} sm={11}>
                <ProFormDateTimePicker
                  name="validTo"
                  label="到期日期"
                  fieldProps={{ style: { width: "100%" }, format: "YYYY-MM-DD HH:mm" }}
                />
              </Col>
            </Row>
            <Space size={4} wrap style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12, marginRight: 4 }}>快捷设置到期:</Text>
              <Tooltip title="以生效日期为基准 +1 年">
                <Button size="small" type="dashed" onClick={() => handleQuickSet(1)}>+1 年</Button>
              </Tooltip>
              <Tooltip title="以生效日期为基准 +3 年">
                <Button size="small" type="dashed" onClick={() => handleQuickSet(3)}>+3 年</Button>
              </Tooltip>
              <Tooltip title="以生效日期为基准 +5 年">
                <Button size="small" type="dashed" onClick={() => handleQuickSet(5)}>+5 年</Button>
              </Tooltip>
              <Button size="small" type="text" onClick={() => formRef.current?.setFieldValue("validTo", undefined)}>清空</Button>
            </Space>
          </div>
        </FormSection>

        {/* 步骤 3:类型特定字段 */}
        <FormSection
          title={
            <span>
              类型字段
              <Tag color="blue" style={{ marginLeft: 8, verticalAlign: "middle", fontSize: 12 }}>
                {TypeIcon && <TypeIcon style={{ marginRight: 4 }} />}
                {ASSET_TYPE_ITEMS.find((i) => i.value === type)?.label}
              </Tag>
            </span>
          }
          description={`该区块字段已按 "${ASSET_TYPE_ITEMS.find((i) => i.value === type)?.label}" 资产类型自动切换`}
          icon={<CalendarOutlined />}
        >
          <AssetTypeFields type={type} />
        </FormSection>
      </FormCard>

      <SubmitBar
        onCancel={onCancel ?? (() => router.back())}
        onSubmit={() => formRef.current?.submit()}
        submitText={isEdit ? "保存修改" : "保存资产"}
      />
    </ProForm>
  );
}
