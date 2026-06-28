"use client";

import { Suspense, useEffect, useState } from "react";
import { App as AntdApp, Button, Checkbox, Form, Input, Typography } from "antd";
import { LockOutlined, UserOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./login.module.css";

const { Text } = Typography;

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
        // NextAuth 在内部把任意非内置字段塞进 creds 传给 authorize;
        // 这里 "true"/"false" 是字符串,与 authorize 里的归一化逻辑对应
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
        <h2 className={styles.formTitle}>欢迎回来</h2>
        <p className={styles.formSubtitle}>请使用工号与密码进入业务管理系统</p>
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
          prefix={<UserOutlined style={{ color: "#9CA3AF" }} />}
          placeholder="请输入工号，如：admin"
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
          prefix={<LockOutlined style={{ color: "#9CA3AF" }} />}
          placeholder="请输入密码（8 ～ 72 个字符）"
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
          7 天内免登录
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
          style={{ background: "#0A1C33", borderColor: "#0A1C33" }}
        >
          登 录
        </Button>
      </Form.Item>

      {SHOW_QUICK_FILL && QUICK_ACCOUNTS.length > 0 ? (
        <details className={styles.testCard}>
          <summary>开发 / 预览环境：点击下方账号可一键填充</summary>
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
        © 2026 杭州企泰安全科技有限公司
      </div>
    </Form>
  );
}

function useCountUp(target: number, duration = 1400, delay = 300) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t = setTimeout(() => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        setValue(Math.round(target * eased));
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, delay);
    return () => {
      clearTimeout(t);
      cancelAnimationFrame(raf);
    };
  }, [target, duration, delay]);
  return value;
}

function useClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Stat({ value, suffix }: { value: number; suffix?: string }) {
  const v = useCountUp(value, 1400, 400);
  return (
    <>
      {v}
      {suffix}
    </>
  );
}

function formatStamp(d: Date | null) {
  if (!d) return "----.--.-- --:--";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* 企泰 logo */
function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <mask id={`bm-${size}-v2`}>
          <rect width="48" height="48" fill="white" />
          <rect x="24" y="14" width="24" height="20" fill="black" />
        </mask>
      </defs>
      <rect width="48" height="48" rx="6" fill="#0A1C33" mask={`url(#bm-${size}-v2)`} />
      <rect x="32" y="28" width="20" height="20" rx="3" fill="#E11A2A" />
      <rect x="58" y="14" width="6" height="6" rx="1" fill="#0A1C33" transform="translate(-48 0)" />
    </svg>
  );
}

export default function LoginPage() {
  const clock = useClock();
  return (
    <div className={styles.page}>
      <div className={styles.bgLayer} />
      <div className={styles.bgMark}>QT</div>

      {/* 顶栏 */}
      <header className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <BrandMark size={28} />
          <span className={styles.topBarLogoCn}>
            <span>企泰安全</span>
            <span className={styles.topBarLogoSub}>QITAI SAFETY · 业务管理系统</span>
          </span>
        </div>
        <div className={styles.topBarRight}>
          <span className={styles.secureBadge}>
            <SafetyCertificateOutlined style={{ fontSize: 11 }} />
            SECURE 256-BIT
          </span>
          <span className={styles.statusDot} />
          <Text type="secondary" style={{ fontSize: 12 }}>服务正常</Text>
        </div>
      </header>

      {/* 主区 */}
      <main className={styles.main}>
        {/* 左:叙事 */}
        <section className={styles.narrative} aria-label="品牌叙事">
          <div className={styles.eyebrow}>
            <span>EST <strong>2015</strong></span>
            <span>· 安全生产服务 ·</span>
            <span><strong>A</strong> 级信用</span>
          </div>

          <h1 className={styles.headline}>
            让安全管理<br />
            <em>有据可循</em>
          </h1>

          <p className={styles.sub}>
            浙江省 A 级安全生产社会化服务机构,临平区首家。
            10 年深耕,服务 20+ 政府部门与 2,500+ 生产经营单位,
            把每一次现场检查、风险评估与体系建设都沉淀为可追溯的数据资产。
          </p>

          <div className={styles.stats}>
            <span className={styles.statChip}>
              <strong>
                <Stat value={22} />
              </strong>
              名注册安全工程师
            </span>
            <span className={styles.statChip}>
              <strong>
                <Stat value={2547} />
              </strong>
              家企业服务
            </span>
            <span className={styles.statChip}>
              <strong>
                <Stat value={20} suffix="+" />
              </strong>
              政府部门
            </span>
            <span className={`${styles.statChip} ${styles.statChipAccent}`}>
              <strong>A</strong>
              级信用 · 浙江
            </span>
          </div>

          <div className={styles.narrativeFoot}>
            <span className={styles.narrativeFootItem}>
              <span className={styles.tickerBlink} />
              STATUS · NOMINAL
            </span>
            <span className={styles.tickerSep}>{"//"}</span>
            <span className={styles.narrativeFootItem}>SECTOR 04</span>
            <span className={styles.tickerSep}>{"//"}</span>
            <span className={styles.narrativeFootItem}>T+ {formatStamp(clock)}</span>
            <span className={styles.tickerSep}>{"//"}</span>
            <span className={styles.narrativeFootItem}>ALERTS 0</span>
          </div>
        </section>

        {/* 右:表单卡 */}
        <section className={styles.formCard} aria-label="登录">
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </section>
      </main>

      {/* 页脚 */}
      <footer className={styles.footer}>
        <span>© 2026 杭州企泰安全科技有限公司 · 业务管理系统 v2.0</span>
        <a
          className={styles.beian}
          href="https://beian.miit.gov.cn"
          target="_blank"
          rel="noreferrer"
          suppressHydrationWarning
        >
          {process.env.NEXT_PUBLIC_BEIAN_NO ?? "浙ICP备 0000000 号"}
        </a>
      </footer>
    </div>
  );
}
