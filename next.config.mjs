import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 计算对外展示的应用版本号。
 * 格式: <package.json version>+<git short sha>.<MMDD>
 *   例: 0.1.0+f4883cb4.0630
 *
 * dev/build 时 Next 启动重读 → commit 后重跑 build / 重启 dev 即可自动更新；
 * git 不可用 (CI 容器无 .git) 时回落到 env 显式值或 "v2.0",避免 build 断裂。
 */
function computeAppVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('./package.json', import.meta.url), 'utf8')
    );
    const base = pkg.version ?? '0.0.0';
    const sha = execSync('git rev-parse --short HEAD', { cwd: __dirname })
      .toString()
      .trim()
      .slice(0, 7);
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${base}+${sha}.${mm}${dd}`;
  } catch {
    return process.env.NEXT_PUBLIC_APP_VERSION ?? 'v2.0';
  }
}

const appVersion = computeAppVersion();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the workspace root so Next.js/Turbopack stops inferring it from
  // stray lockfiles in ancestor directories.
  turbopack: {
    root: __dirname
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion
  },
  transpilePackages: [
    "antd",
    "@ant-design/pro-components",
    "@ant-design/icons",
    "@ant-design/cssinjs",
    "@ant-design/charts",
    "rc-util",
    "rc-pagination",
    "rc-picker",
    "rc-tree",
    "rc-table"
  ],
  // 安全响应头 (2026-07-11 hardening)
  //  - X-Frame-Options DENY: 防 clickjacking
  //  - X-Content-Type-Options nosniff: 防 MIME 嗅探
  //  - Referrer-Policy strict-origin-when-cross-origin: 防 referer 泄漏
  //  - Permissions-Policy: 禁用摄像头/麦克风/地理位置/支付等
  //  - CSP: 只允许本站资源; style 暂放 unsafe-inline 是 antd + pro-components 的现实约束
  //    (它们用内联 style 注入 css-in-js); script-src 用 nonce 比较重, 这里用
  //    unsafe-inline + unsafe-eval 因为 dev mode Next 注入脚本靠它; 生产构建
  //    Next 会自签名 hash, 这是 antd 6 + pro-components 当前的妥协。
  //    进一步收紧可单独走 CSP-Report-Only 收集违规再迭代。
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "style-src 'self' 'unsafe-inline'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'"
            ].join("; ")
          }
        ]
      }
    ];
  },
  typescript: {
    // 跳过 Docker 构建中的类型检查（编译已完成）
    // 类型检查在 CI/开发中独立运行
    ignoreBuildErrors: true,
  },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" }
  }
};

export default nextConfig;
