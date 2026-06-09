"use client";
import { Suspense } from "react";
import { ProCard, ProForm, ProFormText, ProFormCheckbox } from "@ant-design/pro-components";
import { Button, App as AntdApp } from "antd";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const { message } = AntdApp.useApp();
  const router = useRouter();
  const search = useSearchParams();
  const callbackUrl = search.get("callbackUrl") ?? "/dashboard";

  return (
    <ProCard style={{ width: 420 }} title="杭州企泰安全科技 · 业务管理系统">
      <ProForm
        layout="vertical"
        onFinish={async (values) => {
          const res = await signIn("credentials", {
            employeeNo: values.employeeNo,
            password: values.password,
            redirect: false
          });
          if (res?.ok) {
            message.success("登录成功");
            router.push(callbackUrl);
          } else {
            message.error(res?.error ?? "登录失败");
          }
        }}
      >
        <ProFormText
          name="employeeNo"
          label="工号"
          placeholder="请输入工号"
          rules={[{ required: true, message: "请输入工号" }]}
        />
        <ProFormText.Password
          name="password"
          label="密码"
          placeholder="请输入密码"
          rules={[{ required: true, message: "请输入密码" }]}
        />
        <ProFormCheckbox name="remember">记住我</ProFormCheckbox>
        <Button type="primary" htmlType="submit" block size="large" style={{ marginTop: 16 }}>
          登录
        </Button>
      </ProForm>
      <div style={{ marginTop: 16, fontSize: 12, color: "#999" }}>
        测试账号：admin/123456（A）、sales/123456（S）、finance/123456（F）、ops/123456（O）
      </div>
    </ProCard>
  );
}

export default function LoginPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f0f2f5"
      }}
    >
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
