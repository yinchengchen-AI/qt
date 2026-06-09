"use client";
import Link from "next/link";
import { Page } from "@/components/page";
import { QtMark } from "@/components/qt-mark";
import { Button } from "antd";

export default function NotFound() {
  return (
    <Page centered>
      <div
        style={{
          maxWidth: 480,
          width: "100%",
          background: "#fff",
          border: "1px solid var(--qt-border)",
          borderRadius: "var(--qt-radius-lg)",
          padding: "44px 36px 36px",
          textAlign: "center",
          position: "relative",
          overflow: "hidden",
          boxShadow: "var(--qt-shadow-md)"
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(700px 280px at 50% -50%, rgba(245,158,11,0.10), transparent 60%)",
            pointerEvents: "none"
          }}
        />
        <div style={{ position: "relative", display: "flex", justifyContent: "center", marginBottom: 20 }}>
          <QtMark size={56} />
        </div>
        <div
          style={{
            position: "relative",
            fontSize: 72,
            fontWeight: 800,
            letterSpacing: -1.5,
            background: "linear-gradient(135deg, #0a1c33 0%, #1e3a5f 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            lineHeight: 1
          }}
        >
          404
        </div>
        <h1
          style={{
            position: "relative",
            margin: "14px 0 6px",
            fontSize: 18,
            fontWeight: 600,
            color: "var(--qt-text-1)"
          }}
        >
          找不到这个页面
        </h1>
        <p
          style={{
            position: "relative",
            margin: "0 0 24px",
            color: "var(--qt-text-2)",
            fontSize: 13.5,
            lineHeight: 1.6
          }}
        >
          链接可能已失效,或页面已被移动 / 归档。<br />
          请检查 URL,或返回工作台继续操作。
        </p>
        <div style={{ position: "relative", display: "flex", justifyContent: "center", gap: 10 }}>
          <Link href="/dashboard">
            <Button type="primary">返回工作台</Button>
          </Link>
          <Link href="/login">
            <Button>重新登录</Button>
          </Link>
        </div>
      </div>
    </Page>
  );
}
