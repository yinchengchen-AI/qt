/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
