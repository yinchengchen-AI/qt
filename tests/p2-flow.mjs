// P2 端到端：消息链路 + 统计 + 导出 + 软删
import { writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const DEV_PASSWORD = process.env.DEV_QUICK_FILL_PASSWORD ?? 'dev-only-fill';
const results = [];
const start = Date.now();

function log(stage, ok, info = "") {
  const tag = ok ? "✅" : "❌";
  console.log(`${tag} ${stage}${info ? " — " + info : ""}`);
  results.push({ stage, ok, info });
}

class Session {
  constructor(name) { this.name = name; this.cookie = ""; }
  async req(path, init = {}) {
    const headers = { ...(init.headers || {}), ...(this.cookie ? { cookie: this.cookie } : {}) };
    if (init.body && typeof init.body === "object" && !init.body.__raw) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(init.body);
    }
    const res = await fetch(BASE + path, { ...init, headers, redirect: "manual" });
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);
    for (const c of set) {
      const pair = c.split(";")[0];
      const nm = pair.split("=")[0];
      const cur = this.cookie ? this.cookie.split("; ") : [];
      const filtered = cur.filter((p) => !p.startsWith(nm + "="));
      filtered.push(pair);
      this.cookie = filtered.join("; ");
    }
    const ct = res.headers.get("content-type") || "";
    let body;
    if (ct.includes("json")) body = await res.json();
    else if (ct.includes("spreadsheet") || ct.includes("octet")) body = { __blob: true, status: res.status, contentLength: res.headers.get("content-length") };
    else body = await res.text();
    return { status: res.status, body, headers: res.headers };
  }
  async login(employeeNo, password) {
    const csrf = await this.req("/api/auth/csrf");
    const fd = new URLSearchParams({ csrfToken: csrf.body.csrfToken, employeeNo, password, callbackUrl: "/dashboard", json: "true" });
    const r = await fetch(BASE + "/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: this.cookie },
      body: fd.toString(),
      redirect: "manual"
    });
    const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    for (const c of set) {
      const pair = c.split(";")[0];
      const nm = pair.split("=")[0];
      const cur = this.cookie ? this.cookie.split("; ") : [];
      const filtered = cur.filter((p) => !p.startsWith(nm + "="));
      filtered.push(pair);
      this.cookie = filtered.join("; ");
    }
    const me = await this.req("/api/auth/me");
    return me.body?.data?.user ?? me.body?.user ?? null;
  }
}


// 上传一个最小合法 PDF 并返回 attachments 数组元素(走真 presign-upload + PUT,与生产链路一致)
// 用法: const att = await uploadTestAttachment(admin, '盖章.pdf');
async function uploadTestAttachment(session, name = 'test.pdf') {
  const fakePdfBytes = new TextEncoder().encode(
    "%PDF-1.4\n" +
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n" +
    "4 0 obj<</Length 56>>stream\n" +
    "BT /F1 24 Tf 100 700 Td (Hello E2E) Tj ET\n" +
    "endstream\nendobj\n" +
    "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n" +
    "xref\n0 6\n" +
    "0000000000 65535 f \n0000000009 00000 n \n0000000056 00000 n \n" +
    "0000000111 00000 n \n0000000218 00000 n \n0000000330 00000 n \n" +
    "trailer<</Size 6/Root 1 0 R>>\nstartxref\n394\n%%EOF\n"
  );
  const presign = await session.req("/api/files/presign-upload", {
    method: "POST",
    body: { filename: name, mimeType: "application/pdf", size: fakePdfBytes.byteLength }
  });
  if (presign.status !== 200 || presign.body?.code !== 0) {
    throw new Error("presign-upload 失败: " + JSON.stringify(presign.body));
  }
  const { attachmentId, url } = presign.body.data;
  const put = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/pdf", "content-length": String(fakePdfBytes.byteLength) },
    body: fakePdfBytes
  });
  if (!put.ok) throw new Error("PUT MinIO 失败: HTTP " + put.status);
  return {
    id: attachmentId,
    name,
    mimeType: "application/pdf",
    size: fakePdfBytes.byteLength,
    uploadedBy: "admin",
    uploadedAt: new Date().toISOString()
  };
}


