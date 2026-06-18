"use client";
import { ProCard, ProDescriptions, ProTable } from "@ant-design/pro-components";
import { Alert, App, Button, Form, Input, InputNumber, Modal, Select, Space, Typography } from "antd";
import { DeleteOutlined, EditOutlined, FilePdfOutlined, PlusOutlined } from "@ant-design/icons";
import { useParams, useRouter } from "next/navigation";
import type { Payment as PaymentEntity } from "@/lib/types/entities";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import { useMemo, useRef, useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { DetailPageSkeleton } from "@/components/detail-page-skeleton";
import { StatusTag } from "@/components/status-tag";
import { useActionCall } from "@/lib/use-action-call";
import { openPrintWindow } from "@/lib/print-client";
import { useUserName } from "@/lib/user-lookup";
import { CurrencyCell, DateTimeCell } from "@/components/table-cells";
import { METHOD_MAP, PAYMENT_STATUS_MAP } from "@/lib/enum-maps";
import { useResponsive } from "@/lib/use-breakpoint";

const DESC_COL = { xs: 1, sm: 1, md: 2, lg: 2, xl: 3 } as const;
const { Text } = Typography;

// 分配明细的可编辑草稿;invoiceId/projectId 至少一个必填(后端会校验)
type AllocationDraft = {
  invoiceId?: string;
  projectId?: string;
  amount: number;
  remark?: string;
};

const REALLOCATABLE = ["PLANNED", "CONFIRMED"];
const LOCKED = ["RECONCILED", "REFUNDED", "CANCELLED"];

export default function PaymentDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { isMobile } = useResponsive();
  const { data: session } = useSession();
  const { data, isLoading, mutate } = useSWR<PaymentEntity>(`/api/payments/${id}`);
  const payment = data;
  const { message } = App.useApp();
  // 弹窗里要回传的值用 ref,避免 Modal.confirm 静态 onOk 拿不到新值
  // (antd 的静态 Modal 不会随父组件重渲染,onOk 捕获的是点击触发时的旧闭包)
  const bankRefNoRef = useRef("");
  const reasonRef = useRef("");

  // 重分配 Modal
  const [reallocOpen, setReallocOpen] = useState(false);
  const [form] = Form.useForm<{ rows: AllocationDraft[] }>();
  // 只在 Modal 打开时拉下拉数据,关掉就停(sWR key 传 null)
  const { data: invoicesResp } = useSWR<{ list: { id: string; invoiceNo: string; amount: string }[] }>(
    reallocOpen && payment ? `/api/invoices?contractId=${payment.contractId}&pageSize=100` : null
  );
  const { data: projectsResp } = useSWR<{ list: { id: string; projectNo: string; name: string }[] }>(
    reallocOpen && payment ? `/api/projects?contractId=${payment.contractId}&pageSize=100` : null
  );
  const invoiceOptions = useMemo(
    () => (invoicesResp?.list ?? []).map((i) => ({ value: i.id, label: `${i.invoiceNo} · ¥${i.amount}` })),
    [invoicesResp]
  );
  const projectOptions = useMemo(
    () => (projectsResp?.list ?? []).map((p) => ({ value: p.id, label: `${p.projectNo} · ${p.name}` })),
    [projectsResp]
  );

  const { run } = useActionCall({ baseUrl: `/api/payments/${id}`, reload: () => mutate() });
  // 后端存的是 userId,前端要展示姓名;查不到时 fallback 到原 id
  const recorderName = useUserName(payment?.recorderUserId ?? null, "—");
  const reconcileName = useUserName(payment?.reconcileUserId ?? null, "—");

  if (isLoading || !payment) {
    return (
      <Page>
        <PageHeader back={() => router.push("/payments")} title="回款详情" />
        <DetailPageSkeleton />
      </Page>
    );
  }
  const roleCode = session?.user?.roleCode;
  const isFinance = roleCode === "FINANCE" || roleCode === "ADMIN";
  const status = payment.status;
  const isOwner = payment.recorderUserId === session?.user?.id;
  const canReallocate = REALLOCATABLE.includes(status) && (isFinance || isOwner);
  const isLocked = LOCKED.includes(status);

  const askConfirm = () => {
    bankRefNoRef.current = "";
    Modal.confirm({
      title: "确认回款(财务)",
      content: (
        <Input
          autoFocus
          placeholder="银行流水号(必填)"
          onChange={(e) => { bankRefNoRef.current = e.target.value; }}
          onPressEnter={async (e) => {
            // 回车直接提交,避开鼠标点 OK 时漏改 state 的问题
            e.preventDefault();
            const ref = bankRefNoRef.current.trim();
            if (!ref) return;
            await run("confirm", { bankRefNo: ref });
            bankRefNoRef.current = "";
            Modal.destroyAll();
          }}
        />
      ),
      onOk: async () => {
        const ref = bankRefNoRef.current.trim();
        if (!ref) { Modal.destroyAll(); return; }
        await run("confirm", { bankRefNo: ref });
        bankRefNoRef.current = "";
      }
    });
  };
  const askRefund = () => {
    reasonRef.current = "";
    Modal.confirm({
      title: "退款(财务)",
      content: (
        <Input.TextArea
          rows={2}
          placeholder="退款原因"
          onChange={(e) => { reasonRef.current = e.target.value; }}
        />
      ),
      onOk: async () => {
        await run("refund", { reason: reasonRef.current });
        reasonRef.current = "";
      }
    });
  };

  const openReallocate = () => {
    // 用当前明细做默认值,如果是空就给一行空模板
    const rows = (payment.allocations ?? []).map((a) => ({
      invoiceId: a.invoiceId || undefined,
      projectId: a.projectId || undefined,
      amount: Number(a.amount),
      remark: a.remark || undefined
    }));
    form.setFieldsValue({ rows: rows.length > 0 ? rows : [{ amount: Number(payment.amount) }] });
    setReallocOpen(true);
  };

  const submitReallocate = async () => {
    try {
      const v = await form.validateFields();
      const rows = v.rows ?? [];
      if (rows.length === 0) {
        message.error("请至少添加一条分配");
        return;
      }
      const sum = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const paymentAmt = Number(payment.amount);
      if (Math.abs(sum - paymentAmt) > 0.01) {
        message.error(`分配合计 ¥${sum.toFixed(2)} 与回款金额 ¥${paymentAmt.toFixed(2)} 不一致`);
        return;
      }
      const ok = await run("allocate", { allocations: rows });
      if (ok) setReallocOpen(false);
    } catch {
      // Form.validateFields 已自带错误提示
    }
  };

  return (
    <Page>
      <PageHeader
        back={() => router.push("/payments")}
        title={`回款 ${payment.paymentNo}`}
        subtitle={`到账日: ${payment.receivedAt ? new Date(payment.receivedAt).toLocaleString("zh-CN") : "-"}`}
        meta={<StatusTag status={payment.status} domain="payment" />}
        actions={
          <Space wrap>
            <Button key="pdf" icon={<FilePdfOutlined />} onClick={() => openPrintWindow(`/api/payments/${id}/pdf`)}>导出 PDF</Button>
            {canReallocate && (
              <Button key="realloc" icon={<EditOutlined />} onClick={openReallocate}>重分配</Button>
            )}
            {status === "PLANNED" && <Button type="primary" onClick={askConfirm} disabled={!isFinance}>财务确认</Button>}
            {status === "CONFIRMED" && isFinance && (
              <>
                <Button onClick={() => run("reconcile")}>对账</Button>
                <Button danger onClick={askRefund}>退款</Button>
              </>
            )}
            {status === "PLANNED" && <Button danger onClick={() => run("cancel")}>取消</Button>}
          </Space>
        }
      />
      <ProCard>
        <ProDescriptions column={DESC_COL} dataSource={payment} columns={[
          { title: "回款号", dataIndex: "paymentNo" },
          { title: "金额", dataIndex: "amount", render: (v) => <CurrencyCell value={v as string} /> },
          { title: "方式", dataIndex: "method", render: (v) => METHOD_MAP[v as string] ?? v },
          { title: "到账日", dataIndex: "receivedAt", render: (v) => <DateTimeCell value={v as string} /> },
          { title: "银行流水号", dataIndex: "bankRefNo" },
          { title: "收款行", dataIndex: "bankName" },
          { title: "登记人", dataIndex: "recorderUserId", render: () => recorderName },
          { title: "对账人", dataIndex: "reconcileUserId", render: () => reconcileName },
          { title: "对账时间", dataIndex: "reconciledAt", render: (v) => <DateTimeCell value={v as string} /> },
          { title: "备注", dataIndex: "remark" }
        ]} />
      </ProCard>
      {payment.invoice && (
        <>
          <PageHeader level="section" title="关联发票" />
          <ProCard>
            <ProDescriptions column={DESC_COL} dataSource={payment.invoice} columns={[
              { title: "发票号", dataIndex: "invoiceNo" },
              { title: "金额", dataIndex: "amount", render: (v) => <CurrencyCell value={v as string} /> }
            ]} />
          </ProCard>
        </>
      )}
      <PageHeader level="section" title="分配明细" />
      {isLocked ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title="分配明细已锁定"
          description="该回款已对账/退款/取消,分配明细不可再修改;如需调整,请走退款或冲账流程。所有修改会记入审计日志。"
        />
      ) : (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title={`分配明细仅在 ${PAYMENT_STATUS_MAP.PLANNED ?? "PLANNED"} / ${PAYMENT_STATUS_MAP.CONFIRMED ?? "CONFIRMED"} 状态可调整`}
          description="对账(RECONCILED)后系统将自动锁定,不再允许修改分配。可通过页面右上角「重分配」按钮调整。"
        />
      )}
      <ProCard>
        <ProTable rowKey="id" search={false} options={false} pagination={{ defaultPageSize: isMobile ? 5 : 10, size: isMobile ? "small" : undefined }} dataSource={payment.allocations ?? []}
          scroll={{ x: 'max-content' }}
          sticky={isMobile}
          columns={[
            {
              title: "发票编号",
              dataIndex: "invoiceNo",
              render: (_: unknown, r: PaymentEntity["allocations"][number]) =>
                r.invoiceNo ? <span>{r.invoiceNo}</span> : <Text type="secondary">{r.invoiceId || "—"}</Text>
            },
            {
              title: "项目",
              dataIndex: "projectNo",
              render: (_: unknown, r: PaymentEntity["allocations"][number]) =>
                r.projectNo ? (
                  <Space orientation="vertical" size={0}>
                    <span>{r.projectNo}</span>
                    {r.projectName && <Text type="secondary" style={{ fontSize: 12 }}>{r.projectName}</Text>}
                  </Space>
                ) : <Text type="secondary">{r.projectId || "—"}</Text>
            },
            { title: "金额", dataIndex: "amount", render: (v) => <CurrencyCell value={v as string} /> },
            { title: "备注", dataIndex: "remark" }
          ]} />
      </ProCard>

      <Modal
        title="重分配明细"
        open={reallocOpen}
        onCancel={() => setReallocOpen(false)}
        onOk={submitReallocate}
        okText="保存"
        cancelText="取消"
        width={760}
        destroyOnHidden
        confirmLoading={false}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title={`分配合计必须等于回款金额 ¥${Number(payment.amount).toFixed(2)}`}
          description="可删除、修改或新增行,保存后会覆盖当前分配;修改会记入审计日志。"
        />
        <Form form={form} layout="vertical" preserve={false}>
          <Form.List name="rows">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...rest }) => (
                  <div
                    key={key}
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "flex-start",
                      marginBottom: 8,
                      padding: 8,
                      border: "1px solid #f0f0f0",
                      borderRadius: 6,
                      background: "#fafafa"
                    }}
                  >
                    <Form.Item {...rest} name={[name, "invoiceId"]} style={{ flex: 1, marginBottom: 0 }}>
                      <Select
                        placeholder="发票编号(可选)"
                        allowClear
                        options={invoiceOptions}
                        showSearch
                        optionFilterProp="label"
                      />
                    </Form.Item>
                    <Form.Item {...rest} name={[name, "projectId"]} style={{ flex: 1, marginBottom: 0 }}>
                      <Select
                        placeholder="项目编号(可选)"
                        allowClear
                        options={projectOptions}
                        showSearch
                        optionFilterProp="label"
                      />
                    </Form.Item>
                    <Form.Item
                      {...rest}
                      name={[name, "amount"]}
                      rules={[{ required: true, message: "请输入金额" }]}
                      style={{ width: 140, marginBottom: 0 }}
                    >
                      <InputNumber placeholder="金额" min={0} precision={2} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item {...rest} name={[name, "remark"]} style={{ flex: 1, marginBottom: 0 }}>
                      <Input placeholder="备注" />
                    </Form.Item>
                    <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(name)} title="删除该行" />
                  </div>
                ))}
                <Button type="dashed" onClick={() => add({ amount: 0 })} block icon={<PlusOutlined />}>
                  添加一行
                </Button>
              </>
            )}
          </Form.List>
          <Form.Item shouldUpdate noStyle>
            {() => {
              const rows: AllocationDraft[] = form.getFieldValue("rows") || [];
              const sum = rows.reduce((s, r) => s + (Number(r?.amount) || 0), 0);
              const diff = sum - Number(payment.amount);
              const ok = Math.abs(diff) < 0.01;
              return (
                <div
                  style={{
                    marginTop: 12,
                    padding: "8px 12px",
                    background: ok ? "#f6ffed" : "#fff2f0",
                    border: `1px solid ${ok ? "#b7eb8f" : "#ffccc7"}`,
                    borderRadius: 6,
                    fontSize: 13
                  }}
                >
                  分配合计: <b>¥{sum.toFixed(2)}</b> / 需 ¥{Number(payment.amount).toFixed(2)}
                  {ok ? (
                    <span style={{ color: "#389e0d", marginLeft: 8 }}>匹配,可保存</span>
                  ) : (
                    <span style={{ color: "#cf1322", marginLeft: 8 }}>差额 ¥{diff.toFixed(2)}</span>
                  )}
                </div>
              );
            }}
          </Form.Item>
        </Form>
      </Modal>
    </Page>
  );
}
