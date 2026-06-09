import "antd/dist/reset.css";
import "./globals.css";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { ConfigProvider, App as AntdApp, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { Providers } from "./providers";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "杭州企泰安全科技 业务管理系统",
  description: "客户/合同/项目/开票/回款 一体化管理"
};

const theme = {
  cssVar: { key: "qt" },
  hashed: true,
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    colorPrimary: "#0a1c33",
    colorInfo: "#0f2a47",
    colorSuccess: "#10b981",
    colorWarning: "#f59e0b",
    colorError: "#ef4444",
    colorTextBase: "#0f172a",
    colorBgBase: "#ffffff",
    colorBgLayout: "#f6f8fb",
    colorBorder: "#e2e8f0",
    colorBorderSecondary: "#eef2f7",
    borderRadius: 10,
    borderRadiusLG: 14,
    borderRadiusSM: 6,
    fontSize: 14,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
  },
  components: {
    Button: { primaryShadow: "none", defaultShadow: "none" },
    Layout: { headerBg: "#ffffff", bodyBg: "#f6f8fb", siderBg: "#ffffff" },
    Menu: {
      itemSelectedBg: "rgba(15,42,71,0.08)",
      itemSelectedColor: "#0a1c33",
      itemHoverColor: "#0f2a47",
      itemActiveBg: "rgba(15,42,71,0.04)"
    },
    Table: { headerBg: "#f8fafc", headerColor: "#475569", rowHoverBg: "#f6f8fb" }
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AntdRegistry>
          <ConfigProvider locale={zhCN} theme={theme}>
            <AntdApp>
              <Providers>{children}</Providers>
            </AntdApp>
          </ConfigProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
