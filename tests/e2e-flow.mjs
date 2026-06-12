// 杭州企泰 P1 端到端测试（Node 18+；fetch + cookie jar）
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:3000';
const results = [];
const start = Date.now();

function log(stage, ok, info = '') {
  const tag = ok ? '✅' : '❌';
  const line = `${tag} ${stage}${info ? ' — ' + info : ''}`;
  console.log(line);
  results.push({ stage, ok, info });
}

class Session {
  constructor(name) { this.name = name; this.cookie = ''; }
  async req(path, init = {}) {
    const headers = { ...(init.headers || {}), ...(this.cookie ? { cookie: this.cookie } : {}) };
    if (init.body && typeof init.body === 'object' && !init.body.__raw) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(init.body);
    }
    const res = await fetch(BASE + path, { ...init, headers, redirect: 'manual' });
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : (() => { const v = res.headers.get('set-cookie'); return v ? [v] : []; })();
    if (set && set.length) {
      const cur = this.cookie ? this.cookie.split('; ') : [];
      for (const c of set) {
        const pair = c.split(';')[0];
        const nm = pair.split('=')[0];
        // 去掉旧同名，追加新的
        const filtered = cur.filter(p => !p.startsWith(nm + '='));
        filtered.push(pair);
        // 用 cur 变量重置（注意作用域）
        cur.length = 0;
        cur.push(...filtered);
      }
      this.cookie = cur.join('; ');
    }
    let body;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) body = await res.json();
    else body = await res.text();
    return { status: res.status, body };
  }
  async login(employeeNo, password) {
    const csrf = await this.req('/api/auth/csrf');
    const csrfToken = csrf.body.csrfToken;
    const fd = new URLSearchParams({ csrfToken, employeeNo, password, callbackUrl: '/dashboard', json: 'true' });
    const r = await fetch(BASE + '/api/auth/callback/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: this.cookie },
      body: fd.toString(),
      redirect: 'manual',
    });
    const set2 = r.headers.getSetCookie ? r.headers.getSetCookie() : (() => { const v = r.headers.get('set-cookie'); return v ? [v] : []; })();
    if (set2 && set2.length) {
      const cur = this.cookie ? this.cookie.split('; ') : [];
      for (const c of set2) {
        const pair = c.split(';')[0];
        const nm = pair.split('=')[0];
        const filtered = cur.filter(p => !p.startsWith(nm + '='));
        filtered.push(pair);
        cur.length = 0; cur.push(...filtered);
      }
      this.cookie = cur.join('; ');
    }
    const me = await this.req("/api/auth/me");
    return me.body?.data?.user ?? me.body?.user ?? null;
  }
}

const admin = new Session('admin');
const sales = new Session('sales');

