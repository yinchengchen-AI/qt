"use client";
import { ProCard, ProDescriptions } from "@ant-design/pro-components";
import { App, Button, Input, Modal, Space } from "antd";
import { FilePdfOutlined } from "@ant-design/icons";
import { useParams, useRouter } from "next/navigation";
import type { Payment as PaymentEntity } from "@/lib/types/entities";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import { useRef } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { DetailPageSkeleton } from "@/components/detail-page-skeleton";
import { StatusTag } from "@/components/status-tag";
import { useActionCall } from "@/lib/use-action-call";
import { openPrintWindow } from "@/lib/print-client";
import { useUserName } from "@/lib/user-lookup";
import { CurrencyCell, DateTimeCell } from "@/components/table-cells";
import { METHOD_MAP } from "@/lib/enum-maps";
import { useResponsive } from "@/lib/use-breakpoint";

const DESC_COL = { xs: 1, sm: 1, md: 2, lg: 2, xl: 3 } as const;

export default function PaymentDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { isMobile: _isMobile } = useResponsive();
  const { data: session } = useSession();
  const { data, isLoading, mutate } = useSWR<PaymentEntity>(`/api/payments/${id}`);
  const payment = data;
  const { message: _message } = App.useApp();
  // 弹窗里要回传的值用 ref,避免 Modal.confirm 静态 onOk 拿不到新值
  // (antd 的静态 Modal 不会随父组件重渲染,onOk 捕获的是点击触发时的旧闭包)
  const bankRefNoRef = useRef("");
  const reasonRef = useRef("");

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
  const userId = session?.user?.id;
  const isFinance = roleCode === "FINANCE" || roleCode === "ADMIN";
  const status = payment.status;
  const canCancel = status === "PLANNED" && (payment.recorderUserId === userId || roleCode === "ADMIN" || roleCode === "FINANCE");

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
            {status === "PLANNED" && <Button type="primary" onClick={askConfirm} disabled={!isFinance}>财务确认</Button>}
            {status === "CONFIRMED" && isFinance && (
              <>
                <Button onClick={() => run("reconcile")}>对账</Button>
                <Button danger onClick={askRefund}>退款</Button>
              </>
            )}
            {canCancel && <Button danger onClick={() => run("cancel")}>取消</Button>}
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
      <PageHeader level="section" title="关联合同" />
      <ProCard>
        {payment.contract ? (
          <ProDescriptions column={DESC_COL} dataSource={payment.contract} columns={[
            { title: "合同号", dataIndex: "contractNo" },
            { title: "合同标题", dataIndex: "title" },
            { title: "客户", dataIndex: "customerName" },
            { title: "服务类型", dataIndex: "serviceType", render: (v: unknown) => (v as string) || "—" },
            { title: "合同总额", dataIndex: "totalAmount", render: (v: unknown) => v ? <CurrencyCell value={v as string} /> : "—" },
            { title: "付款方式", dataIndex: "paymentMethod", render: (v: unknown) => (v as string) || "—" },
            { title: "签订日", dataIndex: "signDate", render: (v: unknown) => v ? <DateTimeCell value={v as string} /> : "—" },
            { title: "合同状态", dataIndex: "status", render: (v: unknown) => v ? <StatusTag status={v as string} domain="contract" /> : "—" }
          ]} />
        ) : (
          <div style={{ color: "var(--qt-text-disabled)", padding: "12px 0" }}>—</div>
        )}
      </ProCard>
    </Page>
  );
}
