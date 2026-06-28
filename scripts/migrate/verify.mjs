#!/usr/bin/env node
/**
 * 迁移验证脚本
 * 1) 读 PG 当前状态
 * 2) 读 CSV 旧表
 * 3) 对比行数 + 抽样 + 金额合计
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
config();

const REPORT_DIR = path.resolve("ops/legacy/reports");
mkdirSync(REPORT_DIR, { recursive: true });

function readCsv(file) {
  const text = readFileSync(file, "utf8");
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const header = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const obj = {};
    header.forEach((h, i) => (obj[h] = cells[i]));
    return obj;
  });
}

function csvCount(file) {
  return readCsv(file).length;
}

const adapter = new PrismaPg(process.env.DATABASE_URL);
  const pg = new PrismaClient({ adapter, log: ["error"] });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ": " + detail : ""}`);
}

async function main() {
  console.log("=== 验证: 行数 ===");
  const counts = {
    "PG.User": await pg.user.count(),
    "PG.Role": await pg.role.count(),
    "PG.Department": await pg.department.count(),
    "PG.Dictionary": await pg.dictionary.count(),
    "PG.Dictionary.SERVICE_TYPE": await pg.dictionary.count({ where: { category: "SERVICE_TYPE" } }),
    "PG.Dictionary.REGION": await pg.dictionary.count({ where: { category: "REGION" } }),
    "PG.Customer": await pg.customer.count(),
    "PG.ContactPerson": await pg.contactPerson.count(),
    "PG.Contract": await pg.contract.count(),
    "PG.Project": await pg.project.count(),
    "PG.Invoice": await pg.invoice.count(),
    "PG.Payment": await pg.payment.count()
  };
  console.log(counts);

  const legacy = {
    "CSV.users": csvCount("ops/legacy/csv/users.csv"),
    "CSV.depts": csvCount("ops/legacy/csv/depts.csv"),
    "CSV.areas": csvCount("ops/legacy/csv/areas.csv"),
    "CSV.companies": csvCount("ops/legacy/csv/companies.csv"),
    "CSV.services": csvCount("ops/legacy/csv/services.csv"),
    "CSV.invoices": csvCount("ops/legacy/csv/invoices.csv"),
    "CSV.collections": csvCount("ops/legacy/csv/collections.csv")
  };
  console.log(legacy);

  check("User 数量", counts["PG.User"] >= legacy["CSV.users"] + 1 /* importer */,
    `PG=${counts["PG.User"]}, CSV=${legacy["CSV.users"]} + 1 importer`);
  check("Role 数量", counts["PG.Role"] === 5, `PG=${counts["PG.Role"]} (期望 5 seed)`);
  check("Department 数量 = 5 seed + 3 legacy", counts["PG.Department"] === 8,
    `PG=${counts["PG.Department"]}`);
  check("Dictionary.SERVICE_TYPE = 10 seed + 22 legacy", counts["PG.Dictionary.SERVICE_TYPE"] === 32,
    `PG=${counts["PG.Dictionary.SERVICE_TYPE"]}`);
  check("Dictionary.REGION = 26 legacy", counts["PG.Dictionary.REGION"] === 26,
    `PG=${counts["PG.Dictionary.REGION"]}`);
  check("Customer 数量", counts["PG.Customer"] === legacy["CSV.companies"],
    `PG=${counts["PG.Customer"]}, CSV=${legacy["CSV.companies"]}`);
  check("Contract 数量", counts["PG.Contract"] === legacy["CSV.services"],
    `PG=${counts["PG.Contract"]}, CSV=${legacy["CSV.services"]}`);
  check("Project 数量", counts["PG.Project"] === legacy["CSV.services"],
    `PG=${counts["PG.Project"]}, CSV=${legacy["CSV.services"]}`);
  check("Invoice 数量", counts["PG.Invoice"] === legacy["CSV.invoices"],
    `PG=${counts["PG.Invoice"]}, CSV=${legacy["CSV.invoices"]}`);
  // Payment: 1 条 ≤ 0 过滤
  check("Payment 数量 = collections - 1(≤0 过滤)", counts["PG.Payment"] === legacy["CSV.collections"] - 1,
    `PG=${counts["PG.Payment"]}, CSV=${legacy["CSV.collections"]} - 1`);

  // 抽样对比
  console.log("\n=== 验证: 抽样对比 ===");
  const sampleCustomers = await pg.customer.findMany({ take: 5, orderBy: { code: "asc" } });
  for (const c of sampleCustomers) {
    console.log(`  PG.Customer[${c.code}] name=${c.name} province=${c.province} city=${c.city}`);
  }

  const sampleContracts = await pg.contract.findMany({ take: 5, orderBy: { signDate: "desc" } });
  for (const ct of sampleContracts) {
    console.log(`  PG.Contract[${ct.contractNo}] customer=${ct.customerName} type=${ct.serviceType} amount=${ct.totalAmount} status=${ct.status}`);
  }

  const sampleInvoices = await pg.invoice.findMany({ take: 5, orderBy: { applyDate: "desc" } });
  for (const inv of sampleInvoices) {
    console.log(`  PG.Invoice[${inv.invoiceNo}] amount=${inv.amount} contractId=${inv.contractId} status=${inv.status}`);
  }

  const samplePayments = await pg.payment.findMany({ take: 5, orderBy: { receivedAt: "desc" } });
  for (const p of samplePayments) {
    console.log(`  PG.Payment[${p.paymentNo}] amount=${p.amount} contractId=${p.contractId} invoiceId=${p.invoiceId}`);
  }

  // 金额合计
  console.log("\n=== 验证: 金额合计 ===");
  const totalContract = await pg.contract.aggregate({ _sum: { totalAmount: true } });
  const totalInvoice = await pg.invoice.aggregate({ _sum: { amount: true } });
  const totalPayment = await pg.payment.aggregate({ _sum: { amount: true } });
  console.log(`  Contracts totalAmount = ${totalContract._sum.totalAmount}`);
  console.log(`  Invoices amount = ${totalInvoice._sum.amount}`);
  console.log(`  Payments amount = ${totalPayment._sum.amount}`);

  // 服务类型 22 legacy 全部入库
  console.log("\n=== 验证: LEGACY-* 服务类型 ===");
  const legacyDict = await pg.dictionary.findMany({
    where: { category: "SERVICE_TYPE", code: { startsWith: "LEGACY-" } }
  });
  check("LEGACY-* 字典 = 22", legacyDict.length === 22, `实际 ${legacyDict.length}`);

  // 抽样: 任意 Contract.serviceType 都能查到
  const sampleContractType = await pg.contract.findFirst({
    where: { serviceType: { startsWith: "LEGACY-" } },
    select: { serviceType: true }
  });
  if (sampleContractType) {
    const dict = await pg.dictionary.findUnique({
      where: { category_code: { category: "SERVICE_TYPE", code: sampleContractType.serviceType } }
    });
    check("Contract.serviceType LEGACY-* 字典可查", !!dict, dict ? `→ ${dict.label}` : "查不到");
  }

  // 老合同没开 workflow
  const contractWithWorkflow = await pg.project.count({
    where: { taskInstances: { some: {} } }
  });
  check("老合同未自动开 workflow", contractWithWorkflow === 0,
    `Project with taskInstances: ${contractWithWorkflow}`);

  // 写报告
  const reportPath = path.join(REPORT_DIR, "verify-report.json");
  writeFileSync(reportPath, JSON.stringify({ counts, legacy, results, totalContract, totalInvoice, totalPayment }, null, 2));
  console.log(`\n📄 报告: ${reportPath}`);

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n=== ${passed}/${results.length} 通过 ===`);
  if (passed < results.length) process.exit(1);

  await pg.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
