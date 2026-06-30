"use client";

import { Suspense, useState } from "react";
import { App as AntdApp, Button, Checkbox, Form, Input } from "antd";
import { LockOutlined, UserOutlined, FileTextOutlined, TeamOutlined, BarChartOutlined } from "@ant-design/icons";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
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

// 仅开发/预览环境开放快速填充;生产构建时 NODE_ENV 会被静态替换为 "production",
// Next.js 的 dead-code elimination 会把整段折掉,DOM 上不会渲染测试卡。
// 密码统一从 DEV_QUICK_FILL_PASSWORD 读(默认占位串),避免明文密码字面量进 git 历史。
const QUICK_FILL_PASSWORD =
  process.env.NODE_ENV !== "production"
    ? process.env.DEV_QUICK_FILL_PASSWORD ?? "dev-only-fill"
    : "";
// 与 prisma/seed.ts 内置的 5 个角色一一对应(管理员/业务/财务/行政/技术专家)。
// 配合 scripts/dev/seed-dev-accounts.ts 一次性建出对应账号,密码与 QUICK_FILL_PASSWORD 一致。
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

// 系统对外展示的版本号(右上角轻量徽标)。
// 优先读 NEXT_PUBLIC_APP_VERSION,缺省回落到 "v2.0",跟原 V2 提交保持一致;
// 改版时只需调 env 或这里,不动 UI 代码。
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "v2.0";

type FormValues = { employeeNo: string; password: string };

// 解析 callbackUrl,只允许站内相对路径,避免钓鱼/开放重定向
// 规则: 必须以 "/" 开头,且不以 "//" 开头(防 protocol-relative URL)
function safeCallbackUrl(raw: string | null | undefined): string {
  if (!raw) return "/dashboard";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  if (raw.startsWith("/\\") || raw.startsWith("/%5C") || raw.startsWith("/%2f")) return "/dashboard";
  return raw;
}

function LoginForm() {
  const { message } = AntdApp.useApp();
  const router = useRouter();
  const search = useSearchParams();
  const callbackUrl = safeCallbackUrl(search.get("callbackUrl"));

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
        remember: remember ? "true" : "false",
        redirect: false
      });
      if (res?.ok) {
        message.success("登录成功，正在跳转…");
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
    form.setFieldsValue({ employeeNo: no, password: QUICK_FILL_PASSWORD });
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
        <a className={styles.forgot} href="mailto:it@qt.com">
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
    </Form>
  );
}

/* 企泰 logo · 极简圆角方块(纯黑 + 单字母 Q,Apple 风单色感) */
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
        浙江省 A 级安全生产社会化服务机构,临平区首家。
        10 年深耕,把每一次现场检查、风险评估与体系建设
        沉淀为可追溯的数据资产。
      </p>

      <ul className={styles.features} role="list">
        <li className={styles.feature}>
          <span className={styles.featureIcon} aria-hidden>
            <FileTextOutlined />
          </span>
          <span className={styles.featureText}>
            <span className={styles.featureTitle}>合同全生命周期留痕</span>
            <span className={styles.featureDesc}>签署 · 履行 · 归档全程可追溯,风险点自动提示</span>
          </span>
        </li>
        <li className={styles.feature}>
          <span className={styles.featureIcon} aria-hidden>
            <TeamOutlined />
          </span>
          <span className={styles.featureText}>
            <span className={styles.featureTitle}>客户分级与精准服务</span>
            <span className={styles.featureDesc}>2,500+ 生产经营单位档案,服务画像实时更新</span>
          </span>
        </li>
        <li className={styles.feature}>
          <span className={styles.featureIcon} aria-hidden>
            <BarChartOutlined />
          </span>
          <span className={styles.featureText}>
            <span className={styles.featureTitle}>收款统计与现金流可视化</span>
            <span className={styles.featureDesc}>月度趋势 · 客户分布 · 风险预警,一张图掌握全局</span>
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
