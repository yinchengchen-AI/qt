"use client";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import {
  ProForm,
  ProFormText,
  ProFormTextArea,
  ProFormSelect,
  ProFormDateRangePicker,
  ProFormSwitch
} from "@ant-design/pro-components";
import { App as AntdApp, Button, Space, Tag, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { ROLE_LABEL } from "@/lib/status";
import { useListRequest } from "@/lib/use-list-request";
import { DateTimeCell } from "@/components/table-cells";
import { FormCard, FormSection, FormGrid } from "@/components/form";

const { Text, Paragraph } = Typography;

type Announcement = {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  targetRoles: string[];
  publishUserId: string;
  publishAt: string;
};

const TARGET_ROLE_OPTIONS = [
  { value: "ADMIN", label: ROLE_LABEL.ADMIN },
  { value: "SALES", label: ROLE_LABEL.SALES },
  { value: "FINANCE", label: ROLE_LABEL.FINANCE },
  { value: "OPS", label: ROLE_LABEL.OPS }
];

export default function AnnouncementsPage() {
  const { data, total, loading, reload } = useListRequest<Announcement>("/api/announcements");
  const [modalOpen, setModalOpen] = useState(false);
  const [detail, setDetail] = useState<Announcement | null>(null);
  const { message } = AntdApp.useApp();

  const columns: ProColumns<Announcement>[] = [
    {
      title: "标题",
      dataIndex: "title",
      width: 280,
      render: (_, r) => (
        <Space>
          {r.pinned && <Tag color="red">置顶</Tag>}
          <a onClick={() => setDetail(r)}>{r.title}</a>
        </Space>
      )
    },
    {
      title: "接收人",
      dataIndex: "targetRoles",
      width: 180,
      render: (v) => {
        const arr = (Array.isArray(v) ? v : []) as string[];
        if (arr.length === 0) return <Tag>全员</Tag>;
        return (
          <Space size={4} wrap>
            {arr.map((r) => (
              <Tag key={r} color="blue">
                {ROLE_LABEL[r as keyof typeof ROLE_LABEL] ?? r}
              </Tag>
            ))}
          </Space>
        );
      }
    },
    {
      title: "生效期",
      dataIndex: "effectiveFrom",
      width: 240,
      render: (_, r) =>
        `${r.effectiveFrom ? new Date(r.effectiveFrom).toLocaleDateString("zh-CN") : "—"} ~ ${r.effectiveTo ? new Date(r.effectiveTo).toLocaleDateString("zh-CN") : "长期"}`
    },
    {
      title: "发布时间",
      dataIndex: "publishAt",
      width: 180,
      render: (_, r) => <DateTimeCell value={r.publishAt} />
    }
  ];

  return (
    <Page>
      <PageHeader
        title="公告"
        subtitle="发布全员或指定角色可见的公告,支持置顶与生效期"
        actions={
          <Button key="add" type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
            发布公告
          </Button>
        }
      />
      <ProTable<Announcement>
        rowKey="id"
        search={false}
        loading={loading}
        pagination={{ pageSize: 20, total, onChange: () => reload() }}
        dataSource={data}
        cardBordered={false}
        columns={columns}
      />

      {/* 发布 modal 用 ProForm 统一风格 */}
      {modalOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1100,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
          onClick={() => setModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 720, maxWidth: "92vw", maxHeight: "90vh", overflow: "auto" }}
          >
            <FormCard headerHint="置顶的公告会钉在用户消息中心顶部;生效期不填表示长期有效;接收角色留空表示全员">
              <ProForm
                layout="vertical"
                submitter={false}
                onFinish={async (values) => {
                  const range = values.effectiveRange as
                    | [unknown?, unknown?]
                    | undefined;
                  const body = {
                    title: values.title,
                    content: values.content,
                    pinned: values.pinned ?? false,
                    effectiveFrom: range?.[0]
                      ? new Date(range[0] as string | number | Date).toISOString()
                      : undefined,
                    effectiveTo: range?.[1]
                      ? new Date(range[1] as string | number | Date).toISOString()
                      : undefined,
                    targetRoles: values.targetRoles ?? []
                  };
                  const r = await fetch("/api/announcements", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify(body)
                  });
                  const j = await r.json();
                  if (j.code === 0) {
                    message.success("已发布");
                    setModalOpen(false);
                    reload();
                    return true;
                  }
                  message.error(j.message);
                  return false;
                }}
              >
                <FormSection title="公告内容">
                  <FormGrid columns={1}>
                    <ProFormText
                      name="title"
                      label="标题"
                      placeholder="如:2026 年春节放假安排"
                      rules={[
                        { required: true, min: 2, max: 200, message: "2-200 字符" }
                      ]}
                      fieldProps={{ size: "large", maxLength: 200, showCount: true }}
                    />
                    <ProFormTextArea
                      name="content"
                      label="正文"
                      placeholder="详细说明..."
                      rules={[{ required: true, min: 1, max: 10000 }]}
                      fieldProps={{
                        size: "large",
                        rows: 6,
                        maxLength: 10000,
                        showCount: true
                      }}
                    />
                  </FormGrid>
                </FormSection>

                <FormSection title="发布选项">
                  <FormGrid columns={2}>
                    <ProFormSwitch
                      name="pinned"
                      label="置顶"
                      tooltip="置顶公告在所有公告列表最上方"
                    />
                    <ProFormSelect
                      name="targetRoles"
                      label="接收角色"
                      placeholder="留空表示全员"
                      options={TARGET_ROLE_OPTIONS}
                      mode="multiple"
                      fieldProps={{ size: "large", allowClear: true }}
                    />
                    <ProFormDateRangePicker
                      name="effectiveRange"
                      label="生效期"
                      fieldProps={{ size: "large", style: { width: "100%" } }}
                    />
                  </FormGrid>
                </FormSection>

                <Space style={{ marginTop: 16 }}>
                  <Button onClick={() => setModalOpen(false)}>取消</Button>
                  <Button
                    type="primary"
                    onClick={() =>
                      (document.querySelector("form.ant-form") as HTMLFormElement | null)?.dispatchEvent(
                        new Event("submit", { cancelable: true, bubbles: true })
                      )
                    }
                  >
                    发布
                  </Button>
                </Space>
              </ProForm>
            </FormCard>
          </div>
        </div>
      ) : null}

      {detail ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1100,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
          onClick={() => setDetail(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 720, maxWidth: "92vw", maxHeight: "90vh", overflow: "auto" }}
          >
            <FormCard>
              <Space style={{ marginBottom: 12 }}>
                {detail.pinned && <Tag color="red">置顶</Tag>}
                {detail.targetRoles.length === 0 ? (
                  <Tag>全员</Tag>
                ) : (
                  detail.targetRoles.map((r) => <Tag key={r}>{ROLE_LABEL[r as keyof typeof ROLE_LABEL] ?? r}</Tag>)
                )}
                <Text type="secondary">{new Date(detail.publishAt).toLocaleString("zh-CN")}</Text>
              </Space>
              <Paragraph style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{detail.content}</Paragraph>
              <Button onClick={() => setDetail(null)}>关闭</Button>
            </FormCard>
          </div>
        </div>
      ) : null}
    </Page>
  );
}