const admin = new Session("admin");
const sales = new Session("sales");

try {
  const meAdmin = await admin.login(`admin`, `${DEV_PASSWORD}`);
  log("admin login", !!meAdmin?.id, `id=${meAdmin?.id}`);
  const meSales = await sales.login(`sales`, `${DEV_PASSWORD}`);
  log("sales login", !!meSales?.id, `id=${meSales?.id}`);

  // 1. 消息：合同 submit 后给 admin 发 CONTRACT_PENDING_REVIEW
  const stamp = Date.now();
  const newCust = await admin.req("/api/customers", { method: "POST", body: { name: `P2客户-${stamp}`, customerType: "ENTERPRISE", province: "浙江", city: "杭州", address: "西湖区", contactPhone: "13800000001" } });
  const cid = newCust.body?.data?.id;
  await admin.req(`/api/customers/${cid}`, { method: "PATCH", body: { status: "NEGOTIATING" } });
  const newC = await admin.req("/api/contracts", { method: "POST", body: { customerId: cid, contractNo: `QT-HT-P2-${stamp}`, title: "P2 消息测试合同", serviceType: "SAFETY_CONSULT", signDate: new Date().toISOString(), startDate: new Date().toISOString(), endDate: new Date(Date.now() + 90 * 86400_000).toISOString(), totalAmount: 50000, taxRate: 0.06, paymentMethod: "LUMP_SUM", attachments: [await uploadTestAttachment(admin, "盖章.pdf")] } });
  const contractId = newC.body?.data?.id;
  // 提交
  await admin.req(`/api/contracts/${contractId}/submit`, { method: "POST" });
  // 检查 admin 收件箱
  const m1 = await admin.req("/api/messages?page=1&pageSize=5&unread=true");
  log("admin 收到 CONTRACT_PENDING_REVIEW", m1.status === 200 && m1.body?.data?.unreadCount >= 1, `unreadCount=${m1.body?.data?.unreadCount} list[0].type=${m1.body?.data?.list[0]?.type}`);

  // 2. SALES 收不到 admin 创建的合同提醒（用 admin 创建的合同，owner = admin）
  const m2 = await sales.req("/api/messages?page=1&pageSize=5&unread=true");
  const salesHasPending = (m2.body?.data?.list ?? []).some((x) => x.type === "CONTRACT_PENDING_REVIEW" && x.link?.id === contractId);
  log("SALES 收件箱不包含该通知", !salesHasPending, `SALES 待审通知=${salesHasPending}`);

  // 3. 标记单条已读
  const msgId = m1.body?.data?.list[0]?.id;
  if (msgId) {
    const r = await admin.req(`/api/messages/${msgId}`, { method: "PATCH" });
    log("标记已读", r.status === 200 && r.body?.data?.readAt, `readAt=${r.body?.data?.readAt}`);
  }

  // 4. 全部标记已读
  const r2 = await admin.req("/api/messages/mark-all-read", { method: "POST" });
  log("全部标记已读", r2.status === 200, `updated=${r2.body?.data?.updated}`);

  // 5. 触发 jobs（应 200，但 created=0 因为无超期数据）
  const jobs = await admin.req("/api/jobs/run-all", { method: "POST" });
  log("jobs/run-all 调用", jobs.status === 200 && Array.isArray(jobs.body?.data?.results) && jobs.body.data.results.length === 4, `results=${jobs.body?.data?.results?.length}`);

  // 6. 非 ADMIN 不能调 jobs
  const jobs2 = await sales.req("/api/jobs/run-all", { method: "POST" });
  log("SALES 调 jobs 拒绝", jobs2.status === 403, `status=${jobs2.status} code=${jobs2.body?.errorCode}`);

  // 7. 统计：总览接口
  const ov = await admin.req("/api/statistics/overview");
  log("统计总览", ov.status === 200 && typeof ov.body?.data?.overview?.contractAmount === "number", `contractAmount=${ov.body?.data?.overview?.contractAmount}`);
  log("时间序列长度", Array.isArray(ov.body?.data?.series), `series.length=${ov.body?.data?.series?.length}`);

  // 8. 统计：账龄
  const ag = await admin.req("/api/statistics/invoice-aging");
  log("账龄分析", ag.status === 200 && typeof ag.body?.data?.buckets === "object", `0-30=${ag.body?.data?.buckets?.["0-30"]}`);

  // 9. 统计：Top 客户
  const top = await admin.req("/api/statistics/top-customers?metric=contract&limit=5");
  log("Top 客户", top.status === 200 && Array.isArray(top.body?.data), `count=${top.body?.data?.length}`);

  // 10. 统计：员工业绩
  const perf = await admin.req("/api/statistics/employee-performance");
  log("员工业绩", perf.status === 200 && Array.isArray(perf.body?.data), `count=${perf.body?.data?.length}`);

  // 11. xlsx 导出：overview
  const exp1 = await admin.req("/api/statistics/export?type=overview");
  log("xlsx 导出 overview", exp1.status === 200 && exp1.body?.__blob, `status=${exp1.status} contentLength=${exp1.body?.contentLength}`);

  // 12. xlsx 导出：top-customers
  const exp2 = await admin.req("/api/statistics/export?type=top-customers&metric=contract");
  log("xlsx 导出 top-customers", exp2.status === 200 && exp2.body?.__blob, `status=${exp2.status} contentLength=${exp2.body?.contentLength}`);

  // 13. SALES 调 export overview 允许（EXPORT 权限在 stats 上）
  const exp3 = await sales.req("/api/statistics/export?type=overview");
  log("SALES 调 export overview 被拒", exp3.status === 403, `status=${exp3.status} (设计: SALES STATISTICS=R 无 EXPORT)`);

  // 14. 软删：无活跃合同的客户
  // 先建一个无合同的客户
  const c3 = await admin.req("/api/customers", { method: "POST", body: { name: "P2 软删目标", customerType: "ENTERPRISE", province: "浙江", city: "杭州", address: "测试", contactPhone: "13800000099" } });
  const targetId = c3.body?.data?.id;
  const del = await admin.req(`/api/customers/${targetId}`, { method: "DELETE" });
  log("软删无活跃合同客户", del.status === 200, `status=${del.status}`);
  // 再次 GET 应该 404
  const get = await admin.req(`/api/customers/${targetId}`);
  log("软删后查不到", get.status === 404, `status=${get.status}`);

  // 15. 软删：有合同客户应拒绝（先把合同 approve 为 EFFECTIVE）
  await admin.req(`/api/contracts/${contractId}/approve`, { method: "POST", body: { comment: "OK" } });
  const del2 = await admin.req(`/api/customers/${cid}`, { method: "DELETE" });
  log("软删有合同客户拒绝", del2.status === 403, `status=${del2.status} code=${del2.body?.errorCode}`);

  // 16. SALES 软删：行级隔离（admin 创建的 cid，sales 看不到，软删应 404）
  const del3 = await sales.req(`/api/customers/${cid}`, { method: "DELETE" });
  log("SALES 软删他人客户", del3.status === 403 || del3.status === 404, `status=${del3.status}`);

  // 17. Dashboard summary
  const dash = await admin.req("/api/dashboard/summary");
  log("Dashboard summary", dash.status === 200 && typeof dash.body?.data?.overview?.contractAmount === "number", `contractAmount=${dash.body?.data?.overview?.contractAmount}`);

} catch (e) {
  log("FATAL", false, e.message + "\n" + e.stack);
}

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);
const summary = `\n===== 总结 =====\n通过 ${passed} / ${results.length}，失败 ${failed.length}，耗时 ${elapsed}s\n`;
console.log(summary);
writeFileSync("/tmp/p2-result.json", JSON.stringify({ passed, total: results.length, failed: failed.length, results }, null, 2));
process.exit(failed.length > 0 ? 1 : 0);
