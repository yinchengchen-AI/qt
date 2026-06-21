"use client";
// 合同标题自动填充 hook:
//   - 监听 form 的 customerName + serviceType + signDate 变化,任一变化时若标题未手动改过则重算
//   - 标题为空 或 仍是上次自动填充值 → 覆盖
//   - 用户手动改过(标题偏离 lastAutoFilledRef)→ 不再覆盖
//   - 编辑页启动时,如既有标题 = computeAutoTitle(customerName, serviceTypeLabel, year),初始化 lastAutoFilledRef,
//     这样改 serviceType/signDate 时会顺带重算;反之既有标题是手工写的则不重算
//
// 关键防御:customerName / serviceType / signDate 都可能是未知类型(后端字段回填、option 渲染 React 节点、
// dayjs 缺省等)。核心约束:这些字段"必须是字符串"的位置不允许把未知值直接喂给 .trim() / .year(),
// 也不允许用 String() 把数字字面量当成名字拼到标题里 —— 任何非字符串一律降级为空。
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

// 归一化为合法字符串:是字符串则 trim 首尾空白;非字符串(数字 / null / undefined / 对象等)→ ""
// 用在"必须是字符串"的位置(customerName / serviceType)以避免 .trim() 抛错
// 以及把数字字面量当客户名拼到标题里。
export function toSafeName(s: unknown): string {
  return typeof s === "string" ? s.trim() : "";
}

export type AutofillFormValues = {
  serviceType?: unknown;
  signDate?: unknown;
  title?: unknown;
};

export type AutofillContext = {
  formValues: AutofillFormValues;
  // 录入页用 useState 持有的当前客户名(初次渲染时为 "")
  currentCustomerName: string;
  // 上一次自动填充的标题;用于判断用户是否手动改过
  lastAutoFilled: string;
  // onChange 里的 overrides(允许覆盖客户名或年份,跳过 form.getFieldsValue)
  overrides?: { customerName?: unknown; year?: number | null };
  // serviceType code→label 映射(由 serviceType 字典派生)
  serviceTypeLabelByCode: Map<string, string>;
};

// 纯函数:在已知 formValues + overrides + lastAutoFilled 条件下,算出应写入的标题;
// 返回 null 表示不该覆盖(标题被用户手动改过 / 缺关键信息 / 自动生成空串)。
// 抽出来是为了避开 React 测试工具链,直接对防御逻辑做单元测试。
export function computeNextAutoTitle(ctx: AutofillContext): string | null {
  const cName = toSafeName(ctx.overrides?.customerName ?? ctx.currentCustomerName);
  const sCode = toSafeName(ctx.formValues.serviceType);
  if (!cName || !sCode) return null;
  const sLabel = ctx.serviceTypeLabelByCode.get(sCode) ?? "";
  const y =
    ctx.overrides?.year !== undefined
      ? ctx.overrides.year
      : extractYear(ctx.formValues.signDate);
  const next = computeAutoTitle(cName, sLabel, y);
  if (!next) return null;
  const current = toSafeName(ctx.formValues.title);
  if (current !== "" && current !== ctx.lastAutoFilled) return null;
  return next;
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
      const values = (form.getFieldsValue?.() ?? {}) as AutofillFormValues;
      const next = computeNextAutoTitle({
        formValues: values,
        currentCustomerName: customerName,
        lastAutoFilled: lastAutoFilledRef.current,
        overrides,
        serviceTypeLabelByCode
      });
      if (next === null) return;
      form.setFieldValue?.("title", next);
      lastAutoFilledRef.current = next;
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
