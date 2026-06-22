"use client";
// 项目名称自动填充 hook:
//   - 监听 form 的 contractId + name; 当 contract 变化时, 若 name 仍空或仍是上次自动填充值, 就覆盖
//   - 标题为空 / 仍是 lastAutoFilledRef → 覆盖
//   - 用户手动改过(标题偏离 lastAutoFilledRef)→ 不再覆盖
//   - 编辑页不调本 hook, 因为名字可能用户已改过, 自动重算风险大于收益
//
// 跟 lib/use-contract-title-autofill.ts 同款防御 (输入归一化 + 字符串防御)
// 区别: 触发源是 selectedContract (单一对象) 而不是 customerName + serviceType + signDate 三个
import { useCallback, useEffect, useMemo, useRef } from "react";
import { computeProjectTitle, toSafeName } from "@/lib/project-title";

export type ProjectAutofillContract = {
  // 至少给一个 id 表明"选过合同"; 客户名 / 服务类型是 name 派生的输入
  id: string;
  customerName?: string | null;
  serviceType?: string | null; // code, 需要 dict 翻 label
};

export type ProjectTitleAutofillOptions = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ProFormRef 类型未导出
  formRef: React.MutableRefObject<any>;
  // 当前选中的合同 (从 ProFormSelect onChange 拿 option 存到 state)
  // null 表示还没选 / 切换时短暂为 null
  contract: ProjectAutofillContract | null;
  // serviceType 字典 (code→label)
  serviceType: Array<{ code: string; label: string }>;
};

export type ProjectAutofillContext = {
  formValues: { contractId?: unknown; name?: unknown };
  contract: ProjectAutofillContract | null;
  lastAutoFilled: string;
  serviceTypeLabelByCode: Map<string, string>;
};

// 纯函数, 单元测试可单独跑
// 返回 null 表示不该覆盖 (用户手动改过 / 缺关键信息 / 自动生成空串)
export function computeNextProjectName(ctx: ProjectAutofillContext): string | null {
  if (!ctx.contract) return null;
  const cName = toSafeName(ctx.contract.customerName);
  const sCode = toSafeName(ctx.contract.serviceType);
  if (!cName || !sCode) return null;
  const sLabel = ctx.serviceTypeLabelByCode.get(sCode) ?? "";
  const next = computeProjectTitle({
    customerName: cName,
    serviceTypeLabel: sLabel,
    contractNo: ctx.contract.id
  });
  if (!next) return null;
  const current = toSafeName(ctx.formValues.name);
  if (current !== "" && current !== ctx.lastAutoFilled) return null;
  return next;
}

export function useProjectTitleAutofill(opts: ProjectTitleAutofillOptions) {
  const { formRef, contract, serviceType } = opts;
  const lastAutoFilledRef = useRef<string>("");

  const serviceTypeLabelByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of serviceType) m.set(d.code, d.label);
    return m;
  }, [serviceType]);

  const tryAutoFill = useCallback(() => {
    const form = formRef.current;
    if (!form) return;
    const values = form.getFieldsValue() as { contractId?: unknown; name?: unknown };
    const next = computeNextProjectName({
      formValues: values,
      contract,
      lastAutoFilled: lastAutoFilledRef.current,
      serviceTypeLabelByCode
    });
    if (next === null) return;
    form.setFieldValue("name", next);
    lastAutoFilledRef.current = next;
  }, [formRef, contract, serviceTypeLabelByCode]);

  // contract 变化时自动触发 tryAutoFill (不依赖调用方在 onChange 里手动调, 避免闭包抓旧值)
  // serviceTypeLabelByCode.size 也进 deps: useDict 初次返回空数组, SWR 拉到数据后变非空;
  //   如果用户选合同时字典还没回来, 等字典回来再补一次填, 避免竞态漏掉
  useEffect(() => {
    if (!contract) return;
    // 等 form 第一次挂载后再调; 否则 formRef.current 还是 null
    if (!formRef.current) return;
    // 字典还没加载完, 本轮不填 (deps 变了会再跑一次)
    if (serviceTypeLabelByCode.size === 0) {
      if (process.env.NODE_ENV !== "production") {
         
        console.debug("[project-autofill] skip: serviceType dict not loaded yet");
      }
      return;
    }
    if (process.env.NODE_ENV !== "production") {
       
      console.debug(
        "[project-autofill] fire: contract=" + contract.id +
        " customerName=" + (contract.customerName ?? "") +
        " serviceType=" + (contract.serviceType ?? "") +
        " dictSize=" + serviceTypeLabelByCode.size
      );
    }
    tryAutoFill();
  }, [contract?.id, serviceTypeLabelByCode, formRef, tryAutoFill]);

  return { tryAutoFill, lastAutoFilledRef };
}
