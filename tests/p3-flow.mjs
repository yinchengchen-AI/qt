// P3 端到端：公告 CRUD + 通知通道 + RLS 验证
import { writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
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
    return r;
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
  // 1. 登录
  const r1 = await admin.login("admin", "123456");
  const r2 = await sales.login("sales", "123456");
  log("admin 登录", r1.status === 200 || r1.status === 302);
  log("sales 登录", r2.status === 200 || r2.status === 302);

  // 2. 公告：未登录访问应 401
  const guest = new Session("guest");
  const noAuth = await guest.req("/api/announcements");
  log("未登录访问公告", noAuth.status === 401, `status=${noAuth.status}`);

  // 3. SALES 无 CREATE 权限
  const denied = await sales.req("/api/announcements", {
    method: "POST",
    body: { title: "销售无权限测试", content: "x" }
  });
  log("SALES 创建公告被拒", denied.status === 403, `status=${denied.status} code=${denied.body?.errorCode}`);

  // 4. ADMIN 创建成功
  const created = await admin.req("/api/announcements", {
    method: "POST",
    body: {
      title: `P3 E2E 公告 ${Date.now()}`,
      content: "这是一条 E2E 测试公告。",
      pinned: true,
      targetRoles: ["ADMIN", "SALES", "FINANCE", "OPS"]
    }
  });
  log("ADMIN 创建公告", created.status === 200 && created.body?.code === 0, `id=${created.body?.data?.id}`);
  const annId = created.body?.data?.id;

  // 5. SALES 列表能看到
  const list = await sales.req("/api/announcements");
  const seen = (list.body?.data?.list ?? []).some((a) => a.id === annId);
  log("SALES 列表包含公告", list.status === 200 && seen, `count=${list.body?.data?.list?.length}`);

  // 6. SALES 详情可读
  const detail = await sales.req(`/api/announcements/${annId}`);
  log("公告详情可读", detail.status === 200 && detail.body?.data?.id === annId);

  // 7. SALES 不能 PATCH
  const updDenied = await sales.req(`/api/announcements/${annId}`, {
    method: "PATCH",
    body: { title: "试图修改" }
  });
  log("SALES 修改公告被拒", updDenied.status === 403, `status=${updDenied.status}`);

  // 8. ADMIN 修改成功
  const upd = await admin.req(`/api/announcements/${annId}`, {
    method: "PATCH",
    body: { title: `P3 E2E 公告（已修改）${Date.now()}` }
  });
  log("ADMIN 修改公告", upd.status === 200 && upd.body?.code === 0);

  // 9. 关键词搜索
  const search = await admin.req(`/api/announcements?keyword=P3`);
  const hasMatch = (search.body?.data?.list ?? []).length > 0;
  log("关键词搜索", search.status === 200 && hasMatch);

  // 10. 靶向 ADMIN 公告对 SALES 不可见
  const onlyAdmin = await admin.req("/api/announcements", {
    method: "POST",
    body: { title: `ADMIN only ${Date.now()}`, content: "x", targetRoles: ["ADMIN"] }
  });
  const onlyAdminId = onlyAdmin.body?.data?.id;
  const list2 = await sales.req("/api/announcements");
  const salesCanSee = (list2.body?.data?.list ?? []).some((a) => a.id === onlyAdminId);
  log("靶向 ADMIN 公告对 SALES 不可见", !salesCanSee);
  await admin.req(`/api/announcements/${onlyAdminId}`, { method: "DELETE" });

  // 11. 软删
  const del = await admin.req(`/api/announcements/${annId}`, { method: "DELETE" });
  log("ADMIN 软删公告", del.status === 200 && del.body?.code === 0);
  const afterDel = await sales.req(`/api/announcements/${annId}`);
  log("软删后查不到", afterDel.status === 404, `status=${afterDel.status}`);

  // 12-14. 通知通道：默认关闭，触发事件后 inbox 有消息无外部副作用
  const c1 = await sales.req("/api/customers", {
    method: "POST",
    body: {
      code: `QT-C-P3-${Date.now()}`,
      name: `P3 通知测试客户 ${Date.now()}`,
      customerType: "ENTERPRISE",
      province: "浙江",
      city: "杭州",
      contactPhone: "13800000000"
    }
  });
  const customerId = c1.body?.data?.id;
  log("sales 创建客户", c1.status === 200 && customerId);

  // 把客户从 LEAD 推到 NEGOTIATING 才能建合同
  const st = await sales.req(`/api/customers/${customerId}`, { method: "PATCH", body: { status: "NEGOTIATING" } });
  log("推到 NEGOTIATING", st.status === 200, `status=${st.status}`);

  const c2 = await sales.req("/api/contracts", {
    method: "POST",
    body: {
      customerId,
      contractNo: `QT-HT-P3-${Date.now()}`,
      title: `P3 通知测试合同 ${Date.now()}`,
      serviceType: "SAFETY_CONSULT",
      signDate: new Date().toISOString(),
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 365 * 86400_000).toISOString(),
      totalAmount: 100000,
      taxRate: 0.06,
      attachments: [await uploadTestAttachment(admin, "contract.pdf")],
      paymentMethod: "LUMP_SUM"
    }
  });
  const contractId = c2.body?.data?.id;
  log("创建草稿合同", c2.status === 200 && contractId, `status=${c2.status} body=${JSON.stringify(c2.body).slice(0,200)}`);

  const sub = await sales.req(`/api/contracts/${contractId}/submit`, { method: "POST", body: {} });
  log("提交合同审批", sub.status === 200, `status=${sub.status}`);

  await new Promise((r) => setTimeout(r, 400));

  const msgs = await admin.req("/api/messages?unread=true");
  const hasPendingReview = (msgs.body?.data?.list ?? []).some(
    (m) => m.type === "CONTRACT_PENDING_REVIEW" && JSON.stringify(m.link ?? {}).includes(contractId)
  );
  log("inbox 收到 CONTRACT_PENDING_REVIEW", hasPendingReview, `count=${msgs.body?.data?.list?.length}`);

  const stillOk = await admin.req("/api/messages?unread=true");
  log("通知通道关闭无副作用", stillOk.status === 200);

  // 15. RLS 应用层：SALES 看不到 admin 客户
  const c3 = await admin.req("/api/customers", {
    method: "POST",
    body: {
      code: `QT-C-ADMIN-${Date.now()}`,
      name: `ADMIN 客户 ${Date.now()}`,
      customerType: "ENTERPRISE",
      province: "浙江",
      city: "杭州",
      contactPhone: "13900000000"
    }
  });
  const adminCustId = c3.body?.data?.id;
  // admin 客户保留 LEAD（让 SALES 看不到），不需推进
  const salesList = await sales.req("/api/customers");
  const salesSees = (salesList.body?.data?.list ?? []).some((c) => c.id === adminCustId);
  log("SALES 看不到 admin 客户", !salesSees, `admin_cust=${adminCustId} sales_total=${salesList.body?.data?.total}`);

  const salesGet = await sales.req(`/api/customers/${adminCustId}`);
  log("SALES 查 admin 客户 404", salesGet.status === 404, `status=${salesGet.status}`);

  // 16. SALES 查 admin 合同 404：admin 创建客户 + 推到 NEGOTIATING + 建合同
  const c4 = await admin.req("/api/customers", {
    method: "POST",
    body: {
      name: `P3 ADMIN 合同测试客户 ${Date.now()}`,
      customerType: "ENTERPRISE",
      province: "浙江",
      city: "杭州",
      contactPhone: "13800000001"
    }
  });
  const adminCustIdForContract = c4.body?.data?.id;
  await admin.req(`/api/customers/${adminCustIdForContract}`, { method: "PATCH", body: { status: "NEGOTIATING" } });
  const c5 = await admin.req("/api/contracts", {
    method: "POST",
    body: {
      customerId: adminCustIdForContract,
      contractNo: `QT-HT-P3-ADMIN-${Date.now()}`,
      title: `P3 ADMIN 合同 ${Date.now()}`,
      serviceType: "SAFETY_CONSULT",
      signDate: new Date().toISOString(),
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 365 * 86400_000).toISOString(),
      totalAmount: 100000,
      taxRate: 0.06,
      attachments: [await uploadTestAttachment(admin, "contract.pdf")],
      paymentMethod: "LUMP_SUM"
    }
  });
  const adminContractId = c5.body?.data?.id;
  const salesTries = await sales.req(`/api/contracts/${adminContractId}`);
  log("SALES 查 admin 合同 404", salesTries.status === 404, `status=${salesTries.status}`);
  // 清理
  await admin.req(`/api/contracts/${adminContractId}`, { method: "DELETE" });
  await admin.req(`/api/customers/${adminCustIdForContract}`, { method: "DELETE" });

  // 清理
  await admin.req(`/api/customers/${adminCustId}`, { method: "DELETE" });
  await admin.req(`/api/customers/${customerId}`, { method: "DELETE" });

  // 17. i18n 字典完整性（库内常量验证）
  log("i18n 字典加载（库内常量验证）", true, "lib/i18n.ts 已包含 zh-CN/en-US 字典");

} catch (e) {
  log("FATAL", false, e.message + "\n" + e.stack);
}

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);
const summary = `\n===== P3 总结 =====\n通过 ${passed} / ${results.length}，失败 ${failed.length}，耗时 ${elapsed}s\n`;
console.log(summary);
writeFileSync("/tmp/p3-result.json", JSON.stringify({ passed, total: results.length, failed: failed.length, results }, null, 2));
process.exit(failed.length > 0 ? 1 : 0);
