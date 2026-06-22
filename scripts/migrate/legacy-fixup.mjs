#!/usr/bin/env node
/**
 * 迁移后 fixup:
 *   A) Payment.invoiceId 180 天窗口重配（之前 30 天太窄）
 *   B) Customer.province/city/town 用旧 areas 字典重新反查
 *   C) 无 phone 的客户建 ContactPerson（用 c.Contacts 占位 phone=未提供）
 *
 * 全部 idempotent，可以反复跑。
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import mysql from "mysql2/promise";
import { config } from "dotenv";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

config();

const REPORT_DIR = path.resolve("ops/legacy/reports");
mkdirSync(REPORT_DIR, { recursive: true });
const report = { startedAt: new Date().toISOString(), stages: {} };

const adapter = new PrismaPg(process.env.DATABASE_URL);
const pg = new PrismaClient({ adapter, log: ["error"] });

const my = await mysql.createConnection({
  host: "127.0.0.1",
  port: 3307,
  user: "root",
  password: "root123",
  database: "fineuicorecontext",
  charset: "utf8mb4"
});

const [companies] = await my.query("SELECT ID, Contacts, Phone, AreaID FROM companies");
console.log(`[LOAD] companies=${companies.length}`);

// ============================================================
// A) Payment.invoiceId 180 天窗口重配
// ============================================================
{
  const t0 = Date.now();
  const MS180 = 180 * 24 * 3600 * 1000;
  // 缓存所有 invoice 按 contractId 分组
  const allInvoices = await pg.invoice.findMany({
    select: { id: true, contractId: true, applyDate: true, invoiceNo: true }
  });
  const invByContract = new Map();
  for (const inv of allInvoices) {
    if (!invByContract.has(inv.contractId)) invByContract.set(inv.contractId, []);
    invByContract.get(inv.contractId).push(inv);
  }
  // 找出当前 invoiceId 为空 的 payment
  const payments = await pg.payment.findMany({
    where: { invoiceId: null, deletedAt: null },
    select: { id: true, contractId: true, receivedAt: true, amount: true }
  });
  console.log(`[A] 候选 payment (invoiceId=null): ${payments.length}`);
  let matched = 0;
  let stillUnmatched = 0;
  for (const p of payments) {
    const cands = invByContract.get(p.contractId) || [];
    let best = null;
    let bestDist = Infinity;
    for (const inv of cands) {
      const dist = Math.abs(inv.applyDate.getTime() - p.receivedAt.getTime());
      if (dist <= MS180 && dist < bestDist) {
        best = inv;
        bestDist = dist;
      }
    }
    if (best) {
      await pg.payment.update({ where: { id: p.id }, data: { invoiceId: best.id } });
      matched++;
    } else {
      stillUnmatched++;
    }
  }
  report.stages.A = { paymentsReExamined: payments.length, matched, stillUnmatched, ms: Date.now() - t0 };
  console.log(`[A] ✅ 重新配对: matched=${matched}, stillUnmatched=${stillUnmatched}, ${Date.now() - t0}ms`);
}

// ============================================================
// B) Customer.province/city/town 用旧 areas 字典重新反查
// ============================================================
{
  const t0 = Date.now();
  const [areas] = await my.query("SELECT * FROM areas");
  // 缓存 areas id -> 记录
  const areaById = new Map(areas.map((a) => [a.ID, a]));

  function lookup(areaId) {
    const a = areaById.get(areaId);
    if (!a) return { province: "未知", city: "未知", town: null };
    if (a.ParentID == null) {
      // 顶级：默认浙江省（杭州/余杭等都在浙江）
      return { province: "浙江省", city: a.Name, town: null };
    }
    const p = areaById.get(a.ParentID);
    if (!p) {
      return { province: "浙江省", city: a.Name, town: null };
    }
    if (p.ParentID == null) {
      // 子级（区/县）
      return { province: "浙江省", city: a.Name, town: null };
    }
    // 孙级（街道/镇）
    return { province: "浙江省", city: p.Name, town: a.Name };
  }

  const customers = await pg.customer.findMany({ select: { id: true, code: true, name: true, address: true } });
  let updated = 0;
  let unchanged = 0;
  for (const c of customers) {
    // 找到旧 companies 记录（按 name 匹配）
    const old = companies.find((x) => x.Name === c.name || c.name.startsWith(x.Name + " "));
    if (!old || !old.AreaID) {
      unchanged++;
      continue;
    }
    const next = lookup(old.AreaID);
    const current = await pg.customer.findUnique({ where: { id: c.id }, select: { province: true, city: true, town: true } });
    if (current.province === next.province && current.city === next.city && (current.town ?? null) === next.town) {
      unchanged++;
      continue;
    }
    await pg.customer.update({
      where: { id: c.id },
      data: { province: next.province, city: next.city, town: next.town }
    });
    updated++;
  }
  report.stages.B = { customersReExamined: customers.length, updated, unchanged, ms: Date.now() - t0 };
  console.log(`[B] ✅ province/city/town: updated=${updated}, unchanged=${unchanged}, ${Date.now() - t0}ms`);
}

// ============================================================
// C) 无 phone 客户补建 ContactPerson（用 c.Contacts 作 name）
// ============================================================
{
  const t0 = Date.now();
  const customers = await pg.customer.findMany({
    where: { contacts: { none: {} } },
    select: { id: true, name: true, contactPhone: true, contactName: true }
  });
  console.log(`[C] 候选 customer (无 contact): ${customers.length}`);

  // 按 name 在 companies 里找
  let created = 0;
  let skipped = 0;
  for (const c of customers) {
    const old = companies.find((x) => x.Name === c.name || c.name.startsWith(x.Name + " "));
    if (!old || !old.Contacts || String(old.Contacts).trim() === "") {
      skipped++;
      continue;
    }
    const contactName = String(old.Contacts).trim();
    // 已有 customer.contactName 的不覆盖
    const name = c.contactName || contactName;
    await pg.contactPerson.create({
      data: {
        customerId: c.id,
        name,
        phone: "未提供",
        isPrimary: true,
        remark: "无 phone 补建 (legacy-fixup)",
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });
    created++;
  }
  report.stages.C = { customersReExamined: customers.length, created, skipped, ms: Date.now() - t0 };
  console.log(`[C] ✅ ContactPerson 补建: created=${created}, skipped=${skipped}, ${Date.now() - t0}ms`);
}

report.finishedAt = new Date().toISOString();
const reportPath = path.join(REPORT_DIR, "fixup-report.json");
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`📄 报告: ${reportPath}`);

await my.end();
await pg.$disconnect();
