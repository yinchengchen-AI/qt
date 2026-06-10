"use client";

import { Suspense, useState } from "react";
import { App as AntdApp, Button, Checkbox, Form, Input, Typography, Space, Divider } from "antd";
import { LockOutlined, UserOutlined, SafetyOutlined } from "@ant-design/icons";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./login.module.css";
import { QtMark } from "@/components/qt-mark";

const { Title, Text, Link: AntdLink } = Typography;

const ERROR_MAP: Record<string, string> = {
  CredentialsSignin: "工号或密码错误，请重试",
  AccessDenied: "账号无访问权限",
  Verification: "验证链接已失效",
  Configuration: "登录服务配置异常，请联系管理员"
};

function mapAuthError(code?: string | null) {
  if (!code) return "登录失败，请检查工号或密码";
  return ERROR_MAP[code] ?? "登录失败，请检查工号或密码";
}

// 仅开发/预览环境开放快速填充;生产构建时 NODE_ENV 会被静态替换为 "production",
// Next.js 的 dead-code elimination 会把整段 `[]` 折掉,DOM 上不会渲染测试卡。
const QUICK_ACCOUNTS: { no: string; label: string }[] =
  process.env.NODE_ENV !== "production"
    ? [
        { no: "admin", label: "管理员" },
        { no: "sales", label: "业务" },
        { no: "finance", label: "财务" },
        { no: "ops", label: "运营" }
      ]
    : [];

const SHOW_QUICK_FILL = process.env.NODE_ENV !== "production";

type FormValues = { employeeNo: string; password: string };

function LoginForm() {
  const { message } = AntdApp.useApp();
  const router = useRouter();
  const search = useSearchParams();
  const callbackUrl = search.get("callbackUrl") ?? "/dashboard";

  const [form] = Form.useForm<FormValues>();
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFinish(values: FormValues) {
    if (loading) return;
    setError(null);

    const employeeNo = values.employeeNo?.trim() ?? "";
    const password = values.password ?? "";

    if (!employeeNo) {
      setError("请输入工号");
      return;
    }
    if (!password) {
      setError("请输入密码");
      return;
    }

    setLoading(true);
    try {
      const res = await signIn("credentials", {
        employeeNo,
        password,
        redirect: false
      });
      if (res?.ok) {
        message.success("登录成功");
        router.push(callbackUrl);
        router.refresh();
      } else {
        setError(mapAuthError(res?.error));
      }
    } catch {
      setError("网络异常，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  function fillAccount(no: string) {
    if (!SHOW_QUICK_FILL) return;
    form.setFieldsValue({ employeeNo: no, password: "123456" });
    setError(null);
  }

  return (
    <Form<FormValues>
      form={form}
      layout="vertical"
      requiredMark={false}
      initialValues={{ employeeNo: "", password: "" }}
      onFinish={handleFinish}
    >
      <header style={{ marginBottom: 16 }}>
        <Title level={2} style={{ margin: 0, fontWeight: 600 }}>
          欢迎登录
        </Title>
        <Text type="secondary">请使用工号与密码进入业务管理系统</Text>
      </header>

      {error ? (
        <div
          style={{
            marginBottom: 16,
            padding: "8px 12px",
            background: "#fff2f0",
            border: "1px solid #ffccc7",
            borderRadius: 6,
            color: "#cf1322",
            fontSize: 13
          }}
        >
          {error}
        </div>
      ) : null}

      <Form.Item
        label="工号"
        name="employeeNo"
        rules={[{ required: true, message: "请输入工号" }]}
      >
        <Input
          size="large"
          name="employeeNo"
          prefix={<UserOutlined />}
          placeholder="请输入工号"
          autoFocus
          autoComplete="username"
        />
      </Form.Item>

      <Form.Item
        label="密码"
        name="password"
        rules={[{ required: true, message: "请输入密码" }]}
        style={{ marginTop: 4 }}
      >
        <Input.Password
          size="large"
          name="password"
          prefix={<LockOutlined />}
          placeholder="请输入密码"
          autoComplete="current-password"
        />
      </Form.Item>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          margin: "-4px 0 16px"
        }}
      >
        <Checkbox
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          disabled={loading}
        >
          记住我
        </Checkbox>
        <AntdLink href="mailto:it@qt.com" style={{ fontSize: 13 }}>
          忘记密码？
        </AntdLink>
      </div>

      <Form.Item style={{ marginBottom: 16 }}>
        <Button type="primary" htmlType="submit" size="large" block loading={loading}>
          登 录
        </Button>
      </Form.Item>

      {SHOW_QUICK_FILL && QUICK_ACCOUNTS.length > 0 ? (
        <details className={styles.testCard}>
          <summary>测试账号 · 点击下方账号快速填充</summary>
          <div className={styles.testGrid}>
            {QUICK_ACCOUNTS.map((a) => (
              <span key={a.no}>
                <code className={styles.testCode} onClick={() => fillAccount(a.no)}>
                  {a.no}
                </code>
                {a.label}
              </span>
            ))}
          </div>
        </details>
      ) : null}

      <div className={styles.foot}>
        <Space separator={<Divider orientation="vertical" />}>
          <span>© 2026 杭州企泰安全科技</span>
          <a
            href="https://beian.miit.gov.cn"
            target="_blank"
            rel="noreferrer"
            suppressHydrationWarning
          >
            {process.env.NEXT_PUBLIC_BEIAN_NO ?? "浙ICP备 0000000 号"}
          </a>
        </Space>
      </div>
    </Form>
  );
}

function BrandPanel() {
  return (
    <aside className={styles.brandSide} aria-hidden="true">
      <div className={styles.brandInner}>
        <div className={styles.brandLogo}>
          <QtMark size={36} withWordmark variant="light" />
        </div>

        <div>
          <h2 className={styles.brandHeadline}>
            业务管理一体化平台
            <br />
            让经营数据驱动每一次决策
          </h2>
          <p className={styles.brandSub}>
            客户、合同、项目、开票、回款全流程在线协同，实时掌控业务全貌。
          </p>

          <ul className={styles.features}>
            <li className={styles.feature}>
              <span className={styles.featureDot} />
              客户全生命周期管理 · 主数据统一
            </li>
            <li className={styles.feature}>
              <span className={styles.featureDot} />
              合同 / 项目 / 财务 实时联动
            </li>
            <li className={styles.feature}>
              <span className={styles.featureDot} />
              账龄、回款、业绩 多维统计秒级响应
            </li>
          </ul>
        </div>

        <div className={styles.brandFoot}>
          <SafetyOutlined style={{ marginRight: 6 }} />
          等保三级 合规部署 · v 0.1.0
        </div>
      </div>
    </aside>
  );
}

export default function LoginPage() {
  return (
    <div className={styles.page}>
      <BrandPanel />
      <main className={styles.formSide}>
        <div className={styles.formBody}>
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
      </main>
    </div>
  );
}