"use client";
// 客户详情页的"新增跟进"抽屉;调 POST /api/customers/{customerId}/follow-ups
// 用 Drawer + ProForm 模式,提交成功后回调 onSaved 让父组件重新拉数据
import { ProForm, ProFormDateTimePicker, ProFormSelect, ProFormTextArea } from "@ant-design/pro-components";
import { App as AntdApp, Drawer, Typography } from "antd";
import { useDict } from "@/lib/dict-client";
import { useResponsive } from "@/lib/use-breakpoint";

const METHOD_FALLBACK = [
  { value: "VISIT", label: "上门拜访" },
  { value: "CALL", label: "电话" },
  { value: "WECHAT", label: "微信" },
  { value: "EMAIL", label: "邮件" },
  { value: "OTHER", label: "其他" }
];

const RESULT_FALLBACK = [
  { value: "INTENT", label: "有意向" },
  { value: "NO_INTENT", label: "无意向" },
  { value: "PENDING", label: "待定" },
  { value: "SIGNED", label: "已签约" }
];

export function FollowUpDrawer(props: {
  customerId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = AntdApp.useApp();
  const { isMobile } = useResponsive();
  const methodDict = useDict("FOLLOW_METHOD");
  const resultDict = useDict("FOLLOW_RESULT");
  const methodOptions = methodDict.length ? methodDict.map((d) => ({ value: d.code, label: d.label })) : METHOD_FALLBACK;
  const resultOptions = resultDict.length ? resultDict.map((d) => ({ value: d.code, label: d.label })) : RESULT_FALLBACK;

  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      title="新增跟进记录"
      // 移动端从底部弹出,占满宽度;桌面端 520px 侧边
      placement={isMobile ? "bottom" : "right"}
      styles={{ wrapper: isMobile ? { height: "90%", width: "100%" } : { width: 520 } }}
      destroyOnHidden
    >
      <ProForm
        layout="vertical"
        initialValues={{ followAt: new Date() }}
        onFinish={async (values) => {
          const payload = {
            followAt: values.followAt?.toISOString?.() ?? new Date().toISOString(),
            method: values.method,
            content: values.content,
            nextFollowAt: values.nextFollowAt ? new Date(values.nextFollowAt).toISOString() : undefined,
            result: values.result
          };
          try {
            const r = await fetch(`/api/customers/${props.customerId}/follow-ups`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify(payload)
            });
            const j = await r.json();
            if (j.code !== 0) {
              message.error(j.message);
              return false;
            }
            message.success("跟进记录已添加");
            props.onSaved();
            props.onClose();
            return true;
          } catch (e) {
            message.error((e as Error).message);
            return false;
          }
        }}
      >
        <ProFormDateTimePicker
          name="followAt"
          label="跟进时间"
          rules={[{ required: true, message: "请选择跟进时间" }]}
          fieldProps={{ style: { width: "100%" } }}
        />
        <ProFormSelect
          name="method"
          label="跟进方式"
          options={methodOptions}
          rules={[{ required: true, message: "请选择跟进方式" }]}
          fieldProps={{ style: { width: "100%" } }}
        />
        <ProFormTextArea
          name="content"
          label="跟进内容"
          placeholder="本次沟通要点、客户反馈等"
          rules={[{ required: true, min: 1, max: 500 }]}
          fieldProps={{ rows: 4, maxLength: 500, showCount: true }}
        />
        <ProFormSelect
          name="result"
          label="跟进结果"
          options={resultOptions}
          allowClear
          fieldProps={{ style: { width: "100%" } }}
        />
        <ProFormDateTimePicker
          name="nextFollowAt"
          label="下次跟进时间"
          fieldProps={{ style: { width: "100%" } }}
        />
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          跟进记录会按时间倒序出现在客户详情页的「跟进记录」列表。
        </Typography.Paragraph>
      </ProForm>
    </Drawer>
  );
}
