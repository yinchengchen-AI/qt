// 简单压测：登录 admin 后，N 并发持续 5 秒请求 /api/customers
import _http from "node:http";
import { performance } from "node:perf_hooks";

const BASE = process.env.BASE ?? "http://localhost:3000";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 50);
const DURATION_MS = Number(process.env.DURATION_MS ?? 5000);

async function login() {
  const cookieJar = {};
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const setCookie = csrfRes.headers.getSetCookie();
  for (const c of setCookie ?? []) {
    const [pair] = c.split(";");
    const [k, v] = pair.split("=");
    cookieJar[k] = v;
  }
  const csrf = (await csrfRes.json()).csrfToken;
  const fd = new URLSearchParams({ csrfToken: csrf, employeeNo: "admin", password: "123456", callbackUrl: "/dashboard", json: "true" });
  const r = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join("; ") },
    body: fd.toString(),
    redirect: "manual"
  });
  for (const c of r.headers.getSetCookie() ?? []) {
    const [pair] = c.split(";");
    const [k, v] = pair.split("=");
    cookieJar[k] = v;
  }
  return Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join("; ");
}

async function hit(cookie, path) {
  const t0 = performance.now();
  try {
    const r = await fetch(`${BASE}${path}`, { headers: { cookie } });
    const t1 = performance.now();
    return { ms: t1 - t0, status: r.status };
  } catch (e) {
    return { ms: performance.now() - t0, status: 0, error: e.message };
  }
}

async function worker(cookie, path, deadline, ctx) {
  while (performance.now() < deadline) {
    const r = await hit(cookie, path);
    ctx.arr.push(r.ms);
    if (r.status === 200) ctx.stats.ok++;
    else if (r.status === 0) ctx.stats.netErr++;
    else ctx.stats.httpErr++;
  }
}

async function main() {
  const cookie = await login();
  const deadline = performance.now() + DURATION_MS;
  const stats = { ok: 0, netErr: 0, httpErr: 0 };
  const arr = [];
  console.log(`Load test: ${CONCURRENCY} conns × ${DURATION_MS}ms @ ${BASE}`);
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(cookie, "/api/customers?page=1&pageSize=20", deadline, { arr, stats })));
  const total = arr.length;
  const sorted = arr.sort((a, b) => a - b);
  const p = (q) => sorted[Math.floor(total * q)] ?? 0;
  const summary = {
    total,
    durationMs: DURATION_MS,
    rps: total / (DURATION_MS / 1000),
    p50: p(0.5).toFixed(1),
    p95: p(0.95).toFixed(1),
    p99: p(0.99).toFixed(1),
    max: sorted[total - 1]?.toFixed(1),
    ok: stats.ok, netErr: stats.netErr, httpErr: stats.httpErr
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
