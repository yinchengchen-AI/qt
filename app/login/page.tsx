"use client";

import { Suspense, useState } from "react";
import { App as AntdApp, Button, Checkbox, Form, Input, Modal, message as antMessage } from "antd";
import { LockOutlined, UserOutlined, FileTextOutlined, TeamOutlined, BarChartOutlined } from "@ant-design/icons";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { safeCallbackUrl } from "@/lib/safe-callback-url";
import styles from "./login.module.css";

const ERROR_MAP: Record<string, string> = {
  CredentialsSignin: "工号或密码错误，请检查后重试",
  AccessDenied: "当前账号未授予访问权限，请联系管理员",
  Verification: "验证链接已失效，请重新登录",
  Configuration: "登录服务配置异常，请联系管理员"
};

function mapAuthError(code?: string | null) {
  if (!code) return "登录失败，请检查工号与密码";
  return ERROR_MAP[code] ?? "登录失败，请检查工号或密码";
}

// 仅开发/预览环境开放快速填充; 生产构建时 NODE_ENV 会被静态替换为 "production",
// Next.js 的 dead-code elimination 会把整段折掉, DOM 上不会渲染测试卡。
// 密码统一从 DEV_QUICK_FILL_PASSWORD 读(默认占位串), 避免明文密码字面量进 git 历史。
const QUICK_FILL_PASSWORD =
  process.env.NODE_ENV !== "production"
    ? process.env.DEV_QUICK_FILL_PASSWORD ?? "dev-only-fill"
    : "";
const QUICK_ACCOUNTS: { no: string; label: string }[] =
  process.env.NODE_ENV !== "production"
    ? [
        { no: "admin", label: "管理员" },
        { no: "sales", label: "业务人员" },
        { no: "finance", label: "财务人员" },
        { no: "ops", label: "行政人员" },
        { no: "expert", label: "技术专家" }
      ]
    : [];

const SHOW_QUICK_FILL = process.env.NODE_ENV !== "production";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "v2.0";

type FormValues = { employeeNo: string; password: string };

// callbackUrl 安全校验: 抽到 lib/safe-callback-url.ts, 方便单测
// 见 lib/safe-callback-url.ts 完整注释

/** 改密表单: resetToken 来自 ?resetToken=xxx, 新密码至少 8 字符 */
function ChangePasswordForm({ token, onDone }: { token: string; onDone: () => void }) {
  const [form] = Form.useForm<{ password: string; confirm: string }>();
  const [loading, setLoading] = useState(false);

  async function onFinish(values: { password: string; confirm: string }) {
    if (loading) return;
    if (values.password !== values.confirm) {
      antMessage.error("两次输入的密码不一致");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: values.password })
      });
      const data = await res.json();
      if (res.ok && data?.code === 0) {
        antMessage.success("密码已更新，请用新密码登录");
        onDone();
      } else {
        antMessage.error(data?.message ?? "重置失败，链接可能已过期");
      }
    } catch {
      antMessage.error("网络异常，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Form form={form} layout="vertical" onFinish={onFinish}>
      <Form.Item
        label="新密码"
        name="password"
        rules={[
          { required: true, message: "请输入新密码" },
          { min: 8, message: "密码长度至少 8 字符" }
        ]}
      >
        <Input.Password size="large" prefix={<LockOutlined />} placeholder="新密码（≥ 8 字符）" autoComplete="new-password" />
      </Form.Item>
      <Form.Item
        label="确认新密码"
        name="confirm"
        dependencies={["password"]}
        rules={[
          { required: true, message: "请再次输入新密码" },
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue("password") === value) return Promise.resolve();
              return Promise.reject(new Error("两次输入的密码不一致"));
            }
          })
        ]}
      >
        <Input.Password size="large" prefix={<LockOutlined />} placeholder="再次输入新密码" autoComplete="new-password" />
      </Form.Item>
      <Button type="primary" htmlType="submit" size="large" block loading={loading}>
        {loading ? "提交中 …" : "更新密码"}
      </Button>
    </Form>
  );
}

