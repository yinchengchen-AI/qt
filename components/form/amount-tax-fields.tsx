"use client";
import { ProFormDigit, ProFormSelect, ProFormDependency } from "@ant-design/pro-components";
import { Typography } from "antd";
import type { Rule } from "antd/es/form";
import { FormGrid } from "./FormSection";
import { TAX_RATE_OPTIONS, TAX_RATE_LABELS } from "@/lib/validators/_shared";
import { calcTaxBreakdownPreview } from "@/lib/tax";
import { formatCurrency } from "@/lib/format";

type AmountTaxFieldsProps = {
  /** 金额字段名。合同: "totalAmount"; 发票: "amount" */
  amountName: string;
  /** 金额字段 label, 如 "合同总额（含税）" / "含税金额" */
  amountLabel: string;
  amountPlaceholder?: string;
  /** 金额必填校验文案 */
  requiredMessage: string;
  /** 税率字段名, 默认 "taxRate" */
  taxRateName?: string;
  /** 税率默认值, 仅新建页传(如 0.06); 编辑页不传, 由 form 级 initialValues 回显, 避免字段级默认值覆盖 */
  initialTaxRate?: number;
  /** 追加到金额字段的校验规则(如开票页的超额 warning) */
  amountRules?: Rule[];
};

/**
 * 统一合同/发票表单的「金额 + 税率 + 税额预览」。
 * 必须渲染在 ProForm 上下文内(依赖 ProFormDependency 取表单值)。
 * 预览仅为展示近似, 服务端仍以 lib/money.ts calcTaxBreakdown 权威计算入库。
 */
export function AmountTaxFields({
  amountName,
  amountLabel,
  amountPlaceholder,
  requiredMessage,
  taxRateName = "taxRate",
  initialTaxRate,
  amountRules
}: AmountTaxFieldsProps) {
  return (
    <>
      <FormGrid columns={2}>
        <ProFormDigit
          name={amountName}
          label={amountLabel}
          placeholder={amountPlaceholder}
          min={0.01}
          rules={[{ required: true, message: requiredMessage }, ...(amountRules ?? [])]}
          fieldProps={{ size: "large", precision: 2, prefix: "¥" }}
        />
        <ProFormSelect
          name={taxRateName}
          label="税率"
          initialValue={initialTaxRate}
          options={TAX_RATE_OPTIONS.map((v, i) => ({ value: v, label: TAX_RATE_LABELS[i] }))}
          rules={[{ required: true, message: "请选择适用税率（必填）" }]}
          fieldProps={{ size: "large" }}
        />
      </FormGrid>
      <ProFormDependency name={[amountName, taxRateName]}>
        {(values) => {
          const amount = Number(values[amountName]);
          const rate = Number(values[taxRateName]);
          if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(rate)) return null;
          const { taxAmount, amountExcludingTax } = calcTaxBreakdownPreview(amount, rate);
          return (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              税额 ≈ {formatCurrency(taxAmount)} · 不含税金额 ≈ {formatCurrency(amountExcludingTax)}
              （预览仅供参考，以服务端计算为准）
            </Typography.Text>
          );
        }}
      </ProFormDependency>
    </>
  );
}
