"use client";
// 合同标题自动填充 hook:
//   - 监听 form 的 customerName + serviceType + signDate 变化,任一变化时若标题未手动改过则重算
//   - 标题为空 或 仍是上次自动填充值 → 覆盖
//   - 用户手动改过(标题偏离 lastAutoFilledRef)→ 不再覆盖
//   - 编辑页启动时,如既有标题 = computeAutoTitle(customerName, serviceTypeLabel, year),初始化 lastAutoFilledRef,
//     这样改 serviceType/signDate 时会顺带重算;反之既有标题是手工写的则不重算
import { useCallback, useMemo, useRef } from "react";
import { computeAutoTitle } from "@/lib/contract-title";

export type ContractTitleAutofillOptions = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ProFormRef 类型未导出
  formRef: React.MutableRefObject<any>;
  // serviceType 字典(code→label),用于把 form 里的 code 翻成中文标签
  serviceType: Array<{ code: string; label: string }>;
  // 当前客户名称(录入页用 state;编辑页用 data.customerName)
  customerName: string;
};

// 从 ProFormDatePicker 的 value(dayjs / moment / Date)抽年份;无效值返回 null
function extractYear(v: unknown): number | null {
  if (!v) return null;
  if (v instanceof Date) return v.getFullYear();
  // dayjs / moment 都有 .year() 方法
  const maybeYear = (v as { year?: () => number }).year;
  if (typeof maybeYear === "function") {
    const y = maybeYear.call(v);
    return Number.isFinite(y) ? y : null;
  }
  return null;
}

export function useContractTitleAutofill(opts: ContractTitleAutofillOptions) {
  const { formRef, serviceType, customerName } = opts;
  const lastAutoFilledRef = useRef<string>("");

  const serviceTypeLabelByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of serviceType) m.set(d.code, d.label);
    return m;
  }, [serviceType]);

  // 计算并尝试自动填充
  const tryAutoFill = useCallback(
    (overrides?: { customerName?: string; year?: number | null }) => {
      const form = formRef.current;
      if (!form) return;
      const values = form.getFieldsValue();
      const cName = (overrides?.customerName ?? customerName).trim();
      const sCode = (values.serviceType as string | undefined) ?? "";
      if (!cName || !sCode) return;
      const sLabel = serviceTypeLabelByCode.get(sCode) ?? "";
      const y = overrides?.year !== undefined ? overrides.year : extractYear(values.signDate);
      const next = computeAutoTitle(cName, sLabel, y);
      if (!next) return;
      const current = (values.title as string | undefined) ?? "";
      if (current === "" || current === lastAutoFilledRef.current) {
        form.setFieldValue("title", next);
        lastAutoFilledRef.current = next;
      }
    },
    [formRef, serviceTypeLabelByCode, customerName]
  );

  // 编辑页初始化:让 hook 知道当前标题是否就是自动生成的格式
  // 是 → 记入 lastAutoFilledRef,后续 serviceType/signDate 改动会顺带重算
  // 否 → 不动 ref,后续 serviceType/signDate 改动保留手工标题
  const syncFromInitial = useCallback(
    (title: string | undefined, serviceTypeCode: string | undefined, year: number | null) => {
      if (lastAutoFilledRef.current) return; // 已初始化过
      if (!title || !serviceTypeCode) return;
      const sLabel = serviceTypeLabelByCode.get(serviceTypeCode) ?? "";
      const auto = computeAutoTitle(customerName, sLabel, year);
      if (auto && auto === title) {
        lastAutoFilledRef.current = auto;
      }
    },
    [serviceTypeLabelByCode, customerName]
  );

  return { tryAutoFill, syncFromInitial };
}
