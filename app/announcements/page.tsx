"use client";
import { ProCard, ProTable } from "@ant-design/pro-components";
import { Empty, Alert, Tag } from "antd";

export default function Page() {
  return (
    <ProCard>
      <Alert
        type="info"
        showIcon
        message="本模块计划在 P3 阶段实施"
        description="当前版本（P2 验收）暂未实现该模块的 UI；API 路由（如 /api/users、/api/roles、/api/dictionaries）已具备，UI 渲染与角色权限收尾工作待 P3。"
        style={{ marginBottom: 16 }}
      />
      <ProTable
        rowKey="id"
        search={false}
        options={false}
        pagination={false}
        dataSource={[]}
        columns={[]}
        toolBarRender={() => []}
        locale={{ emptyText: <Empty description="暂无数据" /> }}
      />
    </ProCard>
  );
}
