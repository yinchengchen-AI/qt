"use client";
import { ProTable } from "@ant-design/pro-components";
import { Tag, Button, Space, Modal, Form, Input, Switch, DatePicker, Select, App as AntdApp, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useState } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { ROLE_LABEL } from "@/lib/status";
import { useListRequest } from "@/lib/use-list-request";
import { DateTimeCell } from "@/components/table-cells";

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

export default function AnnouncementsPage() {
  const { data, total, loading, reload } = useListRequest<Announcement>("/api/announcements");
  const [modalOpen, setModalOpen] = useState(false);
  const [detail, setDetail] = useState<Announcement | null>(null);
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();

  const submit = async () => {
    const v = await form.validateFields();
    const body = {
      title: v.title,
      content: v.content,
      pinned: v.pinned ?? false,
      effectiveFrom: v.effectiveFrom?.[0]?.toISOString(),
      effectiveTo: v.effectiveFrom?.[1]?.toISOString(),
      targetRoles: v.targetRoles ?? []
    };
    const r = await fetch("/api/announcements", { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
    const j = await r.json();
    if (j.code === 0) {
      message.success("已发布");
      setModalOpen(false);
      form.resetFields();
      reload();
    } else message.error(j.message);
  };

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
        columns={[
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
                  {arr.map((r) => <Tag key={r} color="blue">{ROLE_LABEL[r] ?? r}</Tag>)}
                </Space>
              );
            }
          },
          {
            title: "生效期",
            dataIndex: "effectiveFrom",
            width: 240,
            render: (_, r) => `${r.effectiveFrom ? new Date(r.effectiveFrom).toLocaleDateString("zh-CN") : "—"} ~ ${r.effectiveTo ? new Date(r.effectiveTo).toLocaleDateString("zh-CN") : "长期"}`
          },
          {
            title: "发布时间",
            dataIndex: "publishAt",
            width: 180,
            render: (_, r) => <DateTimeCell value={r.publishAt} />
          }
        ]}
      />

      <Modal title="发布公告" open={modalOpen} onCancel={() => setModalOpen(false)} onOk={submit} okText="发布" cancelText="取消" width={680}>
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, min: 2, max: 200 }]}>
            <Input placeholder="公告标题" />
          </Form.Item>
          <Form.Item name="content" label="内容" rules={[{ required: true, min: 1 }]}>
            <Input.TextArea rows={6} placeholder="支持纯文本" />
          </Form.Item>
          <Form.Item name="pinned" label="置顶" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="effectiveFrom" label="生效期">
            <DatePicker.RangePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="targetRoles" label="接收角色" tooltip="留空表示全员">
            <Select mode="multiple" placeholder="默认全员" options={[
              { value: "ADMIN", label: "管理员" },
              { value: "SALES", label: "业务" },
              { value: "FINANCE", label: "财务" },
              { value: "OPS", label: "行政" }
            ]} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={detail?.title} open={!!detail} onCancel={() => setDetail(null)} footer={<Button onClick={() => setDetail(null)}>关闭</Button>} width={680}>
        {detail && (
          <>
            <Space style={{ marginBottom: 12 }}>
              {detail.pinned && <Tag color="red">置顶</Tag>}
              {detail.targetRoles.length === 0 ? <Tag>全员</Tag> : detail.targetRoles.map((r) => <Tag key={r}>{ROLE_LABEL[r] ?? r}</Tag>)}
              <Text type="secondary">{new Date(detail.publishAt).toLocaleString("zh-CN")}</Text>
            </Space>
            <Paragraph style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{detail.content}</Paragraph>
          </>
        )}
      </Modal>
    </Page>
  );
}
