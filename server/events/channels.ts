// 通知通道：inbox / email / wechatWork
// inbox: 已在 events/bus.ts 中处理
// email: nodemailer 异步发送；失败只 log，不抛
// wechatWork: webhook POST JSON
import nodemailer from "nodemailer";
import { NOTIFY_CONFIG, type NotifyChannel } from "@/lib/notify-config";

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

export async function sendEmail(p: ChannelPayload): Promise<{ ok: boolean; error?: string }> {
  if (!p.to.email) return { ok: false, error: "no email" };
  const t = getTransport();
  if (!t) return { ok: false, error: "email disabled" };
  try {
    await t.sendMail({
      from: NOTIFY_CONFIG.email.from,
      to: p.to.email,
      subject: `[企泰业务管理] ${p.title}`,
      text: `${p.content}\n\n${p.link ? `查看详情：${kindToPath(p.link)}/${p.link.id}` : ""}`
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
    const res = await fetch(NOTIFY_CONFIG.wechatWork.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        msgtype: "markdown",
        markdown: {
          content: `### ${p.title}\n${p.content}${p.link ? `\n[查看详情](${kindToPath(p.link)}/${p.link.id})` : ""}`
        }
      })
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function kindToPath(link: { kind: string }): string {
  const map: Record<string, string> = {
    contract: "https://yourdomain.com/contracts",
    invoice: "https://yourdomain.com/invoices",
    payment: "https://yourdomain.com/payments",
    project: "https://yourdomain.com/projects",
    customer: "https://yourdomain.com/customers"
  };
  return map[link.kind] ?? "https://yourdomain.com/messages";
}

export const CHANNEL_HANDLERS: Record<Exclude<NotifyChannel, "inbox">, (p: ChannelPayload) => Promise<{ ok: boolean; error?: string }>> = {
  email: sendEmail,
  wechatWork: sendWechatWork
};