try {
  const meAdmin = await admin.login('admin', '123456');
  log('admin login', !!meAdmin?.id, `id=${meAdmin?.id} role=${meAdmin?.roleCode}`);

  // 上游把 createContract 改为 resolveAttachmentSnapshots:前端传的 attachment.id 必须在 Attachment 表里真实存在
  // 走真 presign-upload + PUT 流程(MinIO 必须已起;不起则 fail-fast 报 503)
  const stampAttach = Date.now();
  const fakePdfName = `e2e-contract-${stampAttach}.pdf`;
  // 一个最小但合法的 PDF-1.4(1 页 / Helvetica "Hello E2E")
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
  const presignRes = await admin.req('/api/files/presign-upload', {
    method: 'POST',
    body: {
      filename: fakePdfName,
      mimeType: 'application/pdf',
      size: fakePdfBytes.byteLength
    }
  });
  if (presignRes.status !== 200 || presignRes.body?.code !== 0) {
    log('setup attachment (presign)', false, `status=${presignRes.status} body=${JSON.stringify(presignRes.body).slice(0, 200)}`);
    throw new Error('presign-upload 失败,需先 docker compose -f docker-compose.minio.yml up -d 并在 .env 配好 MINIO_*');
  }
  const { attachmentId: e2eAttachmentId, url: e2ePutUrl } = presignRes.body.data;
  const putRes = await fetch(e2ePutUrl, {
    method: 'PUT',
    headers: { 'content-type': 'application/pdf', 'content-length': String(fakePdfBytes.byteLength) },
    body: fakePdfBytes
  });
  if (!putRes.ok) {
    log('setup attachment (PUT MinIO)', false, `status=${putRes.status}`);
    throw new Error('PUT 到 MinIO 失败');
  }
  log('setup attachment', !!e2eAttachmentId, `id=${e2eAttachmentId}`);
  const meSales = await sales.login('sales', '123456');
  log('sales login', !!meSales?.id, `id=${meSales?.id} role=${meSales?.roleCode}`);

  const badCredit = await admin.req('/api/customers', {
    method: 'POST',
    body: { name: 'E2E-坏信用码', customerType: 'ENTERPRISE',
      unifiedSocialCreditCode: '12345678901234567X',
      contactPhone: '13800000001', province: '浙江', city: '杭州', address: '西湖区' },
  });
  log('R-01 信用代码校验', badCredit.status === 400, `status=${badCredit.status} code=${badCredit.body?.errorCode}`);

  const stamp = Date.now();
  const newCust = await admin.req('/api/customers', {
    method: 'POST',
    body: { name: `E2E客户-${stamp}`, customerType: 'ENTERPRISE', industry: '安全咨询', scale: 'MEDIUM',
      province: '浙江', city: '杭州', address: '西湖区文三路 100 号',
      contactPhone: '13800000002', contactEmail: 'cust@e2e.com',
      level: 'C' },
  });
  const customerId = newCust.body?.data?.id;
  log('create customer', newCust.status === 200 && !!customerId, `status=${newCust.status} id=${customerId} code=${newCust.body?.data?.code}`);

  const signEarly = await admin.req(`/api/customers/${customerId}`, { method: 'PATCH', body: { status: 'SIGNED' } });
  log('R-02 SIGNED 需合同', signEarly.status >= 400, `status=${signEarly.status} code=${signEarly.body?.errorCode}`);

  await admin.req(`/api/customers/${customerId}`, { method: 'PATCH', body: { status: 'NEGOTIATING' } });

  const newContract = await admin.req('/api/contracts', {
    method: 'POST',
    body: { customerId, title: 'E2E 安全咨询服务合同', serviceType: 'SAFETY_CONSULT',
      signDate: new Date().toISOString(),
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 90 * 86400_000).toISOString(),
      totalAmount: 100000, taxRate: 0.06, paymentMethod: 'BY_PHASE',
      attachments: [{ id: e2eAttachmentId, name: '盖章合同.pdf', url: 'https://files.example.com/contract-1.pdf', mimeType: 'application/pdf', size: 1024, uploadedBy: 'admin', uploadedAt: new Date().toISOString() }] },
  });
  const contractId = newContract.body?.data?.id;
  log('create contract', newContract.status === 200 && !!contractId, `status=${newContract.status} id=${contractId} no=${newContract.body?.data?.contractNo}`);

  const c2 = await admin.req('/api/contracts', {
    method: 'POST',
    body: { customerId, title: 'E2E 缺附件合同', serviceType: 'SAFETY_TRAIN',
      signDate: new Date().toISOString(), startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 60 * 86400_000).toISOString(),
      totalAmount: 50000, taxRate: 0.06, paymentMethod: 'LUMP_SUM', attachments: [] },
  });
  const c2Id = c2.body?.data?.id;
  await admin.req(`/api/contracts/${c2Id}/submit`, { method: 'POST' });
  const approve2 = await admin.req(`/api/contracts/${c2Id}/approve`, { method: 'POST', body: { comment: 'no attach' } });
  log('R-04 缺附件 EFFECTIVE 拒绝', approve2.status >= 400, `status=${approve2.status} code=${approve2.body?.errorCode}`);

  const submit = await admin.req(`/api/contracts/${contractId}/submit`, { method: 'POST' });
  log('contract submit → PENDING_REVIEW', submit.status === 200 && submit.body?.data?.status === 'PENDING_REVIEW', `status=${submit.body?.data?.status}`);
  const approve = await admin.req(`/api/contracts/${contractId}/approve`, { method: 'POST', body: { comment: 'OK' } });
  log('contract approve → EFFECTIVE', approve.status === 200 && approve.body?.data?.status === 'EFFECTIVE', `status=${approve.body?.data?.status}`);

  const newProj = await admin.req('/api/projects', {
    method: 'POST',
    body: { contractId, name: `E2E 项目-A-${stamp}`, serviceScope: '安全评估',
      managerUserId: meAdmin.id, startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 60 * 86400_000).toISOString(), budgetAmount: 80000 },
  });
  const projectId = newProj.body?.data?.id;
  log('create project', newProj.status === 200 && !!projectId, `id=${projectId} no=${newProj.body?.data?.projectNo}`);

  const badProj = await admin.req('/api/projects', {
    method: 'POST',
    body: { contractId, name: `E2E 超期项目-${stamp}`, serviceScope: '超期', managerUserId: meAdmin.id,
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 365 * 86400_000).toISOString() },
  });
  log('R-06 项目 endDate 超合同', badProj.status >= 400, `status=${badProj.status} code=${badProj.body?.errorCode}`);

  const start_ = await admin.req(`/api/projects/${projectId}/start`, { method: 'POST' });
  log('project start → IN_PROGRESS', start_.status === 200 && start_.body?.data?.status === 'IN_PROGRESS', `status=${start_.body?.data?.status}`);

  // R-17 门控:deliver 前必须先处理所有 requiresDeliverable=true 的任务
  // 1) 未处理时 deliver 应被拒
  const deliverEarly = await admin.req(`/api/projects/${projectId}/deliver`, { method: 'POST' });
  log('R-17 deliver 必交付未完 → 拒', deliverEarly.status === 422 && deliverEarly.body?.errorCode === 'PROJECT_DELIVERABLES_INCOMPLETE', `status=${deliverEarly.status} code=${deliverEarly.body?.errorCode}`);

  // 2) 跳过所有 requiresDeliverable=true 且未完成的任务
  const wf = await admin.req(`/api/projects/${projectId}/workflow`, { method: 'GET' });
  const allTasks = (wf.body?.data?.stages ?? []).flatMap((s) => s.tasks ?? []);
  const pendingDeliverables = allTasks.filter((t) => t.requiresDeliverable && t.status !== 'COMPLETED' && t.status !== 'SKIPPED');
  for (const t of pendingDeliverables) {
    const r = await admin.req(`/api/workflow-tasks/${t.id}/action`, { method: 'POST', body: { action: 'skip', remark: 'e2e prep' } });
    if (r.status !== 200) console.log('skip failed', t.code, r.status, JSON.stringify(r.body));
  }

  const deliver = await admin.req(`/api/projects/${projectId}/deliver`, { method: 'POST' });
  log('project deliver → DELIVERED', deliver.status === 200 && deliver.body?.data?.status === 'DELIVERED', `status=${deliver.body?.data?.status}`);

  const accept = await admin.req(`/api/projects/${projectId}/accept`, { method: 'POST' });
  log('project accept → ACCEPTED', accept.status === 200 && accept.body?.data?.status === 'ACCEPTED', `status=${accept.body?.data?.status}`);

  const close = await admin.req(`/api/projects/${projectId}/close`, { method: 'POST' });
  log('project close → CLOSED', close.status === 200 && close.body?.data?.status === 'CLOSED', `status=${close.body?.data?.status}`);

  const newInv = await admin.req('/api/invoices', {
    method: 'POST',
    body: { contractId, customerId, invoiceType: 'VAT_SPECIAL',
      amount: 60000, taxRate: 0.06, applyDate: new Date().toISOString(),
      titleType: 'COMPANY', titleName: 'E2E客户测试有限公司', taxNo: '91110000600037341L',
      bankName: '工行', bankAccount: '6222021234567890', address: '杭州', phone: '13800000002' },
  });
  const invoiceId = newInv.body?.data?.id;
  log('create invoice', newInv.status === 200 && !!invoiceId, `id=${invoiceId} no=${newInv.body?.data?.invoiceNo}`);

  const invSubmit = await admin.req(`/api/invoices/${invoiceId}/submit`, { method: 'POST' });
  log('invoice submit → PENDING_FINANCE', invSubmit.status === 200 && invSubmit.body?.data?.status === 'PENDING_FINANCE', `status=${invSubmit.body?.data?.status}`);

  const issue = await admin.req(`/api/invoices/${invoiceId}/issue`, { method: 'POST', body: { invoiceCode: '123456789012', invoiceNo20: '12345678901234567890' } });
  log('invoice issue → ISSUED', issue.status === 200 && issue.body?.data?.status === 'ISSUED', `status=${issue.body?.data?.status}`);

  const overInv = await admin.req('/api/invoices', {
    method: 'POST',
    body: { contractId, customerId, invoiceType: 'VAT_SPECIAL',
      amount: 99999999, taxRate: 0.06, applyDate: new Date().toISOString(),
      titleType: 'COMPANY', titleName: '超限测试', taxNo: '91110000600037341L' },
  });
  log('R-08 开票超限', overInv.status >= 400, `status=${overInv.status} code=${overInv.body?.errorCode}`);

  const newPay = await admin.req('/api/payments', {
    method: 'POST',
    body: { customerId, contractId, invoiceId, amount: 60000,
      receivedAt: new Date().toISOString(), method: 'BANK_TRANSFER', bankRefNo: 'E2E-BANK-' + stamp },
  });
  const paymentId = newPay.body?.data?.id;
  log('create payment', newPay.status === 200 && !!paymentId, `id=${paymentId} no=${newPay.body?.data?.paymentNo} bankRefNo=${newPay.body?.data?.bankRefNo}`);

  const confirm = await admin.req(`/api/payments/${paymentId}/confirm`, { method: 'POST' });
  log('payment confirm → CONFIRMED', confirm.status === 200 && confirm.body?.data?.status === 'CONFIRMED', `status=${confirm.body?.data?.status}`);

  const dupRef = await admin.req('/api/payments', {
    method: 'POST',
    body: { customerId, contractId, invoiceId, amount: 100,
      receivedAt: new Date().toISOString(), method: 'BANK_TRANSFER', bankRefNo: 'E2E-BANK-' + stamp },
  });
  log('R-10 bankRefNo 重复 (PLANNED 允许)', dupRef.status === 200, `status=${dupRef.status}`);
  const dupId = dupRef.body?.data?.id;
  const dupConfirm = await admin.req(`/api/payments/${dupId}/confirm`, { method: 'POST' });
  log('R-10 bankRefNo 重复 confirm 拒绝', dupConfirm.status >= 400, `status=${dupConfirm.status} code=${dupConfirm.body?.errorCode}`);

  const tryFrozen = await admin.req(`/api/customers/${customerId}`, { method: 'PATCH', body: { status: 'FROZEN' } });
  log('R-13 客户 FROZEN 有合同', tryFrozen.status >= 400, `status=${tryFrozen.status} code=${tryFrozen.body?.errorCode}`);

  const signOk = await admin.req(`/api/customers/${customerId}`, { method: 'PATCH', body: { status: 'SIGNED' } });
  log('R-02 SIGNED 有合同', signOk.status === 200 && signOk.body?.data?.status === 'SIGNED', `status=${signOk.body?.data?.status}`);

  const salesView = await sales.req(`/api/customers/${customerId}`);
  log('SALES 行级隔离 (admin 客户)', salesView.status === 404, `status=${salesView.status}`);

  const c1 = await admin.req('/api/customers', { method: 'POST', body: { name: 'E2E-编号测试-1', customerType: 'ENTERPRISE', contactPhone: '13800000003', province: '浙江', city: '杭州' } });
  const c2b = await admin.req('/api/customers', { method: 'POST', body: { name: 'E2E-编号测试-2', customerType: 'ENTERPRISE', contactPhone: '13800000004', province: '浙江', city: '杭州' } });
  const no1 = c1.body?.data?.code; const no2 = c2b.body?.data?.code;
  log('业务编号递增', no1 && no2 && no1 !== no2, `${no1} / ${no2}`);

} catch (e) {
  log('FATAL', false, e.message + '\n' + e.stack);
}

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok);
const summary = `\n===== 总结 =====\n通过 ${passed} / ${results.length}，失败 ${failed.length}，耗时 ${elapsed}s\n`;
console.log(summary);
writeFileSync('/tmp/e2e-result.json', JSON.stringify({ passed, total: results.length, failed: failed.length, results }, null, 2));
process.exit(failed.length > 0 ? 1 : 0);
