// 修复锁:`/api/customers/[id]/pdf` 与 `/api/contracts/[id]/pdf` 在 SALES 角色下
// 报 500。根因:Invoice / Payment 模型无 `ownerUserId` 字段(分别用
// `applicantUserId` / `recorderUserId`),overview 函数却 spread 了
// `ownerEq(user)`,Prisma 把 `ownerUserId` 当 unknown arg 抛 P2009,被
// `lib/api.ts:err()` 兜底成 500。
// 正确做法:跨一跳查询改走 `ownerViaContract(user)`,经 contract 关系过滤
// ownerUserId。
//
// 注:server/services/{customer,contract}.ts 已拆为子目录(2026-06 refactor),
// 本测试用 readAll(...) 合并读子文件。函数位置:
//   getCustomerOverview -> server/services/customer/followup.ts
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
  "server/services/customer/status.ts",
  "server/services/customer/followup.ts",
];
const CONTRACT_SERVICE_FILES = [
  "server/services/contract/index.ts",
  "server/services/contract/crud.ts",
  "server/services/contract/status.ts",
  "server/services/contract/overview.ts",
  "server/services/contract/jobs.ts",
];

describe("客户/合同概览的 ownership 过滤(避免 SALES 报 ownerUserId 未知字段)", () => {
  it("server/services/customer.ts 导入 ownerViaContract", () => {
    const src = readAll(CUSTOMER_SERVICE_FILES);
    expect(src, "应从 @/lib/ownership 导入 ownerViaContract").toMatch(
      /import\s*\{[^}]*\bownerViaContract\b[^}]*\}\s*from\s+"@\/lib\/ownership"/
    );
  });

  it("getCustomerOverview 内 Invoice / Payment 查询用 ownerViaContract,不再 spread ownerEq", () => {
    const src = read("server/services/customer/followup.ts");
    const overviewBody = src.match(
      /export\s+async\s+function\s+getCustomerOverview[\s\S]*?\n\}\s*\n/
    )?.[0] ?? "";
    expect(overviewBody).toBeTruthy();

    for (const model of ["invoice", "payment"]) {
      const block = overviewBody.match(
        new RegExp(`prisma\\.${model}\\.findMany\\(\\s*\\{[\\s\\S]*?\\}\\s*\\)`)
      )?.[0] ?? "";
      expect(block, `应能找到 prisma.${model}.findMany 调用`).toBeTruthy();
      expect(block, `${model} 查询应 spread ownerViaContract`).toMatch(
        /\.\.\.\(?\s*ownerViaContract\(user\)/
      );
      expect(block, `${model} 查询不应再 spread ownerEq`).not.toMatch(
        /\.\.\.\s*ownerEq\(user\)/
      );
    }
  });

  it("Customer/Contract 主表查询仍可 spread ownerEq(它们有 ownerUserId 字段)", () => {
    const src = readAll([...CUSTOMER_SERVICE_FILES, ...CONTRACT_SERVICE_FILES]);
    // Customer / Contract 的 ownerUserId 是真实字段,ownerEq 仍合法
    expect(src).toMatch(/\.\.\.\s*ownerEq\(user\)/);
  });

  it("server/services/contract.ts 导入 ownerViaContract", () => {
    const src = readAll(CONTRACT_SERVICE_FILES);
    expect(src, "应从 @/lib/ownership 导入 ownerViaContract").toMatch(
      /import\s*\{[^}]*\bownerViaContract\b[^}]*\}\s*from\s+"@\/lib\/ownership"/
    );
  });

  it("getContractOverview 内 Invoice / Payment 查询都用 ownerViaContract", () => {
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
      expect(block, `${model} 查询应 spread ownerViaContract`).toMatch(
        /\.\.\.\(?\s*ownerViaContract\(user\)/
      );
      expect(block, `${model} 查询不应再 spread ownerEq`).not.toMatch(
        /\.\.\.\s*ownerEq\(user\)/
      );
    }
  });

  it("ownerViaContract 应被 cast 到对应 model 的 WhereInput(避免 Prisma 泛型过严报错)", () => {
    const customerSrc = read("server/services/customer/followup.ts");
    const contractSrc = read("server/services/contract/overview.ts");
    expect(customerSrc).toMatch(/ownerViaContract\(user\)\s*as\s*Prisma\.InvoiceWhereInput/);
    expect(customerSrc).toMatch(/ownerViaContract\(user\)\s*as\s*Prisma\.PaymentWhereInput/);
    expect(contractSrc).toMatch(/ownerViaContract\(user\)\s*as\s*Prisma\.InvoiceWhereInput/);
    expect(contractSrc).toMatch(/ownerViaContract\(user\)\s*as\s*Prisma\.PaymentWhereInput/);
  });

  it("lib/ownership.ts 的 ownerViaContract helper 走 contract 关系", () => {
    const src = read("lib/ownership.ts");
    expect(src).toMatch(
      /export\s+function\s+ownerViaContract\s*\(\s*user\s*:\s*SessionUser\s*\)\s*:\s*\{\s*contract\s*\?\s*:\s*\{\s*ownerUserId\s*:\s*string\s*\}\s*\}/
    );
  });
});
