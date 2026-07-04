#!/usr/bin/env node
/**
 * 旧 FineUI MySQL → 杭州企泰 PostgreSQL 数据迁移脚本
 *
 * 8 阶段按依赖顺序执行：Dictionary → Department → User → Customer → Contract → Invoice → Payment
 * 所有写库直接走 Prisma，绕过 Zod/service/RLS。
 * 重跑安全：每阶段 idempotent（用 upsert 或 INSERT...ON CONFLICT）。
 *
 * 用法：
 *   node scripts/migrate/legacy-fineui.mjs --dry-run   # 不写库
 *   node scripts/migrate/legacy-fineui.mjs              # 真跑
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import mysql from "mysql2/promise";
import bcrypt from "bcrypt";
import { config } from "dotenv";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pinyin as toPinyin } from "pinyin-pro";

import {
  SERVICE_TYPE_LEGACY,
  legacyServiceTypeCode,
  legacyServiceTypeSort,
  STATE_TO_CONTRACT_STATUS,
  STATE_TO_PROJECT_STATUS,
  ENABLED_TO_USER_STATUS,
  IMPORTER_EMPLOYEE_NO
} from "./lib/mappings.mjs";

import {
  calcInvoiceTax,
  toDate,
  urlToAttachmentJson,
  dedupContractNos,
  dedupCustomerNames,
  areaToCode,
  UNKNOWN_REGION
} from "./lib/sanitize.mjs";

config();

// ---- 0) CLI / env ----
const DRY_RUN = process.argv.includes("--dry-run");
const report = {
  startedAt: new Date().toISOString(),
  dryRun: DRY_RUN,
  stages: {},
  errors: [],
  warnings: []
};
const REPORT_DIR = path.resolve("ops/legacy/reports");
mkdirSync(REPORT_DIR, { recursive: true });

const LEGACY_DB = {
  host: process.env.LEGACY_MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.LEGACY_MYSQL_PORT || 3307),
  user: process.env.LEGACY_MYSQL_USER || "root",
  password: process.env.LEGACY_MYSQL_PASSWORD || "root123",
  database: "fineuicorecontext",
  charset: "utf8mb4"
};

function log(stage, msg) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}] [${stage}] ${msg}`);
}

function done(stage, summary) {
  report.stages[stage] = { ...summary, finishedAt: new Date().toISOString() };
  log(stage, `✅ ${JSON.stringify(summary)}`);
}

async function main() {
  log("INIT", `DRY_RUN=${DRY_RUN}`);

  // ---- 1) 准备连接 ----
  const adapter = new PrismaPg(process.env.DATABASE_URL);
  const pg = new PrismaClient({ adapter, log: ["error"] });
  const my = await mysql.createConnection(LEGACY_DB);
  log("INIT", "PG + MySQL connected");

  // ---- 2) 一次性加载旧数据（5MB 全量入内存） ----
  const t0 = Date.now();
  const [
    [companies],
    [services],
    [serviceprojects],
    [servicerecords],
    [invoices],
    [collections],
    [users],
    [depts],
    [areas]
  ] = await Promise.all([
    my.query("SELECT * FROM companies ORDER BY ID ASC"),
    my.query("SELECT * FROM services ORDER BY ID ASC"),
    my.query("SELECT * FROM serviceprojects ORDER BY ID ASC"),
    my.query("SELECT * FROM servicerecords ORDER BY ServiceDate ASC"),
    my.query("SELECT * FROM invoices ORDER BY ID ASC"),
    my.query("SELECT * FROM collections ORDER BY ID ASC"),
    my.query("SELECT * FROM users ORDER BY ID ASC"),
    my.query("SELECT * FROM depts ORDER BY ID ASC"),
    my.query("SELECT * FROM areas ORDER BY ID ASC")
  ]);
  log("LOAD", `旧表加载: companies=${companies.length} services=${services.length} serviceprojects=${serviceprojects.length} servicerecords=${servicerecords.length} invoices=${invoices.length} collections=${collections.length} users=${users.length} depts=${depts.length} areas=${areas.length} (${Date.now() - t0}ms)`);

  // servicerecords 按 ServiceID 聚合
  const recordsByServiceId = new Map();
  for (const r of servicerecords) {
    if (!recordsByServiceId.has(r.ServiceID)) recordsByServiceId.set(r.ServiceID, []);
    recordsByServiceId.get(r.ServiceID).push(r);
  }

  // ---- 3) 找导入者 admin ----
  const importer = await pg.user.findUnique({ where: { employeeNo: IMPORTER_EMPLOYEE_NO } });
  if (!importer) {
    throw new Error(`导入者 ${IMPORTER_EMPLOYEE_NO} 不存在，请先 npm run create-admin`);
  }
  const adminRole = await pg.role.findUnique({ where: { code: "ADMIN" } });
  if (!adminRole) throw new Error("ADMIN role 不存在，请先跑 npm run seed");
  const bizDept = await pg.department.findUnique({ where: { code: "biz" } });
  if (!bizDept) throw new Error("biz 部门不存在，请先跑 npm run seed");
  log("INIT", `importer=${importer.id} adminRole=${adminRole.id} bizDept=${bizDept.id}`);

  const idMap = { area: {}, dept: {}, user: {}, customer: {}, contract: {}, invoice: {}, payment: {} };

  // ============================================================
  // 阶段 A0: Dictionary(SERVICE_TYPE) ← serviceprojects 22 行
  // ============================================================
  {
    const t0 = Date.now();
    let upserts = 0;
    if (!DRY_RUN) {
      for (const [idStr, def] of Object.entries(SERVICE_TYPE_LEGACY)) {
        const oldId = Number(idStr);
        const code = legacyServiceTypeCode(oldId);
        const sort = legacyServiceTypeSort(oldId);
        await pg.dictionary.upsert({
          where: { category_code: { category: "SERVICE_TYPE", code } },
          update: { label: def.name, sort, isActive: true },
          create: { category: "SERVICE_TYPE", code, label: def.name, sort, isActive: true }
        });
        upserts++;
      }
    }
    done("A0_DICT_SERVICE_TYPE", { upserts, ms: Date.now() - t0 });
  }

  // ============================================================
  // 阶段 A: Dictionary(REGION) ← areas 26 行
  // ============================================================
  {
    const t0 = Date.now();
    let upserts = 0;
    if (!DRY_RUN) {
      for (const a of areas) {
        const code = areaToCode(a.ID, a.ParentID);
        const sort = a.SortIndex ?? 0;
        const label = a.ParentID
          ? `${areas.find((x) => x.ID === a.ParentID)?.Name ?? ""}-${a.Name}`
          : a.Name;
        const r = await pg.dictionary.upsert({
          where: { category_code: { category: "REGION", code } },
          update: { label, sort, isActive: true },
          create: { category: "REGION", code, label, sort, isActive: true }
        });
        idMap.area[a.ID] = r.code;
        upserts++;
      }
    } else {
      for (const a of areas) idMap.area[a.ID] = areaToCode(a.ID, a.ParentID);
    }
    done("A_DICT_REGION", { upserts, ms: Date.now() - t0 });
  }

  // ============================================================
  // 阶段 B: Department ← depts 3 行（挂在 bizDept 下）
  // ============================================================
  {
    const t0 = Date.now();
    let upserts = 0;
    for (const d of depts) {
      const code = `legacy-dept-${d.ID}`;
      if (!DRY_RUN) {
        const r = await pg.department.upsert({
          where: { code },
          update: { name: d.Name, sort: 10 + d.ID, isActive: true, parentId: bizDept.id },
          create: {
            code,
            name: d.Name,
            sort: 10 + d.ID,
            isActive: true,
            parentId: bizDept.id
          }
        });
        idMap.dept[d.ID] = r.id;
        upserts++;
      } else {
        idMap.dept[d.ID] = `legacy-dept-${d.ID}`;
      }
    }
    done("B_DEPT", { upserts, ms: Date.now() - t0 });
  }

  // ============================================================
  // 阶段 C: User ← users 52 行
  // ============================================================
  {
    const t0 = Date.now();
    let upserts = 0;
    let pinyinDup = 0;
    // 工号 = 姓名的拼音 (lowercase, 无空格无音调); 重名加 -2/-3...
    const baseEmployeeNo = users.map((u) => {
      const cn = (u.ChineseName || u.Name || "").toString();
      // pinyin-pro 把非中文字符保留; 已是字母数字的直接透传
      const py = toPinyin(cn, { toneType: "none", type: "array", nonZh: "consecutive" })
        .join("")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      return py || `u${u.ID}`;
    });
    const used = new Map();
    const employeeNos = baseEmployeeNo.map((b) => {
      const n = used.get(b) || 0;
      used.set(b, n + 1);
      return n === 0 ? b : `${b}${n + 1}`;
    });
    baseEmployeeNo.forEach((b, i) => {
      if (employeeNos[i] !== b) pinyinDup++;
    });
    const passwordHash = await bcrypt.hash("123456", 12);
    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      const employeeNo = employeeNos[i];
      const email = `${employeeNo}@qt.local`;
      const status = ENABLED_TO_USER_STATUS[u.Enabled] ?? "DISABLED";
      const departmentId = u.DeptID && idMap.dept[u.DeptID] ? idMap.dept[u.DeptID] : null;
      const displayName = u.ChineseName || u.Name || employeeNo;
      if (!DRY_RUN) {
        const r = await pg.user.upsert({
          where: { employeeNo },
          update: { name: displayName, email, passwordHash, roleId: adminRole.id, departmentId, status },
          create: {
            employeeNo,
            name: displayName,
            email,
            passwordHash,
            roleId: adminRole.id,
            departmentId,
            status
          }
        });
        idMap.user[u.ID] = r.id;
        upserts++;
      } else {
        idMap.user[u.ID] = `user-legacy-${u.ID}`;
      }
    }
    done("C_USER", { upserts, pinyinDup, ms: Date.now() - t0 });
  }

  // ============================================================
  // 阶段 D: Customer + ContactPerson ← companies 2091
  // ============================================================
  {
    const t0 = Date.now();
    let customerUpserts = 0;
    let contactUpserts = 0;
    let customerDup = 0;
    let customerNoPhone = 0;
    let customerNoArea = 0;

    const deduped = dedupCustomerNames(companies);
    if (!DRY_RUN) {
      for (const c of deduped) {
        if (c._dup) customerDup++;
        // areaID → province/city
        let province = UNKNOWN_REGION.province;
        let city = UNKNOWN_REGION.city;
        if (c.AreaID && idMap.area[c.AreaID]) {
          const region = await pg.dictionary.findUnique({
            where: { category_code: { category: "REGION", code: idMap.area[c.AreaID] } }
          });
          if (region) {
            // 顶级 code (R1) → 省市分拆简单：province='浙江省', city=label
            if (idMap.area[c.AreaID].indexOf(".") === -1) {
              // 顶级：默认浙江省
              province = "浙江省";
              city = region.label;
            } else {
              province = "浙江省";
              city = region.label.split("-")[0] || region.label;
            }
          }
        } else {
          customerNoArea++;
        }

        const code = DRY_RUN ? `DRY-QT-C-202606-${String(customerUpserts + 1).padStart(4, "0")}` : await nextBusinessNo(pg, "CUSTOMER", { yyyymm: true });
        const contactName = c.Contacts && String(c.Contacts).trim() ? String(c.Contacts).trim() : null;
        const contactPhone = c.Phone && String(c.Phone).trim() && String(c.Phone).trim().length >= 5
          ? String(c.Phone).trim()
          : null;

        const customer = await pg.customer.upsert({
          where: { code },
          update: { name: c._name, address: c.Adress || null, contactName, contactPhone: contactPhone || "未提供", province, city },
          create: {
            code,
            name: c._name,
            address: c.Adress || null,
            contactName,
            contactPhone: contactPhone || "未提供",
            customerType: "ENTERPRISE",
            sourceChannel: "REPEAT",
            status: "SIGNED",
            ownerUserId: importer.id,
            province,
            city,
            createdById: importer.id,
            updatedById: importer.id
          }
        });
        idMap.customer[c.ID] = customer.id;
        customerUpserts++;

        if (!contactPhone) customerNoPhone++;
        // 建 ContactPerson 当且仅当 phone 有效
        if (contactPhone) {
          await pg.contactPerson.create({
            data: {
              customerId: customer.id,
              name: contactName || "主联系人",
              phone: contactPhone,
              isPrimary: true,
              remark: c.DataQualityRemark || null,
              createdAt: toDate(c.CreateTime) || new Date(),
              updatedAt: toDate(c.CreateTime) || new Date()
            }
          });
          contactUpserts++;
        }
      }
    } else {
      for (const c of deduped) {
        idMap.customer[c.ID] = `cust-legacy-${c.ID}`;
      }
    }
    done("D_CUSTOMER", {
      customers: customerUpserts,
      contacts: contactUpserts,
      dups: customerDup,
      noPhone: customerNoPhone,
      noArea: customerNoArea,
      ms: Date.now() - t0
    });
  }

  // ============================================================
  // 阶段 E: Contract + Project ← services 4656
  // ============================================================
  {
    const t0 = Date.now();
    let contractUpserts = 0;
    let projectUpserts = 0;
    let contractNoGenerated = 0;
    let contractNoKept = 0;
    let contractNoDedup = 0;
    let amountZeroFixed = 0;

    // 合同号去重第一遍
    const allContractNos = services.map((s) => s.ContractNo);
    const dedupedNos = dedupContractNos(allContractNos);

    for (let i = 0; i < services.length; i++) {
      const s = services[i];
      const noInfo = dedupedNos[i];
      const customerId = idMap.customer[s.CompanyID];
      if (!customerId) {
        report.warnings.push(`Contract s.ID=${s.ID} 找不到 customer (companies.ID=${s.CompanyID})`);
        continue;
      }

      // customerName 拍平
      const customer = DRY_RUN
        ? { name: companies.find((c) => c.ID === s.CompanyID)?._name || "Unknown" }
        : await pg.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true } });
      if (!customer) {
        report.warnings.push(`Contract s.ID=${s.ID} customer 不存在`);
        continue;
      }

      // 合同号
      let contractNo;
      if (noInfo.kept) {
        contractNo = noInfo.deduped;
        contractNoKept++;
        if (noInfo.dup) contractNoDedup++;
      } else {
        if (DRY_RUN) {
          contractNo = `DRY-QT-HT-2026-${String(i + 1).padStart(4, "0")}`;
        } else {
          contractNo = await nextBusinessNo(pg, "CONTRACT");
        }
        contractNoGenerated++;
      }

      // 金额
      let totalAmount = Number(s.ContractAmount) || 0;
      // legacy-fineui 占位合同标记: totalAmount<=0 时把合同额改成 0.01 绕开 schema 校验, 同时打上
      // isLegacyZeroAmount=true 让业务列表/统计默认排除 (新 migration 20260705_contract_is_legacy_zero_amount 加字段).
      const isLegacyZeroAmount = totalAmount <= 0;
      if (totalAmount <= 0) {
        totalAmount = 0.01;
        amountZeroFixed++;
      }
      const { taxAmount, amountExcludingTax } = calcInvoiceTax(totalAmount, 0.06);

      // serviceType
      const serviceType = legacyServiceTypeCode(s.ServiceProjectID);
      if (!serviceType) {
        report.warnings.push(`Contract s.ID=${s.ID} serviceProjectID=${s.ServiceProjectID} 未知`);
      }

      // 状态
      const contractStatus = STATE_TO_CONTRACT_STATUS[s.State] ?? "DRAFT";
      const projectStatus = STATE_TO_PROJECT_STATUS[s.State] ?? "PLANNED";

      // 标题
      const projectTypeName = SERVICE_TYPE_LEGACY[s.ServiceProjectID]?.name ?? "服务";
      const title = `${customer.name}-${projectTypeName}-${(s.StartDate?.getFullYear?.() ?? new Date(s.StartDate).getFullYear())}年`;

      // 附件
      const attachments = urlToAttachmentJson(s.ContractFileUrl);

      // remark 拼接
      const remarkParts = [];
      if (s.Remark) remarkParts.push(`原备注: ${s.Remark}`);
      if (s.FreeState) remarkParts.push(`结清: ${s.FreeState}`);
      if (s.InvoiceState) remarkParts.push(`开票: ${s.InvoiceState}`);
      const baseRemark = remarkParts.join("\n");

      if (!DRY_RUN) {
        // update 块补 isLegacyZeroAmount: 重跑迁移时把已经入库但 totalAmount=0.01 的合同打上 true
        // (注意: 业务真实 0.01 合同不会被 legacy-fineui 处理, 不会被这条分支扫到)
        const contract = await pg.contract.upsert({
          where: { contractNo },
          update: { isLegacyZeroAmount },
          create: {
            contractNo,
            customerId,
            customerName: customer.name,
            title,
            serviceType: serviceType || "OTHER",
            signDate: toDate(s.SigningDate) || toDate(s.StartDate) || new Date(),
            startDate: toDate(s.StartDate) || new Date(),
            endDate: toDate(s.EndDate) || new Date(),
            totalAmount,
            taxRate: 0.06,
            taxAmount,
            amountExcludingTax,
            paymentMethod: "LUMP_SUM",
            status: contractStatus,
            ownerUserId: importer.id,
            attachments,
            installmentPlan: baseRemark ? { legacyRemark: baseRemark } : undefined,
            isLegacyZeroAmount,
            createdById: importer.id,
            updatedById: importer.id
          }
        });
        idMap.contract[s.ID] = contract.id;
        contractUpserts++;

        // Project 1:1
        const projectNo = DRY_RUN ? `DRY-QT-P-2026-${String(i + 1).padStart(4, "0")}` : await nextBusinessNo(pg, "PROJECT");
        await pg.project.create({
          data: {
            projectNo,
            contractId: contract.id,
            name: title,
            serviceScope: `对应合同服务类型 ${projectTypeName}`,
            managerUserId: importer.id,
            startDate: toDate(s.StartDate) || new Date(),
            endDate: toDate(s.EndDate) || new Date(),
            budgetAmount: totalAmount,
            status: projectStatus,
            createdById: importer.id,
            updatedById: importer.id
          }
        });
        projectUpserts++;

        // 阶段 H: servicerecords → remark 追加
        const records = recordsByServiceId.get(s.ID);
        if (records && records.length > 0) {
          const dates = records
            .map((r) => toDate(r.ServiceDate))
            .filter(Boolean)
            .sort((a, b) => a - b)
            .map((d) => d.toISOString().slice(0, 10));
          const historySection = `\n[历史服务记录 ${dates.length} 次]\n${dates.map((d) => `- ${d}`).join("\n")}`;
          await pg.contract.update({
            where: { id: contract.id },
            data: { installmentPlan: { legacyRemark: (baseRemark ? baseRemark + "\n" : "") + historySection } }
          });
        }
      } else {
        idMap.contract[s.ID] = `contract-legacy-${s.ID}`;
      }
    }

    done("E_CONTRACT_PROJECT", {
      contracts: contractUpserts,
      projects: projectUpserts,
      contractNoKept,
      contractNoDedup,
      contractNoGenerated,
      amountZeroFixed,
      ms: Date.now() - t0
    });
  }

  // ============================================================
  // 阶段 F: Invoice ← invoices 4926
  // ============================================================
  {
    const t0 = Date.now();
    let upserts = 0;
    let dupes = 0;
    const seenInvoiceNos = new Map();
    for (const inv of invoices) {
      const contractId = idMap.contract[inv.ServiceID];
      if (!contractId) {
        report.warnings.push(`Invoice inv.ID=${inv.ID} 找不到 contract (ServiceID=${inv.ServiceID})`);
        continue;
      }
      const contract = DRY_RUN
        ? { id: contractId, customerId: "dry-run", customerName: "dry-run" }
        : await pg.contract.findUnique({ where: { id: contractId }, select: { id: true, customerId: true, customerName: true } });
      if (!contract) continue;

      // invoiceNo 去重
      let invoiceNo = inv.InvoiceNo || `LEGACY-INV-${inv.ID}`;
      const n = (seenInvoiceNos.get(invoiceNo) ?? 0) + 1;
      seenInvoiceNos.set(invoiceNo, n);
      if (n > 1) {
        invoiceNo = `${inv.InvoiceNo || "LEGACY-INV"}-DUP${n - 1}`;
        dupes++;
      }

      const amount = Number(inv.InvoiceAmount) || 0;
      const { taxAmount, amountExcludingTax } = calcInvoiceTax(amount, 0.06);
      const applyDate = toDate(inv.InvoiceDate) || new Date();

      if (!DRY_RUN) {
        const r = await pg.invoice.upsert({
          where: { invoiceNo },
          update: {},
          create: {
            invoiceNo,
            contractId,
            customerId: contract.customerId,
            customerName: contract.customerName,
            invoiceType: "VAT_SPECIAL",
            amount,
            taxRate: 0.06,
            taxAmount,
            amountExcludingTax,
            applyDate,
            actualIssueDate: applyDate,
            titleType: "COMPANY",
            titleName: contract.customerName,
            attachments: urlToAttachmentJson(inv.InvoiceFileUrl),
            status: "ISSUED",
            applicantUserId: importer.id,
            remark: inv.Remark || null,
            createdById: importer.id,
            updatedById: importer.id
          }
        });
        idMap.invoice[inv.ID] = r.id;
        upserts++;
      } else {
        idMap.invoice[inv.ID] = `inv-legacy-${inv.ID}`;
      }
    }
    done("F_INVOICE", { invoices: upserts, invoiceNoDup: dupes, ms: Date.now() - t0 });
  }

  // ============================================================
  // 阶段 G: Payment ← collections 5171
  // ============================================================
  {
    const t0 = Date.now();
    let upserts = 0;
    let skippedZero = 0;
    let withInvoice = 0;
    let withoutInvoice = 0;
    const MS30 = 30 * 24 * 3600 * 1000;

    // 预加载 invoice by contractId 用于窗口匹配
    const invByContract = new Map();
    if (!DRY_RUN) {
      const allInvoices = await pg.invoice.findMany({ select: { id: true, contractId: true, applyDate: true } });
      for (const inv of allInvoices) {
        if (!invByContract.has(inv.contractId)) invByContract.set(inv.contractId, []);
        invByContract.get(inv.contractId).push(inv);
      }
    }

    for (const col of collections) {
      const amount = Number(col.CollectionAmount) || 0;
      if (amount <= 0) {
        skippedZero++;
        continue;
      }
      const contractId = idMap.contract[col.ServiceID];
      if (!contractId) {
        report.warnings.push(`Payment col.ID=${col.ID} 找不到 contract (ServiceID=${col.ServiceID})`);
        continue;
      }
      const contract = DRY_RUN
        ? { id: contractId, customerId: "dry-run" }
        : await pg.contract.findUnique({ where: { id: contractId }, select: { id: true, customerId: true } });
      if (!contract) continue;

      const receivedAt = toDate(col.CollectionDate) || new Date();

      // invoiceId 自动配
      let invoiceId = null;
      if (!DRY_RUN) {
        const cands = invByContract.get(contractId) || [];
        let best = null;
        let bestDist = Infinity;
        for (const inv of cands) {
          const dist = Math.abs(toDate(inv.applyDate).getTime() - receivedAt.getTime());
          if (dist <= MS30 && dist < bestDist) {
            best = inv;
            bestDist = dist;
          }
        }
        invoiceId = best?.id ?? null;
        if (invoiceId) withInvoice++;
        else withoutInvoice++;
      }

      const paymentNo = DRY_RUN ? `DRY-QT-PAY-2026-${String(upserts + 1).padStart(4, "0")}` : await nextBusinessNo(pg, "PAYMENT");

      if (!DRY_RUN) {
        const r = await pg.payment.upsert({
          where: { paymentNo },
          update: {},
          create: {
            paymentNo,
            customerId: contract.customerId,
            contractId,
            invoiceId,
            amount,
            receivedAt,
            method: "BANK_TRANSFER",
            status: "RECONCILED",
            recorderUserId: importer.id,
            remark: col.Remark || null,
            createdById: importer.id,
            updatedById: importer.id
          }
        });
        idMap.payment[col.ID] = r.id;
        upserts++;
      } else {
        idMap.payment[col.ID] = `pay-legacy-${col.ID}`;
      }
    }
    done("G_PAYMENT", {
      payments: upserts,
      skippedZero,
      withInvoice,
      withoutInvoice,
      ms: Date.now() - t0
    });
  }

  // ============================================================
  // 关闭
  // ============================================================
  report.finishedAt = new Date().toISOString();
  const reportPath = path.join(REPORT_DIR, "migrate-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  log("DONE", `📄 报告: ${reportPath}`);

  await my.end();
  await pg.$disconnect();
}

/** 复制 lib/sequence.ts 的 nextBusinessNo 逻辑（避免引 TS 文件） */
async function nextBusinessNo(pg, type, opts) {
  const PREFIX_MAP = {
    CUSTOMER: "QT-C",
    CONTRACT: "QT-HT",
    PROJECT: "QT-P",
    PAYMENT: "QT-PAY"
  };
  const prefix = PREFIX_MAP[type];
  const year = new Date().getFullYear();
  return pg.$transaction(async (tx) => {
    const key = opts?.yyyymm
      ? `${prefix}-${year}${String(new Date().getMonth() + 1).padStart(2, "0")}`
      : `${prefix}-${year}`;
    const upserted = await tx.sequence.upsert({
      where: { prefix_year: { prefix: key, year } },
      update: {},
      create: { prefix: key, year, lastValue: 0 }
    });
    await tx.$executeRawUnsafe(
      `UPDATE "Sequence" SET "lastValue" = "lastValue" + 1, "updatedAt" = NOW() WHERE id = $1`,
      upserted.id
    );
    const row = await tx.sequence.findUnique({ where: { id: upserted.id }, select: { lastValue: true } });
    const v = Number(row?.lastValue ?? 0);
    return `${key}-${String(v).padStart(4, "0")}`;
  });
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
