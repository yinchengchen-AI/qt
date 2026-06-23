// 通知通道：inbox / email / wechatWork
// inbox: 已在 events/bus.ts 中处理
// email: nodemailer 异步发送；失败只 log，不抛
// wechatWork: webhook POST JSON
import nodemailer from "nodemailer";
import { NOTIFY_CONFIG, type NotifyChannel } from "@/lib/notify-config";
import { getPublicBaseUrl } from "@/lib/env";
import { buildMessageLinkHref } from "@/lib/message-link";

export type ChannelPayload = {
  type: string;
  title: string;
  content: string;
  link?: { kind: string; id: string } | null;
  to: { userId: string; email?: string | null; name: string };
};

let _transport: nodemailer.Transporter | null = null;
function getTransport(): nodemailer.Transporter | null {
  if (!NOTIFY_CONFIG.enabled.email) return null;
  if (!NOTIFY_CONFIG.email.user) return null;
  if (_transport) return _transport;
  _transport = nodemailer.createTransport({
    host: NOTIFY_CONFIG.email.host,
    port: NOTIFY_CONFIG.email.port,
    secure: NOTIFY_CONFIG.email.secure,
    auth: { user: NOTIFY_CONFIG.email.user, pass: NOTIFY_CONFIG.email.pass }
  });
  return _transport;
}

function absoluteLink(link: { kind: string; id: string } | null | undefined): string | null {
  if (!link) return null;
  const relative = buildMessageLinkHref(link);
  if (!relative) return null;
  return `${getPublicBaseUrl()}${relative}`;
}

export async function sendEmail(p: ChannelPayload): Promise<{ ok: boolean; error?: string }> {
  if (!p.to.email) return { ok: false, error: "no email" };
  const t = getTransport();
  if (!t) return { ok: false, error: "email disabled" };
  try {
    const url = absoluteLink(p.link);
    await t.sendMail({
      from: NOTIFY_CONFIG.email.from,
      to: p.to.email,
      subject: `[企泰业务管理] ${p.title}`,
      text: `${p.content}\n\n${url ? `查看详情：${url}` : ""}`
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function sendWechatWork(p: ChannelPayload): Promise<{ ok: boolean; error?: string }> {
  if (!NOTIFY_CONFIG.enabled.wechatWork) return { ok: false, error: "wechatWork disabled" };
  if (!NOTIFY_CONFIG.wechatWork.webhookUrl) return { ok: false, error: "no webhook" };
  try {
    const url = absoluteLink(p.link);
    const res = await fetch(NOTIFY_CONFIG.wechatWork.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        msgtype: "markdown",
        markdown: {
          content: `### ${p.title}\n${p.content}${url ? `\n[查看详情](${url})` : ""}`
        }
      })
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export const CHANNEL_HANDLERS: Record<Exclude<NotifyChannel, "inbox">, (p: ChannelPayload) => Promise<{ ok: boolean; error?: string }>> = {
  email: sendEmail,
  wechatWork: sendWechatWork
};
