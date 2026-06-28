import { notFound } from "next/navigation";
import Link from "next/link";
import { Button, Space, Tag, Typography } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/session";
import { getAnnouncement } from "@/server/services/announcement";
import { ROLE_LABEL } from "@/lib/status";
import { DateTimeCell } from "@/components/table-cells";
import { getT } from "@/lib/i18n";

const { Paragraph, Text } = Typography;

type Params = { id: string };

export default async function AnnouncementDetailPage({ params }: { params: Promise<Params> }) {
  const t = getT("zh-CN");
  const { id } = await params;
  const user = await requireSession();
  const a = await getAnnouncement(user, id).catch(() => null);
  if (!a) notFound();

  return (
    <Page>
      <PageHeader
        title={t("announcements.detail.title")}
        actions={
          <Link href="/announcements">
            <Button icon={<ArrowLeftOutlined />}>{t("announcements.back")}</Button>
          </Link>
        }
      />
      <div style={{ maxWidth: 720 }}>
        <Space style={{ marginBottom: 12 }} wrap>
          {a.pinned && <Tag color="red">{t("announcements.tag.pinned")}</Tag>}
          {a.targetRoles.length === 0 ? (
            <Tag>{t("announcements.recipients.all")}</Tag>
          ) : (
            a.targetRoles.map((r) => <Tag key={r}>{ROLE_LABEL[r] ?? r}</Tag>)
          )}
          <Text type="secondary">
            {t("announcements.detail.publishAt")}：<DateTimeCell value={a.publishAt.toISOString()} />
          </Text>
        </Space>
        <Typography.Title level={4}>{a.title}</Typography.Title>
        <Paragraph style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{a.content}</Paragraph>
      </div>
    </Page>
  );
}
