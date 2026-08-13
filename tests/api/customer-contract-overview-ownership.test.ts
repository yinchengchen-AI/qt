// 读放开 (v0.19, role-browse-permissions): 客户/合同 360 概览的 Invoice / Payment
// 查询不再做任何 owner 行级过滤 (读放开后 SALES/EXPERT 全量可读), 行级限定只保留
// 在统计/工作台口径 (statistics.ts / getDunningSummary 自带受限 where)。
//
// 本文件原为修复锁 (P2009 500): overview 曾把 ownerEq spread 到无 ownerUserId 字段的
// Invoice/Payment 查询, Prisma 把 ownerUserId 当 unknown arg 抛错。新口径下该风险点
// 已随读放开消除 — 改为守卫:
//   1) customer/contract overview 的 invoice/payment 查询不再携带任何 owner 过滤;
//   2) 统计口径 statistics.ts 仍走 ownerEq/ownerViaContract (本人口径不回退);
//   3) lib/ownership.ts 四个 helper 形态不变。
//
// 注:server/services/{customer,contract}.ts 已拆为子目录(2026-06 refactor),
// 本测试用 readAll(...) 合并读子文件。函数位置:
//   getCustomerOverview -> server/services/customer/overview.ts
//   getContractOverview -> server/services/contract/overview.ts

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf-8");
}

// 分裂后 read 多个子文件;用于取代旧的 server/services/{customer,contract}.ts
function readAll(paths: string[]): string {
  return paths.map((p) => readFileSync(join(ROOT, p), "utf-8")).join("\n");
}

const CUSTOMER_SERVICE_FILES = [
  "server/services/customer/index.ts",
  "server/services/customer/crud.ts",
  "server/services/customer/overview.ts",
];
const CONTRACT_SERVICE_FILES = [
  "server/services/contract/index.ts",
  "server/services/contract/crud.ts",
  "server/services/contract/status.ts",
  "server/services/contract/overview.ts",
  "server/services/contract/jobs.ts",
];

describe("概览读放开后 owner 过滤的口径守卫", () => {
  it("getCustomerOverview 内 Invoice / Payment 查询不再带 ownerViaContract / ownerEq", () => {
    const src = read("server/services/customer/overview.ts");
    const overviewBody = src.match(
      /export\s+async\s+function\s+getCustomerOverview[\s\S]*?\n\}\s*\n/
    )?.[0] ?? "";
    expect(overviewBody).toBeTruthy();

    for (const model of ["invoice", "payment"]) {
      const block = overviewBody.match(
        new RegExp(`prisma\\.${model}\\.findMany\\(\\s*\\{[\\s\\S]*?\\}\\s*\\)`)
      )?.[0] ?? "";
      expect(block, `应能找到 prisma.${model}.findMany 调用`).toBeTruthy();
      expect(block, `${model} 查询不再 spread ownerViaContract`).not.toMatch(
        /ownerViaContract\(user\)/
      );
      expect(block, `${model} 查询不再 spread ownerEq`).not.toMatch(
        /\.\.\.\s*ownerEq\(user\)/
      );
    }
  });

  it("getContractOverview 内 Invoice / Payment 查询不再带 ownerViaContract / ownerEq", () => {
    const src = read("server/services/contract/overview.ts");
    const overviewBody = src.match(
      /export\s+async\s+function\s+getContractOverview[\s\S]*?\n\}\s*\n/
    )?.[0] ?? "";
    expect(overviewBody, "应能定位 getContractOverview 函数体").toBeTruthy();

    for (const model of ["invoice", "payment"]) {
      const block = overviewBody.match(
        new RegExp(`prisma\\.${model}\\.findMany\\(\\s*\\{[\\s\\S]*?\\}\\s*\\)`)
      )?.[0] ?? "";
      expect(block, `应能找到 prisma.${model}.findMany 调用`).toBeTruthy();
      expect(block, `${model} 查询不再 spread ownerViaContract`).not.toMatch(
        /ownerViaContract\(user\)/
      );
      expect(block, `${model} 查询不再 spread ownerEq`).not.toMatch(
        /\.\.\.\s*ownerEq\(user\)/
      );
    }
  });

it("客户/合同主表读查询 (list/get) 不再 spread ownerEq", () => {
    const getFnBody = (src: string, name: string) =>
      src.match(new RegExp(`export\\s+async\\s+function\\s+${name}[\\s\\S]*?\\n\\}\\s*\\n`))?.[0] ?? "";
    const customerSrc = readAll(CUSTOMER_SERVICE_FILES);
    const contractSrc = readAll(CONTRACT_SERVICE_FILES);
    // 读放开后主表 list/get 全量; ownerEq 仅保留在统计口径与 softDeleteCustomer 的 ADMIN 路径
    for (const fn of ["listCustomers", "getCustomer"]) {
      const body = getFnBody(customerSrc, fn);
      expect(body, `应能定位 ${fn}`).toBeTruthy();
      expect(body, `${fn} 不再 spread ownerEq`).not.toMatch(/ownerEq\(user\)/);
    }
    for (const fn of ["listContracts", "getContract"]) {
      const body = getFnBody(contractSrc, fn);
      expect(body, `应能定位 ${fn}`).toBeTruthy();
      expect(body, `${fn} 不再 spread ownerEq`).not.toMatch(/ownerEq\(user\)/);
    }
  });

  it("统计口径 statistics.ts 仍走 ownerEq / ownerViaContract (本人口径不回退)", () => {
    const src = read("server/services/statistics.ts");
    expect(src, "statistics.ts 应继续 import 行级 helper").toMatch(
      /import\s*\{[^}]*\bownerEq\b[^}]*\}/
    );
    expect(src).toMatch(/\.\.\.\s*ownerEq\(user\)/);
    expect(src).toMatch(/ownerViaContract\(user\)/);
  });

  it("lib/ownership.ts 的四个 helper 形态不变 (统计口径与写守门继续消费)", () => {
    const src = read("lib/ownership.ts");
    expect(src).toMatch(/export\s+function\s+isRowRestricted\s*\(\s*user\s*:\s*SessionUser\s*\)/);
    expect(src).toMatch(/export\s+function\s+ownerEq\s*\(\s*user\s*:\s*SessionUser\s*\)/);
    expect(src).toMatch(
      /export\s+function\s+ownerViaContract\s*\(\s*user\s*:\s*SessionUser\s*\)\s*:\s*\{\s*contract\s*\?\s*:\s*\{\s*ownerUserId\s*:\s*string\s*\}\s*\}/
    );
    expect(src).toMatch(
      /export\s+function\s+assertRecordWritable\s*\(\s*user\s*:\s*SessionUser\s*,\s*recordOwnerId\s*:\s*string/
    );
  });
});