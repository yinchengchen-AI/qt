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
