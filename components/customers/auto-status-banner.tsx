"use client";

import { useMemo, useState } from "react";
import { App as AntdApp, Button, Input, Modal, Space } from "antd";
import { InfoBox } from "@/components/callout";
import { getRuleLabel } from "@/lib/customer-auto-rules";
import { isCustomerStatus } from "@/lib/customer-status-transitions";

// 5 个客户状态的中文 label. 与 app/(app)/customers/[id]/page.tsx 的本地 STATUS_LABEL
// 以及 server/events/bus.ts 的 CUSTOMER_STATUS_LABEL 保持一致; 加新状态时三处同步.
const CUSTOMER_STATUS_LABEL: Record<string, string> = {
  LEAD: "线索",
  NEGOTIATING: "洽谈中",
  SIGNED: "已签约",
  LOST: "已流失",
  FROZEN: "已冻结"
};

const MS_PER_DAY = 86_400_000;

/**
 * 详情页横幅 — 当客户最近 N 天内被系统自动改过状态时显示, 给出撤销入口.
 *
 * 数据来源: SWR `/api/customers/${id}` 返回的 lastAutoAppliedAt + lastAutoRule (本组件
 * 只读自己关心的两个字段, 通过 props 注入, 不耦合 fetch 细节).
 *
 * 关闭条件:
 *   - lastAutoAppliedAt 为空 (系统从未自动写过 / 已被人工撤销 / 撤销窗口已过)
 *   - 距 lastAutoAppliedAt 已超过 disputeDays 天 (默认 7, 服务端为 source of truth)
 *
 * 撤销流程:
 *   1) 点击「撤销」→ 弹 antd Modal 收 reason (5-200 字, 必填)
 *   2) POST /api/customers/${customerId}/revert (revertCustomerStatus)
 *      失败时 antd message 提示; 成功 → onReverted() 让父组件重拉数据
 *   3) 成功后横幅自动消失 (lastAutoAppliedAt 在 revertCustomerStatus 里被清空)
 */
export function AutoStatusBanner(props: {
  customerId: string;
  /** ISO 字符串, 与 SWR 返回一致; null/undefined 时整条横幅不渲染 */
  lastAutoAppliedAt: string | null | undefined;
  lastAutoRule: string | null | undefined;
  currentStatus: string;
  /** 默认 7, 与服务端 env CUSTOMER_AUTO_DISPUTE_DAYS 默认一致 */
  disputeDays?: number;
  onReverted: () => void;
}) {
  const { customerId, lastAutoAppliedAt, lastAutoRule, currentStatus, onReverted } = props;
  const disputeDays = props.disputeDays ?? 7;
  const { message } = AntdApp.useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 计算相对时间 + 是否还在撤销窗口内. 这里纯前端展示用, 服务端 revertCustomerStatus
  // 还会再用 env.CUSTOMER_AUTO_DISPUTE_DAYS 校验一次, 真正的 source of truth 在后端.
  const inWindow = useMemo(() => {
    if (!lastAutoAppliedAt) return false;
    const t = Date.parse(lastAutoAppliedAt);
    if (Number.isNaN(t)) return false;
    return Date.now() - t <= disputeDays * MS_PER_DAY;
  }, [lastAutoAppliedAt, disputeDays]);

  if (!lastAutoAppliedAt || !lastAutoRule || !inWindow) return null;

  const ruleLabel = getRuleLabel(lastAutoRule);
  const statusLabel = isCustomerStatus(currentStatus)
    ? CUSTOMER_STATUS_LABEL[currentStatus] ?? currentStatus
    : currentStatus;
  const relativeTime = formatRelativeTime(lastAutoAppliedAt);

  const reasonTrimmed = reason.trim();
  const reasonValid = reasonTrimmed.length >= 5 && reasonTrimmed.length <= 200;

  const openModal = () => {
    setReason("");
    setModalOpen(true);
  };
  const closeModal = () => {
    if (submitting) return;
    setModalOpen(false);
  };

  const submit = async () => {
    if (!reasonValid) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/customers/${customerId}/revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: reasonTrimmed })
      });
      const json = (await res.json().catch(() => null)) as { code?: number; message?: string } | null;
      if (!res.ok || !json || json.code !== 0) {
        message.error(json?.message ?? `撤销失败 (HTTP ${res.status})`);
        return;
      }
      message.success("已撤销, 客户状态已回退");
      setModalOpen(false);
      onReverted();
    } catch (e) {
      message.error((e as Error).message ?? "网络异常");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div style={{ marginTop: 12, marginBottom: 12 }}>
        <InfoBox
          title="系统已自动变更状态"
          action={
            <Button size="small" onClick={openModal} data-testid="auto-status-revert-trigger">
              撤销
            </Button>
          }
        >
          系统于 <strong>{relativeTime}</strong> 根据「{ruleLabel}」自动将状态变更为{" "}
          <strong>{statusLabel}</strong>。{" "}
          {disputeDays} 天内可撤销, 撤销需填写原因 (5-200 字)。
        </InfoBox>
      </div>
      <Modal
        title="撤销系统自动变更"
        open={modalOpen}
        onCancel={closeModal}
        okButtonProps={{ disabled: !reasonValid, loading: submitting }}
        onOk={submit}
        okText="确认撤销"
        cancelText="取消"
        destroyOnClose
        maskClosable={!submitting}
      >
        <p style={{ marginTop: 0, color: "var(--qt-text-muted)" }}>
          撤销后, 客户状态将从「{statusLabel}」回退到系统改之前的状态。
        </p>
        <Space direction="vertical" size={4} style={{ width: "100%" }}>
          <span>撤销原因 <span style={{ color: "var(--qt-text-error)" }}>*</span></span>
          <Input.TextArea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例如: 该客户还有 1 份未到期的试用期合同, 不应被自动冻结"
            autoSize={{ minRows: 3, maxRows: 6 }}
            maxLength={200}
            showCount
            data-testid="auto-status-revert-reason"
          />
          {!reasonValid && reason.length > 0 && (
            <span style={{ color: "var(--qt-text-error)", fontSize: 12 }}>
              撤销理由需 5-200 字
            </span>
          )}
        </Space>
      </Modal>
    </>
  );
}

/**
 * 简易相对时间格式化 (避免拉 dayjs). 输出形如:
 *   "刚刚" / "3 分钟前" / "2 小时前" / "昨天" / "3 天前"
 *
 * 仅作展示用, 严格场景 (审计 / 时区) 用 ISO + 服务端格式化.
 */
function formatRelativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  if (diff < 0) return "刚刚";
  if (diff < 60_000) return "刚刚";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(diff / MS_PER_DAY);
  if (days === 1) return "昨天";
  return `${days} 天前`;
}
