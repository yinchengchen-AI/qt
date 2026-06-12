import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the workspace root so Next.js/Turbopack stops inferring it from
  // stray lockfiles in ancestor directories.
  turbopack: {
    root: __dirname
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
  experimental: {
    serverActions: { bodySizeLimit: "2mb" }
  }
};

export default nextConfig;
