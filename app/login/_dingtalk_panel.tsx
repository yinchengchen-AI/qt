"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "antd";
import { QrcodeOutlined } from "@ant-design/icons";
import QRCode from "qrcode";
import { useT } from "@/lib/i18n";
import styles from "./login.module.css";

type PollStatus = "PENDING" | "READY" | "CONSUMED" | "EXPIRED" | "CANCELLED";

export function DingtalkLoginPanel() {
  const t = useT();
  const router = useRouter();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [qrcodeUrl, setQrcodeUrl] = useState<string | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 1) capability probe
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/auth/dingtalk/enabled");
        const j = await r.json();
        if (!cancelled) setEnabled(Boolean(j.data?.enabled));
      } catch {
        if (!cancelled) setEnabled(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 2) fetch QR code after enabled
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const r = await fetch("/api/auth/dingtalk/qrcode");
        if (!r.ok) {
          const j = await r.json().catch(() => null);
          setError(j?.message ?? t("login.dingtalk.unavailable"));
          return;
        }
        const j = await r.json();
        if (cancelled) return;
        setQrcodeUrl(j.data?.qrcodeUrl ?? null);
        setState(j.data?.state ?? null);
      } catch {
        setError(t("login.dingtalk.unavailable"));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // 3) draw QR to canvas
  useEffect(() => {
    if (!qrcodeUrl) return;
    const canvas = document.getElementById("dingtalk-qr") as HTMLCanvasElement | null;
    if (!canvas) return;
    QRCode.toCanvas(canvas, qrcodeUrl, { width: 220, margin: 1 }).catch(() => undefined);
  }, [qrcodeUrl]);

  // 4) poll
  useEffect(() => {
    if (!state) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      try {
        const r = await fetch(`/api/auth/dingtalk/poll?state=${encodeURIComponent(state)}`);
        const j = await r.json();
        const status: PollStatus | undefined = j.data?.status;
        if (status === "EXPIRED") {
          setError(t("login.dingtalk.expired"));
          clearInterval(timer);
        } else if (status === "CANCELLED") {
          setError(t("login.dingtalk.cancelled"));
          clearInterval(timer);
        } else if (status === "READY") {
          clearInterval(timer);
          const f = await fetch("/api/auth/dingtalk/finish", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ state }),
          });
          if (f.ok) {
            router.push("/dashboard");
            router.refresh();
          } else {
            const fj = await f.json().catch(() => null);
            setError(fj?.message ?? t("login.dingtalk.unbound"));
          }
        }
      } catch {
        // ignore; next tick will retry
      }
    }, 1500);
    return () => { cancelled = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (enabled === null || enabled === false) return null;

  async function refresh() {
    setState(null);
    setQrcodeUrl(null);
    setError(null);
    try {
      const r = await fetch("/api/auth/dingtalk/qrcode");
      if (!r.ok) { setError(t("login.dingtalk.unavailable")); return; }
      const j = await r.json();
      setQrcodeUrl(j.data?.qrcodeUrl ?? null);
      setState(j.data?.state ?? null);
    } catch {
      setError(t("login.dingtalk.unavailable"));
    }
  }

  return (
    <div className={styles.dingtalkPanel}>
      <div className={styles.dingtalkSep}>
        <span>{t("login.dingtalk.separator")}</span>
      </div>
      <Button
        type="default"
        size="large"
        block
        icon={<QrcodeOutlined />}
        onClick={refresh}
      >
        {qrcodeUrl ? t("login.dingtalk.refresh") : t("login.dingtalk.button")}
      </Button>
      {qrcodeUrl && (
        <div className={styles.dingtalkQrWrap}>
          <canvas id="dingtalk-qr" />
          <p className={styles.dingtalkHint}>{t("login.dingtalk.qrHint")}</p>
          <p className={styles.dingtalkBind}>{t("login.dingtalk.bind")}</p>
        </div>
      )}
      {error && <p className={styles.dingtalkError}>{error}</p>}
    </div>
  );
}