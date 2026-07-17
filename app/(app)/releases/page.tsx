"use client";
// 应用更新记录:登录用户可访问的只读时间线视图。
// 列表 publishedAt 倒序,每条展示 version / title / summary;点开查看完整 content。
// 未读计数在顶部提示,可前往 /api/app-releases/latest 看最新一条。
import { useEffect, useState } from "react";
import { App as AntdApp, Empty, Tag, Typography, Space, Button, Spin } from "antd";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { useT } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format";

const { Text, Paragraph } = Typography;

type AppRelease = {
  id: string;
  version: string;
  title: string;
  summary: string;
  content: string;
  important: boolean;
  publishedAt: string;
};

export default function ReleasesPage() {
  const t = useT();
  const { message } = AntdApp.useApp();
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

  // 顶部"未读 N 条"提示
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
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            {list.map((r) => {
              const isOpen = expanded.has(r.id);
              return (
                <div
                  key={r.id}
                  style={{
                    background: "var(--ant-color-bg-container, #fff)",
                    border: r.important
                      ? "1px solid var(--ant-color-error-border, #ffccc7)"
                      : "1px solid var(--ant-color-border-secondary, #f0f0f0)",
                    borderRadius: 8,
                    padding: "14px 18px"
                  }}
                >
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
                      style={{ margin: 0, fontFamily: "ui-monospace, monospace" }}
                    >
                      {r.version}
                    </Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {formatDateTime(r.publishedAt)}
                    </Text>
                  </div>
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
                  <Paragraph
                    type="secondary"
                    style={{ marginBottom: 8, fontSize: 13 }}
                    ellipsis={{ rows: 2, expandable: false }}
                  >
                    {r.summary}
                  </Paragraph>
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
              );
            })}
          </Space>
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
