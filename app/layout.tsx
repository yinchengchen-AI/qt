import "antd/dist/reset.css";
import "./globals.css";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { ConfigProvider, App as AntdApp } from "antd";
import zhCN from "antd/locale/zh_CN";
import { Providers } from "./providers";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "杭州企泰安全科技 业务管理系统",
  description: "客户/合同/项目/开票/回款 一体化管理"
};

// 移动端视口与主题色:正确缩放 + 适配安全区;不设置 maximum-scale 保留缩放可访问性
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0A1C33"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AntdRegistry>
          <ConfigProvider locale={zhCN}>
            <AntdApp>
              <Providers>{children}</Providers>
            </AntdApp>
          </ConfigProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