/** 申请重置 token 表单 */
function ResetRequestForm({ onDone }: { onDone: () => void }) {
  const [form] = Form.useForm<{ employeeNo: string; email: string }>();
  const [loading, setLoading] = useState(false);

  async function onFinish(values: { employeeNo: string; email: string }) {
    if (loading) return;
    setLoading(true);
    try {
      const _res = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeNo: values.employeeNo.trim().toLowerCase(), email: values.email.trim() })
      });
      // 永远返回 200, 避免泄漏"该用户是否存在"
      antMessage.success("若账号与邮箱匹配，重置链接已生成。请联系管理员索取。");
      onDone();
    } catch {
      antMessage.error("网络异常，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Form form={form} layout="vertical" onFinish={onFinish}>
      <p className={styles.modalHint}>
        请填写工号和预留邮箱。我们会校验匹配后生成一次性重置链接，
        由管理员通过内部渠道送达。
      </p>
      <Form.Item
        label="工号"
        name="employeeNo"
        rules={[{ required: true, message: "请输入工号" }]}
      >
        <Input size="large" prefix={<UserOutlined />} placeholder="工号" autoComplete="username" />
      </Form.Item>
      <Form.Item
        label="邮箱"
        name="email"
        rules={[
          { required: true, message: "请输入邮箱" },
          { type: "email", message: "邮箱格式不正确" }
        ]}
      >
        <Input size="large" placeholder="name@example.com" autoComplete="email" />
      </Form.Item>
      <Button type="primary" htmlType="submit" size="large" block loading={loading}>
        {loading ? "提交中 …" : "申请重置"}
      </Button>
    </Form>
  );
}

function LoginForm() {
  const { message } = AntdApp.useApp();
  const router = useRouter();
  const search = useSearchParams();
  // origin 仅在浏览器可取; SSR 阶段用空串, safeCallbackUrl 会跳过 origin 校验,
  // 客户端水合后 useEffect 会再校一遍 (见下方 useEffect)
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const callbackUrl = safeCallbackUrl(search.get("callbackUrl"), origin);
  const resetToken = search.get("resetToken");

  const [form] = Form.useForm<FormValues>();
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  async function handleFinish(values: FormValues) {
    if (loading) return;
    setError(null);

    const employeeNo = values.employeeNo?.trim().toLowerCase() ?? "";
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
        remember: remember ? "true" : "false",
        redirect: false
      });
      if (res?.ok) {
        message.success("登录成功，正在跳转…");
        // 拉一次 session, 拿到 mustChangePassword, 决定下一步跳转
        const _sessionRes = await fetch("/api/auth/me", { credentials: "include" });
        const sessionJson = await _sessionRes.json().catch(() => null);
        const u = sessionJson?.data?.user;
        if (u?.mustChangePassword) {
          // 强制改密页
          router.replace("/login?resetRequired=1");
          return;
        }
        // P3-4: 用 router.replace + await refresh, 避免 push/refresh 竞态
        router.replace(callbackUrl);
        await Promise.resolve(router.refresh());
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
    form.setFieldsValue({ employeeNo: no, password: QUICK_FILL_PASSWORD });
    setError(null);
  }

  // 有 resetToken → 渲染改密表单 (无 resetToken → 登录表单)
  if (resetToken) {
    return (
      <div className={styles.formInner}>
        <header className={styles.formHead}>
          <h1 className={styles.formTitle}>设置新密码</h1>
          <p className={styles.formSubtitle}>通过重置链接设置新密码后自动跳回登录</p>
        </header>
        <ChangePasswordForm
          token={resetToken}
          onDone={() => {
            // 清掉 query 跳回登录
            router.replace("/login");
          }}
        />
        <div className={styles.foot}>© 2026 杭州企泰安全科技有限公司</div>
      </div>
    );
  }

  return (
    <div className={styles.formInner}>
      <Form<FormValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{ employeeNo: "", password: "" }}
        onFinish={handleFinish}
      >
        <header className={styles.formHead}>
          <h1 className={styles.formTitle}>欢迎回来</h1>
          <p className={styles.formSubtitle}>登录以继续使用业务管理系统</p>
        </header>

        {error ? (
          <div className={styles.error} role="alert">
            <LockOutlined style={{ fontSize: 13 }} />
            {error}
          </div>
        ) : null}

        <Form.Item
          label="工号"
          name="employeeNo"
          rules={[{ required: true, message: "请输入工号" }]}
          style={{ marginBottom: 14 }}
        >
          <Input
            size="large"
            name="employeeNo"
            prefix={<UserOutlined />}
            placeholder="工号"
            autoFocus
            autoComplete="username"
          />
        </Form.Item>

        <Form.Item
          label="密码"
          name="password"
          rules={[{ required: true, message: "请输入密码" }]}
          style={{ marginBottom: 10 }}
        >
          <Input.Password
            size="large"
            name="password"
            prefix={<LockOutlined />}
            placeholder="密码"
            autoComplete="current-password"
          />
        </Form.Item>

        <div className={styles.formRow}>
          <Checkbox
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            disabled={loading}
            className={styles.remember}
          >
            保持登录
          </Checkbox>
          <a
            className={styles.forgot}
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setResetOpen(true);
            }}
          >
            忘记密码？
          </a>
        </div>

        <Form.Item style={{ marginBottom: 0 }}>
          <Button
            type="primary"
            htmlType="submit"
            size="large"
            block
            loading={loading}
            className={styles.submit}
          >
            {loading ? "正在登录 …" : "登录"}
          </Button>
        </Form.Item>
      </Form>

      <Modal
        title="申请密码重置"
        open={resetOpen}
        onCancel={() => setResetOpen(false)}
        footer={null}
        destroyOnClose
      >
        <ResetRequestForm onDone={() => setResetOpen(false)} />
      </Modal>

      {SHOW_QUICK_FILL && QUICK_ACCOUNTS.length > 0 ? (
        <details className={styles.testCard}>
          <summary>开发 / 预览 · 点击下方账号可一键填充</summary>
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

      <div className={styles.foot}>© 2026 杭州企泰安全科技有限公司</div>
    </div>
  );
}

