"use client";
import { useEffect } from "react";
import useSWR from "swr";
import { App as AntdApp, DatePicker, Form, Input, InputNumber, Modal, Select, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { toIsoDateTime } from "@/lib/format";

const { Text } = Typography;

const PAYMENT_METHOD_OPTIONS = [
  { value: "LUMP_SUM", label: "一次性" },
  { value: "BY_PHASE", label: "按阶段" },
  { value: "BY_MONTH", label: "按月" },
  { value: "BY_QUARTER", label: "按季" }
];

type SourceContract = {
  id: string;
  contractNo: string;
  customerId: string;
  customerName: string;
  title: string;
  serviceType: string;
  signDate: string;
  startDate: string;
  endDate: string;
  totalAmount: string;
  taxRate: string;
  paymentMethod: string;
  remark: string | null;
};

type FormValues = {
  contractNo: string;
  title: string;
  signDate: Dayjs;
  startDate: Dayjs;
  endDate: Dayjs;
  totalAmount: number;
  paymentMethod: string;
  remark?: string;
};

const fetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url, { credentials: "include" });
  const j = await res.json();
  if (j.code !== 0) throw new Error(j.message);
  return j.data as T;
};

type Props = {
  /** 源合同 id; null = 不打开 */
  sourceContractId: string | null;
  onClose: () => void;
  /** 创建成功后回调 (父组件刷新待办/列表) */
  onSuccess: (newContractId: string) => void;
};

/** 续签 Modal: 预填源合同关键字段, 日期默认 原 endDate+1 起同跨度, 走正常 DRAFT 创建流程 (不绕过审批) */
export function RenewalModal({ sourceContractId, onClose, onSuccess }: Props) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<FormValues>();
  const { data: source, isLoading } = useSWR<SourceContract>(
    sourceContractId ? `/api/contracts/${sourceContractId}` : null,
    fetcher
  );

  // 源合同加载完成后预填表单 (initialValues 一次性, 用 setFieldsValue 跟随异步数据)
  useEffect(() => {
    if (!source) return;
    const srcStart = dayjs(source.startDate);
    const srcEnd = dayjs(source.endDate);
    const spanDays = Math.max(1, srcEnd.diff(srcStart, "day"));
    const newStart = srcEnd.add(1, "day");
    form.setFieldsValue({
      contractNo: "",
      title: `${source.title}（续签）`,
      signDate: dayjs(),
      startDate: newStart,
      endDate: newStart.add(spanDays, "day"),
      totalAmount: Number(source.totalAmount),
      paymentMethod: source.paymentMethod,
      remark: source.remark ?? undefined
    });
  }, [source, form]);

  const submit = async () => {
    const values = await form.validateFields();
    if (!source) return;
    const res = await fetch("/api/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        customerId: source.customerId,
        contractNo: values.contractNo.trim(),
        title: values.title,
        serviceType: source.serviceType,
        signDate: toIsoDateTime(values.signDate),
        startDate: toIsoDateTime(values.startDate),
        endDate: toIsoDateTime(values.endDate),
        totalAmount: values.totalAmount,
        taxRate: Number(source.taxRate),
        paymentMethod: values.paymentMethod,
        remark: values.remark ?? null,
        renewedFromId: source.id
      })
    });
    const j = await res.json();
    if (j.code !== 0) {
      message.error(j.message);
      return;
    }
    message.success("续签合同已创建（草稿），走正常审批/发布流程");
    onSuccess(j.data.id as string);
  };

  return (
    <Modal
      title={`续签合同（源：${source?.contractNo ?? "…"}）`}
      open={sourceContractId !== null}
      onCancel={onClose}
      onOk={submit}
      okText="创建续签"
      cancelText="取消"
      confirmLoading={false}
      width={560}
      destroyOnHidden
    >
      {isLoading || !source ? (
        <Text type="secondary">加载源合同…</Text>
      ) : (
        <>
          <Text type="secondary" style={{ fontSize: 12 }}>
            客户与服务类型沿源合同：{source.customerName}；创建后源合同由既有自动完结/强关流程收尾
          </Text>
          <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
            <Form.Item
              name="contractNo"
              label="新合同编号"
              rules={[{ required: true, message: "请填写新合同编号" }, { max: 50 }]}
            >
              <Input placeholder="手工录入, 不可与现有合同重复" />
            </Form.Item>
            <Form.Item name="title" label="合同标题" rules={[{ required: true, min: 2, message: "至少 2 个字符" }]}>
              <Input maxLength={200} />
            </Form.Item>
            <Form.Item name="signDate" label="签订日" rules={[{ required: true }]}>
              <DatePicker style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="startDate" label="开始日期" rules={[{ required: true }]}>
              <DatePicker style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="endDate" label="结束日期" rules={[{ required: true }]}>
              <DatePicker style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="totalAmount" label="合同总额（元）" rules={[{ required: true, message: "请填写金额" }]}>
              <InputNumber min={0.01} precision={2} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="paymentMethod" label="付款方式" rules={[{ required: true }]}>
              <Select options={PAYMENT_METHOD_OPTIONS} />
            </Form.Item>
            <Form.Item name="remark" label="备注">
              <Input.TextArea rows={2} maxLength={500} />
            </Form.Item>
          </Form>
        </>
      )}
    </Modal>
  );
}
