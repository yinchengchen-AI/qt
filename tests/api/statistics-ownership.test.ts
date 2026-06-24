// 回归:统计分析模块的数据权限隔离。
// 防止 SALES 角色在 Top 客户、客户分布、镇街分布、发票账龄等入口看到全量数据。

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf-8");
}

const serviceSrc = read("server/services/statistics.ts");
const overviewRouteSrc = read("app/api/statistics/overview/route.ts");
const agingRouteSrc = read("app/api/statistics/invoice-aging/route.ts");

describe("统计分析模块 ownership 隔离", () => {

  describe("getTopCustomers", () => {
    it("应导入 ownerEq 与 ownerViaContract", () => {
      expect(serviceSrc).toMatch(
        /import\s*\{[^}]*\bownerEq\b[^}]*\}\s*from\s+"@\/lib\/ownership"/
      );
      expect(serviceSrc).toMatch(
        /import\s*\{[^}]*\bownerViaContract\b[^}]*\}\s*from\s+"@\/lib\/ownership"/
      );
    });

    it("客户列表与合同 groupBy 应 spread ownerEq", () => {
      const body = serviceSrc.match(
        /export\s+async\s+function\s+getTopCustomers[\s\S]*?\n}\s*\n/
      )?.[0] ?? "";
      expect(body).toBeTruthy();

      // 客户列表仍是内联 where
      const customerBlock = body.match(
        /prisma\.customer\.findMany\(\s*\{[\s\S]*?\}\s*\)/
      )?.[0] ?? "";
      expect(customerBlock).toBeTruthy();
      expect(customerBlock).toMatch(/\.\.\.\s*ownerEq\(user\)/);

      // 合同 groupBy 抽到了 signWhere 变量,要求变量里 spread ownerEq
      expect(body).toMatch(/signWhere\s*=\s*\{[\s\S]*?\.\.\.\s*ownerEq\(user\)/);
    });

    it("发票/回款 groupBy 应 spread ownerViaContract(走变量)", () => {
      const body = serviceSrc.match(
        /export\s+async\s+function\s+getTopCustomers[\s\S]*?\n}\s*\n/
      )?.[0] ?? "";
      expect(body).toBeTruthy();
      // 抽到 invoiceWhere / paymentWhere 变量
      expect(body).toMatch(/invoiceWhere\s*=[^=]*\{[\s\S]*?\.\.\.\(?\s*ownerViaContract\(user\)/);
      expect(body).toMatch(/paymentWhere\s*=[^=]*\{[\s\S]*?\.\.\.\(?\s*ownerViaContract\(user\)/);
    });
  });

  describe("getCustomerDistribution", () => {
    it("三个 groupBy 都应使用带 ownerEq 的 customerWhere", () => {
      const body = serviceSrc.match(
        /export\s+async\s+function\s+getCustomerDistribution[\s\S]*?\n}\s*\n/
      )?.[0] ?? "";
      expect(body).toBeTruthy();
      expect(body).toMatch(/customerWhere\s*=\s*\{\s*deletedAt:\s*null,\s*\.\.\.ownerEq\(user\)\s*\}/);
      expect(body).toMatch(/where:\s*customerWhere/);
    });
  });

  describe("overview 路由镇街分布", () => {
    it("townDistribution 查询应 spread own", () => {
      const block = overviewRouteSrc.match(
        /prisma\.customer\.findMany\(\s*\{[\s\S]*?town:\s*\{\s*not:\s*null\s*\}[\s\S]*?\}\s*\)/
      )?.[0] ?? "";
      expect(block).toBeTruthy();
      expect(block).toMatch(/\.\.\.\s*own/);
    });
  });

  describe("invoice-aging 路由", () => {
    it("应包裹 runWithRequestContext", () => {
      expect(agingRouteSrc).toMatch(
        /export\s+async\s+function\s+GET\(\s*req:\s*Request\s*\)\s*\{[\s\S]*?runWithRequestContext\(\s*req\s*,\s*async\s*\(\)\s*=>\s*\{/
      );
    });
  });
});

// === 第二轮:修复 round 的结构性回归锁 ===
// 这些断言用读源码 + 正则,只能锁住"代码形态",不能锁住运行时正确性;
// 真正的 REFUNDED/unpaidAmount 行为见 tests/api/statistics-aggregation.test.ts
const exportRouteSrc = read("app/api/statistics/export/route.ts");
const topRouteSrc = read("app/api/statistics/top-customers/route.ts");
const overviewRouteFullSrc = read("app/api/statistics/overview/route.ts");
const agingPageSrc = read("app/(app)/statistics/aging/page.tsx");
const overviewPageSrc = read("app/(app)/statistics/overview/page.tsx");

describe("统计分析 round-2 修复", () => {
  describe("getOverview:unpaidAmount 不可为负", () => {
    it("应用 Math.max(0, ...) clamp", () => {
      const body = serviceSrc.match(
        /export\s+async\s+function\s+getOverview[\s\S]*?\n}\s*\n/
      )?.[0] ?? "";
      expect(body).toBeTruthy();
      expect(body).toMatch(/Math\.max\(\s*0\s*,/);
    });

    it("返回对象中不再含 range 字段", () => {
      const body = serviceSrc.match(
        /export\s+async\s+function\s+getOverview[\s\S]*?\n}\s*\n/
      )?.[0] ?? "";
      expect(body).toBeTruthy();
      // return {...} 块
      const returnBlock = body.match(/return\s*\{[\s\S]*?\};/)?.[0] ?? "";
      expect(returnBlock).toBeTruthy();
      expect(returnBlock).not.toMatch(/^\s*range\s*[,}]/m);
    });
  });

  describe("getInvoiceAging:REFUNDED 退款应抵消已收", () => {
    it("payment groupBy 仅取仍生效的 CONFIRMED/RECONCILED(REFUNDED 视为已撤销)", () => {
      const body = serviceSrc.match(
        /export\s+async\s+function\s+getInvoiceAging[\s\S]*?\n}\s*\n/
      )?.[0] ?? "";
      expect(body).toBeTruthy();
      // 账龄 paidMap 走 groupBy,status in 只含 CONFIRMED/RECONCILED
      const paidGroup = body.match(
        /prisma\.payment\.groupBy\([\s\S]*?_sum:\s*\{\s*amount:\s*true\s*\}[\s\S]*?\)\s*;/
      )?.[0] ?? "";
      expect(paidGroup, "应能找到账龄的 payment groupBy").toBeTruthy();
      expect(paidGroup).toMatch(/CONFIRMED/);
      expect(paidGroup).toMatch(/RECONCILED/);
      expect(paidGroup).not.toMatch(/REFUNDED/);
    });

    it("应返回 total 字段(供 UI 展示真实超期数)", () => {
      const body = serviceSrc.match(
        /export\s+async\s+function\s+getInvoiceAging[\s\S]*?\n}\s*\n/
      )?.[0] ?? "";
      expect(body).toBeTruthy();
      expect(body).toMatch(/return\s*\{\s*buckets[\s\S]*?total:\s*rows\.length[\s\S]*?rows:\s*rows\.slice/);
    });

    it("daysOverdue 走 daysBetween(later, earlier) 而非裸 86400_000 ms", () => {
      const body = serviceSrc.match(
        /export\s+async\s+function\s+getInvoiceAging[\s\S]*?\n}\s*\n/
      )?.[0] ?? "";
      expect(body).toBeTruthy();
      expect(body).toMatch(/daysBetween\(\s*now\s*,\s*new Date\(inv\.actualIssueDate\)\s*\)/);
    });
  });

  describe("getTopCustomers:支持 range", () => {
    it("签名应包含可选的 range 参数", () => {
      const body = serviceSrc.match(
        /export\s+async\s+function\s+getTopCustomers[\s\S]*?\n}\s*\n/
      )?.[0] ?? "";
      expect(body).toBeTruthy();
      expect(body).toMatch(
        /export\s+async\s+function\s+getTopCustomers\s*\([^)]*range\??\s*:\s*DateRange/
      );
    });

    it("合同 groupBy 应在有 range 时携带 signDate 过滤", () => {
      const body = serviceSrc.match(
        /export\s+async\s+function\s+getTopCustomers[\s\S]*?\n}\s*\n/
      )?.[0] ?? "";
      expect(body).toBeTruthy();
      expect(body).toMatch(/range\s*\?\s*\{\s*signDate:\s*dateWhere\(range\)\s*\}\s*:\s*\{\}/);
    });
  });

  describe("aggregatePerformance:contractOwners 查询带 ownerIds 过滤", () => {
    it("反查合同 ownerUserId 时应附加 ownerUserId: { in: ownerIds }", () => {
      const body = serviceSrc.match(
        /async\s+function\s+aggregatePerformance[\s\S]*?\n}\s*\n/
      )?.[0] ?? "";
      expect(body).toBeTruthy();
      const findBlock = body.match(
        /prisma\.contract\.findMany\(\s*\{[\s\S]*?\}\s*\)/
      )?.[0] ?? "";
      expect(findBlock).toBeTruthy();
      expect(findBlock).toMatch(/ownerUserId:\s*\{\s*in:\s*ownerIds\s*\}/);
    });
  });

  describe("overview 路由:字段重命名 + 分布 label 翻译", () => {
    it("customers 字段应改为 newInRange", () => {
      expect(overviewRouteFullSrc).toMatch(
        /customers:\s*\{\s*total:\s*customerCount\s*,\s*newInRange:\s*newCustomers\s*\}/
      );
    });

    it("应在响应里把 byScale/byType/byStatus 的 key 翻译成 label", () => {
      expect(overviewRouteFullSrc).toMatch(/CUSTOMER_TYPE_MAP/);
      expect(overviewRouteFullSrc).toMatch(/CUSTOMER_SCALE_MAP/);
      expect(overviewRouteFullSrc).toMatch(/CUSTOMER_STATUS_MAP/);
    });
  });

  describe("top-customers 路由:接收 from/to", () => {
    it("query schema 应含 from/to", () => {
      expect(topRouteSrc).toMatch(/from:\s*z\.string\(\)\.optional\(\)/);
      expect(topRouteSrc).toMatch(/to:\s*z\.string\(\)\.optional\(\)/);
    });

    it("getTopCustomers 应传入 range", () => {
      expect(topRouteSrc).toMatch(/getTopCustomers\(\s*user\s*,\s*parsed\.metric\s*,\s*parsed\.limit\s*,\s*range\s*\)/);
    });
  });

  describe("export 路由:userId 透传 + 行数兜底", () => {
    it("query schema 应含 userId", () => {
      expect(exportRouteSrc).toMatch(/userId:\s*z\.string\(\)\.optional\(\)/);
    });

    it("getEmployeePerformance 应传入 parsed.userId", () => {
      expect(exportRouteSrc).toMatch(/getEmployeePerformance\(\s*user\s*,\s*parsed\.userId\s*,\s*range\s*\)/);
    });

    it("应通过 exportMaxRows() 兜底行数,防止 OOM", () => {
      expect(exportRouteSrc).toMatch(/import\s*\{[^}]*exportMaxRows[^}]*\}\s*from\s+"@\/lib\/excel"/);
      expect(exportRouteSrc).toMatch(/exportMaxRows\(\)/);
      // employee-performance 必须 slice
      expect(exportRouteSrc).toMatch(/all\.slice\(\s*0\s*,\s*MAX_ROWS\s*\)/);
    });
  });

  describe("aging 页面:total 字段驱动 banner", () => {
    it("页面应读取 j.data.total 并显示真实总数", () => {
      expect(agingPageSrc).toMatch(/j\.data\.total/);
      expect(agingPageSrc).toMatch(/totalOverdueInvoices/);
    });

    it("section header 与底部链接应使用 totalOverdueInvoices 而非 rows.length", () => {
      // 找到 '共 ${rows.length} 条' 这种字符串不应再出现
      expect(agingPageSrc).not.toMatch(/共\s*\$\{rows\.length\}\s*条/);
      expect(agingPageSrc).not.toMatch(/查看全部\s*\{rows\.length\}/);
    });
  });

  describe("overview 页面:newInRange 字段", () => {
    it("类型定义应为 newInRange", () => {
      expect(overviewPageSrc).toMatch(/newInRange:\s*number/);
    });

    it("不再出现 newThisMonth", () => {
      expect(overviewPageSrc).not.toMatch(/newThisMonth/);
    });
  });
});
