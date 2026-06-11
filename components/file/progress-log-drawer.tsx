"use client";
// 项目详情页的"记录进度"抽屉;调 POST /api/projects/{projectId}/progress
// (走统一动作入口 projectAction,后端用事务写入 progressLogs 表)
import { ProForm, ProFormTextArea } from "@ant-design/pro-components";
import { App as AntdApp, Drawer, Form, Slider, Typography } from "antd";

export function ProgressLogDrawer(props: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = AntdApp.useApp();
  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      title="记录项目进度"
      width={520}
      destroyOnHidden
    >
      <ProForm
        layout="vertical"
        onFinish={async (values) => {
          try {
            const r = await fetch(`/api/projects/${props.projectId}/progress`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                percent: values.percent,
                remark: values.remark ?? ""
              })
            });
            const j = await r.json();
            if (j.code !== 0) {
              message.error(j.message);
              return false;
            }
            message.success("进度已记录");
            props.onSaved();
            props.onClose();
            return true;
          } catch (e) {
            message.error((e as Error).message);
            return false;
          }
        }}
      >
        <Form.Item
          name="percent"
          label="当前进度(0-100% 整数)"
          rules={[{ required: true, type: "number", min: 0, max: 100, message: "请填 0-100 之间的整数" }]}
          initialValue={0}
        >
          <Slider min={0} max={100} marks={{ 0: "0%", 25: "25%", 50: "50%", 75: "75%", 100: "100%" }} />
        </Form.Item>
        <ProFormTextArea
          name="remark"
          label="本次进度说明"
          placeholder="本阶段完成情况、产出物、风险与下一步"
          rules={[{ required: true, min: 1, max: 500 }]}
          fieldProps={{ rows: 4, maxLength: 500, showCount: true }}
        />
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          进度日志会按时间倒序出现在项目详情的"进度日志"列表,不改变项目状态。
        </Typography.Paragraph>
      </ProForm>
    </Drawer>
  );
}
