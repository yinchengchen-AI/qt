"use client";

import { Suspense, useState, type FormEvent } from "react";
import { App as AntdApp } from "antd";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  UserOutlined,
  LockOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
  FundProjectionScreenOutlined,
  ExclamationCircleFilled,
  InfoCircleOutlined
} from "@ant-design/icons";
import styles from "./login.module.css";

function LoginForm() {
  const { message } = AntdApp.useApp();
  const router = useRouter();
  const search = useSearchParams();
  const callbackUrl = search.get("callbackUrl") ?? "/dashboard";

  const [employeeNo, setEmployeeNo] = useState("admin");
  const [password, setPassword] = useState("123456");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ERROR_MAP: Record<string, string> = {
    CredentialsSignin: "工号或密码错误,请重试",
    AccessDenied: "账号无访问权限",
    Verification: "验证链接已失效",
    Configuration: "登录服务配置异常,请联系管理员"
  };
  function mapAuthError(code?: string | null) {
    if (!code) return "登录失败,请检查工号或密码";
    return ERROR_MAP[code] ?? "登录失败,请检查工号或密码";
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setError(null);

    if (!employeeNo.trim()) {
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
        employeeNo: employeeNo.trim(),
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
      setError("网络异常,请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  function fillAccount(no: string) {
    setEmployeeNo(no);
    setPassword("123456");
    setError(null);
  }

  return (
    <form className={styles.formInner} onSubmit={handleSubmit} noValidate>
      <header className={styles.formHead}>
        <h1 className={styles.formTitle}>欢迎回来</h1>
        <p className={styles.formSub}>请使用工号与密码登录业务管理系统</p>
      </header>

      {error ? (
        <div className={styles.error} role="alert">
          <ExclamationCircleFilled />
          <span>{error}</span>
        </div>
      ) : null}

      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.label}>工号</span>
          <span className={styles.inputWrap}>
            <UserOutlined className={styles.inputIcon} />
            <input
              className={styles.input}
              type="text"
              name="employeeNo"
              autoComplete="username"
              autoFocus
              spellCheck={false}
              placeholder="请输入工号"
              value={employeeNo}
              onChange={(e) => setEmployeeNo(e.target.value)}
              disabled={loading}
            />
          </span>
        </label>

        <label className={styles.field} style={{ marginTop: 14 }}>
          <span className={styles.label}>密码</span>
          <span className={styles.inputWrap}>
            <LockOutlined className={styles.inputIcon} />
            <input
              className={styles.input}
              type={showPassword ? "text" : "password"}
              name="password"
              autoComplete="current-password"
              placeholder="请输入密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
            <button
              type="button"
              className={styles.inputRight}
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
              tabIndex={-1}
            >
              {showPassword ? <EyeInvisibleOutlined /> : <EyeOutlined />}
            </button>
          </span>
        </label>
      </div>

      <div className={styles.row}>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            disabled={loading}
          />
          <span>记住我</span>
        </label>
        <a className={styles.forgot} href="mailto:it@qt.com">
          忘记密码?
        </a>
      </div>

      <button className={styles.submit} type="submit" disabled={loading}>
        {loading ? <span className={styles.spinner} /> : null}
        {loading ? "正在登录…" : "登 录"}
      </button>

      <details className={styles.testAccounts}>
        <summary>
          <InfoCircleOutlined />
          <span>
            <strong>测试账号</strong> · 点击下方账号快速填充
          </span>
        </summary>
        <div className={styles.testGrid}>
          <span>
            <code className={styles.testCode} onClick={() => fillAccount("admin")}>admin</code>
            {" "}管理员 (A)
          </span>
          <span>
            <code className={styles.testCode} onClick={() => fillAccount("sales")}>sales</code>
            {" "}销售 (S)
          </span>
          <span>
            <code className={styles.testCode} onClick={() => fillAccount("finance")}>finance</code>
            {" "}财务 (F)
          </span>
          <span>
            <code className={styles.testCode} onClick={() => fillAccount("ops")}>ops</code>
            {" "}运营 (O)
          </span>
        </div>
      </details>

      <div className={styles.foot}>
        <span>© 2026 杭州企泰安全科技</span>
        <a href="https://beian.miit.gov.cn" target="_blank" rel="noreferrer">
          浙ICP备 0000000 号
        </a>
      </div>
    </form>
  );
}

function BrandPanel() {
  return (
    <aside className={styles.brand} aria-hidden="true">
      <div className={styles.gridPattern} />
      <svg
        className={`${styles.decor} ${styles.decorRing}`}
        viewBox="0 0 200 200"
        fill="none"
      >
        <circle cx="100" cy="100" r="90" stroke="#f59e0b" strokeWidth="1" strokeDasharray="2 6" />
        <circle cx="100" cy="100" r="60" stroke="#fbbf24" strokeWidth="1" strokeDasharray="1 4" />
      </svg>
      <svg
        className={`${styles.decor} ${styles.decorShield}`}
        viewBox="0 0 200 200"
        fill="none"
      >
        <defs>
          <linearGradient id="shieldGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f59e0b" stopOpacity="0.85" />
            <stop offset="1" stopColor="#fbbf24" stopOpacity="0.45" />
          </linearGradient>
        </defs>
        <path
          d="M100 18 L172 44 V108 C172 146 142 174 100 184 C58 174 28 146 28 108 V44 Z"
          fill="url(#shieldGrad)"
          fillOpacity="0.16"
          stroke="url(#shieldGrad)"
          strokeWidth="1.2"
        />
        <path
          d="M100 38 L156 58 V106 C156 134 134 156 100 164 C66 156 44 134 44 106 V58 Z"
          fill="none"
          stroke="#fbbf24"
          strokeOpacity="0.4"
          strokeWidth="0.8"
          strokeDasharray="2 4"
        />
        <path
          d="M74 102 L94 122 L130 84"
          stroke="#fbbf24"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>

      <div className={styles.brandInner}>
        <div>
          <div className={styles.brandTop}>
            <div className={styles.logoMark}>Q</div>
            <div>
              <span className={styles.brandName}>杭州企泰安全科技</span>
              <span className={styles.brandNameEn}>QITAI SAFETY</span>
            </div>
          </div>
        </div>

        <div className={styles.brandBlock}>
          <h2 className={styles.brandHeadline}>
            业务管理一体化平台
            <br />
            让经营数据驱动每一次决策
          </h2>
          <p className={styles.brandSub}>
            客户、合同、项目、开票、回款全流程在线协同,实时掌控业务全貌。
          </p>

          <ul className={styles.features}>
            <li className={styles.feature}>
              <span className={styles.featureIcon}>
                <SafetyCertificateOutlined />
              </span>
              客户全生命周期管理 · 主数据统一
            </li>
            <li className={styles.feature}>
              <span className={styles.featureIcon}>
                <FundProjectionScreenOutlined />
              </span>
              合同 / 项目 / 财务 实时联动
            </li>
            <li className={styles.feature}>
              <span className={styles.featureIcon}>
                <ThunderboltOutlined />
              </span>
              账龄、回款、业绩 多维统计秒级响应
            </li>
          </ul>
        </div>

        <div className={styles.brandFoot}>
          <span className={styles.badge}>系统运行中</span>
          <span className={styles.footMeta}>v1.0.0 · 等保三级 合规部署</span>
        </div>
      </div>
    </aside>
  );
}

export default function LoginPage() {
  return (
    <div className={styles.page}>
      <BrandPanel />
      <main className={styles.form}>
        <div className={styles.mobileBrand}>
          <div className={styles.logoMark}>Q</div>
          <span>杭州企泰安全科技</span>
        </div>
        <div className={styles.formBody}>
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