/* 企泰 logo · 极简圆角方块(纯黑 + 单字母 Q, Apple 风单色感) */
function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="24" height="24" rx="6" fill="#1D1D1F" />
      <text
        x="12"
        y="16.5"
        textAnchor="middle"
        fontSize="13.5"
        fontWeight="500"
        fontFamily="-apple-system, BlinkMacSystemFont, system-ui, sans-serif"
        fill="#FFFFFF"
        letterSpacing="-0.04em"
      >
        Q
      </text>
    </svg>
  );
}

/* 桌面端左栏叙事(Apple 风"轻"叙述) */
function Narrative() {
  return (
    <aside className={styles.narrative} aria-label="品牌叙事">
      <h2 className={styles.hero}>
        让安全管理<br />
        <span className={styles.heroAccent}>有据可循。</span>
      </h2>
      <p className={styles.heroSub}>
        浙江省 A 级安全生产社会化服务机构，临平区首家。
        10 年深耕，把每一次现场检查、风险评估与体系建设
        沉淀为可追溯的数据资产。
      </p>

      <ul className={styles.features} role="list">
        <li className={styles.feature}>
          <span className={styles.featureIcon} aria-hidden>
            <FileTextOutlined />
          </span>
          <span className={styles.featureText}>
            <span className={styles.featureTitle}>合同全生命周期留痕</span>
            <span className={styles.featureDesc}>签署 · 履行 · 归档全程可追溯，风险点自动提示</span>
          </span>
        </li>
        <li className={styles.feature}>
          <span className={styles.featureIcon} aria-hidden>
            <TeamOutlined />
          </span>
          <span className={styles.featureText}>
            <span className={styles.featureTitle}>客户分级与精准服务</span>
            <span className={styles.featureDesc}>2,500+ 生产经营单位档案，服务画像实时更新</span>
          </span>
        </li>
        <li className={styles.feature}>
          <span className={styles.featureIcon} aria-hidden>
            <BarChartOutlined />
          </span>
          <span className={styles.featureText}>
            <span className={styles.featureTitle}>收款统计与现金流可视化</span>
            <span className={styles.featureDesc}>月度趋势 · 客户分布 · 风险预警，一张图掌握全局</span>
          </span>
        </li>
      </ul>

      <p className={styles.brandFoot}>
        杭州企泰安全科技有限公司 · 浙江省 A 级安全生产服务机构 · 临平区首家
      </p>
    </aside>
  );
}

export default function LoginPage() {
  return (
    <div className={styles.page}>
      <div className={styles.bgLayer} />

      {/* 顶栏 */}
      <header className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <BrandMark size={22} />
          <span className={styles.topBarLogoCn}>
            <span>企泰安全</span>
            <span className={styles.topBarLogoSub}>业务管理系统</span>
          </span>
        </div>
        <div className={styles.topBarRight}>
          <span
            className={styles.versionChip}
            aria-label={`系统版本 ${APP_VERSION}`}
            title={`系统版本 ${APP_VERSION}`}
          >
            {APP_VERSION}
          </span>
          <a className={styles.topBarLink} href="mailto:it@qt.com">
            需要帮助？
          </a>
        </div>
      </header>

      {/* 主区:桌面端左右双栏,移动端单列 */}
      <main className={styles.main}>
        <div className={styles.layout}>
          <Narrative />
          <div className={styles.formShell}>
            <section className={styles.formCard} aria-label="登录">
              <Suspense fallback={null}>
                <LoginForm />
              </Suspense>
            </section>

            {/* 备案 / 链接放表单区下方 */}
            <footer className={styles.footer}>
              <span>© 2026 杭州企泰安全科技有限公司</span>
              <span className={styles.footerSep}>·</span>
              <a href="mailto:it@qt.com">联系我们</a>
              <span className={styles.footerSep}>·</span>
              <a
                href="https://beian.miit.gov.cn"
                target="_blank"
                rel="noreferrer"
                suppressHydrationWarning
              >
                {process.env.NEXT_PUBLIC_BEIAN_NO ?? "浙ICP备 0000000 号"}
              </a>
            </footer>
          </div>
        </div>
      </main>
    </div>
  );
}
