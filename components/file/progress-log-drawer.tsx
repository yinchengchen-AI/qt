"use client";
// 项目详情页的"记录里程碑"抽屉;调 POST /api/projects/{projectId}/progress
// (走统一动作入口 projectAction,后端用事务写入 ProjectProgressLog 表,仅存文本)
import { ProForm, ProFormTextArea } from "@ant-design/pro-components";
import { App as AntdApp, Drawer, Typography } from "antd";
import { useResponsive } from "@/lib/use-breakpoint";

export function ProgressLogDrawer(props: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = AntdApp.useApp();
  const { isMobile } = useResponsive();
  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      title="记录项目里程碑"
      // 移动端从底部弹出,占满宽度;桌面端 520px 侧边
      placement={isMobile ? "bottom" : "right"}
      styles={{ wrapper: isMobile ? { height: "90%", width: "100%" } : { width: 520 } }}
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
              body: JSON.stringify({ remark: values.remark ?? "" })
            });
            const j = await r.json();
            if (j.code !== 0) {
              message.error(j.message);
              return false;
            }
            message.success("里程碑已记录");
            props.onSaved();
            props.onClose();
            return true;
          } catch (e) {
            message.error((e as Error).message);
            return false;
          }
        }}
      >
        <ProFormTextArea
          name="remark"
          label="里程碑说明"
          placeholder="本阶段完成情况、产出物、风险与下一步"
          rules={[{ required: true, min: 1, max: 500 }]}
          fieldProps={{ rows: 4, maxLength: 500, showCount: true }}
        />
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          里程碑记录按时间倒序展示在项目详情页与 PDF 打印件中;数字进度请直接看上方「工作流派生进度」。
        </Typography.Paragraph>
      </ProForm>
    </Drawer>
  );
}
