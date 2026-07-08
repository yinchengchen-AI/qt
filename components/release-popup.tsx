
"use client";

// 登录后弹窗:展示 AppRelease 内容。
//
// 触发:由 DashboardShell 在 mount 时调 /api/app-releases/latest,
// 拿到 release 后置 open=true。
//
// 视觉:
//   - 重要更新 (important=true) → 顶部彩色 banner,文案强调
//   - 普通更新 → 浅色头 + 默认 modal
//   - 内容:纯文本/Markdown 浅渲染 (whiteSpace: pre-wrap, 不做 HTML 解析;防 XSS)
//
// 交互:
//   - "已了解" → POST /api/app-releases/{id}/read → 关弹窗
//   - "查看完整更新记录" → 跳 /releases
//   - 用户点关闭 (X) → 等价于已了解;不强制读(允许跳过)

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Modal, Space, Tag, Typography, theme } from "antd";
import { useResponsive } from "@/lib/use-breakpoint";
import { useT } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format";

const { Text, Title } = Typography;

export type ReleasePopupData = {
  id: string;
  version: string;
  title: string;
  summary: string;
  content: string;
  important: boolean;
  publishedAt: string;
};

type Props = {
  release: ReleasePopupData | null;
  open: boolean;
  /**
   * 关闭回调:父组件在内部打 /read 接口 + 清本地状态。
   * 弹窗本身只触发 onClose,不直接打 API,避免双 POST。
   * 异步进行中通过 submitting 状态显示 loading。
   */
  onClose: () => void | Promise<void>;
};

export function ReleasePopup({ release, open, onClose }: Props) {
  const t = useT();
  const router = useRouter();
  const { token } = theme.useToken();
  const { isMobile } = useResponsive();
  const [submitting, setSubmitting] = useState(false);

  if (!release) return null;

  // 关闭:让父组件去打 /read,这里只置 submitting 防止重复触发
  const handleClose = () => {
    if (submitting) return;
    setSubmitting(true);
    void Promise.resolve(onClose()).finally(() => setSubmitting(false));
  };

  // 查看完整记录:先关闭(标记已读)再跳,避免在 /releases 页再次弹窗
  const goHistory = () => {
    if (submitting) return;
    setSubmitting(true);
    void Promise.resolve(onClose())
      .catch(() => {})
      .finally(() => {
        setSubmitting(false);
        router.push("/releases");
      });
  };

  const headerColor = release.important ? token.colorError : token.colorPrimary;
  const headerLabel = release.important
    ? t("release.popup.importantLabel")
    : t("release.popup.newVersionLabel");

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      width={isMobile ? "100%" : 560}
      centered
      destroyOnClose
      maskClosable={!release.important}
      // 重要更新不点遮罩关闭:防止误触;普通更新允许
      footer={
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Button type="link" onClick={goHistory} style={{ paddingLeft: 0 }} disabled={submitting}>
            {t("release.popup.viewHistory")} →
          </Button>
          <Button type="primary" loading={submitting} onClick={handleClose}>
            {t("release.popup.gotIt")}
          </Button>
        </Space>
      }
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Tag color={headerColor} style={{ marginRight: 0 }}>
            {headerLabel}
          </Tag>
          <Text strong style={{ fontSize: 13, color: token.colorTextSecondary }}>
            {release.version}
          </Text>
        </div>
      }
      styles={{
        body: { paddingTop: 8, paddingBottom: 4 }
      }}
    >
      <div
        style={{
          padding: "8px 0 4px"
        }}
      >
        <Title
          level={4}
          style={{
            margin: 0,
            marginBottom: 8,
            lineHeight: 1.4,
            wordBreak: "break-word"
          }}
        >
          {release.title}
        </Title>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t("release.popup.publishedAt")}:{" "}
          {formatDateTime(release.publishedAt)}
        </Text>
      </div>

      <div
        style={{
          background: token.colorFillTertiary,
          borderLeft: `3px solid ${headerColor}`,
          padding: "10px 12px",
          borderRadius: 4,
          fontSize: 13,
          lineHeight: 1.7,
          marginBottom: 12,
          color: token.colorTextSecondary
        }}
      >
        {release.summary}
      </div>

      <div
        style={{
          maxHeight: isMobile ? "50vh" : 320,
          overflowY: "auto",
          fontSize: 13,
          lineHeight: 1.8,
          color: token.colorText,
          // 关键:白名单渲染策略 — 用 whiteSpace: pre-wrap 保留 \n 换行,
          // 不解析 HTML/Markdown;Prisma content 是 VARCHAR,无脚本注入风险。
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          paddingRight: 4
        }}
      >
        {release.content}
      </div>
    </Modal>
  );
}
