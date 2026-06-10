"use client";
import { ProFormSelect, ProFormText } from "@ant-design/pro-components";
import { useState, useEffect } from "react";
import { FormGrid } from "./FormSection";
import {
  PROVINCE,
  CITY,
  HANGZHOU_DISTRICT_OPTIONS,
  streetOptionsFor
} from "@/lib/geo-divisions";

type Props = {
  /** 表单字段名前缀,如 prefix="province" 时生成 name="province" */
  prefix?: string;
  /** 默认值,通常来自 initialValues,例如 { province: "浙江省", city: "杭州市", district: "shangcheng", street: "湖滨街道" } */
  defaultValues?: { province?: string; city?: string; district?: string; street?: string };
  /** 是否要求全部填(默认 false,允许空) */
  required?: boolean;
  /** 给"省份/城市"额外打 disabled,使之显灰 */
  lockProvinceCity?: boolean;
};

/**
 * 客户位置 4 字段：省 / 市 / 区（杭州 12 区/县） / 街道
 * 省 / 市 写死 浙江省 / 杭州市,作为级联锚点;
 * 区/街道按 HANGZHOU_DISTRICTS 联动。
 *
 * 数据可被地区统计分析用：district code 用稳定的 code (shangcheng/xihu/jiande/...),
 * 街道直接存中文名（"湖滨街道"）。
 */
export function RegionFields({
  prefix = "",
  defaultValues = {},
  required = false,
  lockProvinceCity = true
}: Props) {
  const p = prefix ? `${prefix}_` : "";
  const [district, setDistrict] = useState<string | undefined>(defaultValues.district);

  // 当 defaultValues 在挂载后才到(初始编辑),同步
  useEffect(() => {
    setDistrict(defaultValues.district);
  }, [defaultValues.district]);

  const streetOpts = streetOptionsFor(district);

  return (
    <FormGrid columns={2}>
      <ProFormText
        name={`${p}province`}
        label="省份"
        initialValue={defaultValues.province ?? PROVINCE}
        disabled={lockProvinceCity}
        fieldProps={{ size: "large" }}
      />
      <ProFormText
        name={`${p}city`}
        label="城市"
        initialValue={defaultValues.city ?? CITY}
        disabled={lockProvinceCity}
        fieldProps={{ size: "large" }}
      />
      <ProFormSelect
        name={`${p}district`}
        label="区 / 县"
        placeholder="请选择"
        options={HANGZHOU_DISTRICT_OPTIONS}
        showSearch
        rules={required ? [{ required: true, message: "请选择区/县" }] : undefined}
        fieldProps={{
          size: "large",
          onChange: (v) => setDistrict(v as string | undefined)
        }}
      />
      <ProFormSelect
        name={`${p}street`}
        label="街道 / 镇"
        placeholder={district ? "请选择" : "先选区 / 县"}
        options={streetOpts}
        showSearch
        disabled={!district}
        rules={
          required
            ? [{ required: true, message: "请选择街道/镇" }]
            : undefined
        }
        fieldProps={{ size: "large" }}
      />
    </FormGrid>
  );
}
