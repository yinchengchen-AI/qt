"use client";
// 应用更新记录:全登录用户可读的时间线视图。
// - 默认按 publishedAt 倒序展示所有 release(分页)
// - 改用 antd Timeline 组件:每条 release 作为时间线上的一个节点
//   left 节点显示发布日期 + version tag + important 红点 / fromGit badge
//   right 内容显示 title + summary;展开/收起显示完整 content
// - 顶部"未读 N 条"小提示:从 /api/app-releases/latest 取 totalRead/totalPublished
//   计算差值,但不强制弹窗(用户已经在更新记录页了)
import { useEffect, useState } from "react";
import {
  App as AntdApp,
  Empty,
  Tag,
  Typography,
  Space,
  Button,
  Spin,
  Timeline
} from "antd";
import {
  ClockCircleOutlined,
  ExclamationCircleFilled,
  BranchesOutlined
} from "@ant-design/icons";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { useResponsive } from "@/lib/use-breakpoint";
import { useT } from "@/lib/i18n";
import { formatDateTime, formatDate } from "@/lib/format";

const { Text, Paragraph } = Typography;

type AppRelease = {
  id: string;
  version: string;
  title: string;
  summary: string;
  content: string;
  important: boolean;
  publishedAt: string;
  // m-6: history 页展示 自动生成 · N 条 badge
  source?: "MANUAL" | "GIT_COMMITS";
  gitCommitCount?: number | null;
};

export default function ReleasesPage() {
  const t = useT();
  const { message } = AntdApp.useApp();
  const { isMobile } = useResponsive();
  const [list, setList] = useState<AppRelease[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [unreadCount, setUnreadCount] = useState<number | null>(null);

  const load = async (p: number) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/app-releases?page=${p}&pageSize=${pageSize}`, {
        credentials: "include"
      });
      const j = await r.json();
      if (j.code === 0) {
        setList(j.data.list);
        setTotal(j.data.total);
        setPage(p);
      } else {
        message.error(j.message);
      }
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // 取一次"未读统计":辅助顶部提示
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/app-releases/latest", { credentials: "include" });
        const j = await r.json();
        if (j.code === 0) {
          const { totalPublished, totalRead } = j.data ?? {};
          if (typeof totalPublished === "number" && typeof totalRead === "number") {
            setUnreadCount(Math.max(0, totalPublished - totalRead));
          }
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Page>
      <PageHeader
        title={t("releases.history.title")}
        subtitle={t("releases.history.subtitle")}
      />
      {unreadCount !== null && unreadCount > 0 ? (
        <div
          style={{
            marginBottom: 16,
            padding: "8px 12px",
            borderRadius: 6,
            background: "var(--ant-color-primary-bg, #e6f4ff)",
            border: "1px solid var(--ant-color-primary-border, #91caff)",
            fontSize: 13
          }}
        >
          {t("releases.history.unreadHint").replace("{n}", String(unreadCount))}
        </div>
      ) : null}

      <Spin spinning={loading}>
        {list.length === 0 ? (
          <Empty description={t("releases.history.empty")} style={{ padding: "48px 0" }} />
        ) : (
          <Timeline
            mode={isMobile ? "left" : "left"}
            items={list.map((r) => {
              const isOpen = expanded.has(r.id);
              // 节点圆点:重要 release 用红圆+感叹号, 自动生成用分支图标, 其他用时钟
              const dot = r.important ? (
                <ExclamationCircleFilled
                  style={{ color: "var(--ant-color-error, #ff4d4f)", fontSize: 16 }}
                />
              ) : r.source === "GIT_COMMITS" ? (
                <BranchesOutlined
                  style={{ color: "var(--ant-color-primary, #1677ff)", fontSize: 14 }}
                />
              ) : (
                <ClockCircleOutlined
                  style={{ color: "var(--ant-color-text-tertiary, #00000040)", fontSize: 14 }}
                />
              );
              return {
                color: r.important ? "red" : r.source === "GIT_COMMITS" ? "blue" : "gray",
                dot,
                children: (
                  <div
                    style={{
                      background: "var(--ant-color-bg-container, #fff)",
                      border: r.important
                        ? "1px solid var(--ant-color-error-border, #ffccc7)"
                        : "1px solid var(--ant-color-border-secondary, #f0f0f0)",
                      borderRadius: 8,
                      padding: isMobile ? "12px" : "14px 18px",
                      marginBottom: 4
                    }}
                  >
                    {/* 节点头:发布日期 + version tag + important / fromGit badge */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                        marginBottom: 6
                      }}
                    >
                      {r.important && (
                        <Tag color="red" style={{ margin: 0 }}>
                          {t("releases.tag.important")}
                        </Tag>
                      )}
                      <Tag
                        color="blue"
                        style={{
                          margin: 0,
                          fontFamily: "ui-monospace, monospace"
                        }}
                      >
                        {r.version}
                      </Tag>
                      {r.source === "GIT_COMMITS" ? (
                        <Tag color="geekblue" style={{ margin: 0, fontSize: 11 }}>
                          {t("releases.tag.fromGit")}
                          {r.gitCommitCount != null ? ` · ${r.gitCommitCount}` : ""}
                        </Tag>
                      ) : null}
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {formatDateTime(r.publishedAt)}
                      </Text>
                    </div>
                    {/* 节点标题 */}
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: r.important ? 600 : 500,
                        lineHeight: 1.4,
                        marginBottom: 4,
                        color: "var(--ant-color-text, rgba(0,0,0,0.88))"
                      }}
                    >
                      {r.title}
                    </div>
                    {/* 摘要 */}
                    <Paragraph
                      type="secondary"
                      style={{ marginBottom: 8, fontSize: 13 }}
                      ellipsis={{ rows: 2, expandable: false }}
                    >
                      {r.summary}
                    </Paragraph>
                    {/* 展开后的完整 content */}
                    {isOpen ? (
                      <div
                        style={{
                          marginTop: 8,
                          padding: "10px 12px",
                          background: "var(--ant-color-fill-tertiary, #f5f5f5)",
                          borderRadius: 4,
                          fontSize: 13,
                          lineHeight: 1.8,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word"
                        }}
                      >
                        {r.content}
                      </div>
                    ) : null}
                    <div style={{ marginTop: 4 }}>
                      <Button
                        type="link"
                        size="small"
                        style={{ paddingLeft: 0 }}
                        onClick={() => toggle(r.id)}
                      >
                        {isOpen
                          ? t("releases.history.collapse")
                          : t("releases.history.expand")}
                      </Button>
                    </div>
                  </div>
                )
              };
            })}
          />
        )}
      </Spin>

      {total > pageSize ? (
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <Space>
            <Button disabled={page <= 1} onClick={() => load(page - 1)}>
              上一页
            </Button>
            <Text type="secondary">
              {page} / {Math.ceil(total / pageSize)}
            </Text>
            <Button
              disabled={page * pageSize >= total}
              onClick={() => load(page + 1)}
            >
              下一页
            </Button>
          </Space>
        </div>
      ) : null}
    </Page>
  );
}