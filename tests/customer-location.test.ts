// 客户所在地 4 级回归锁:
//  1) schema.prisma 必含 district 字段
//  2) 必含迁移 20260621_customer_district
//  3) 验证器 / customer-update 都把 district 放行
//  4) 列表 / 详情 / 导出 / PDF 4 个渲染点都拼接 district
//  5) 编辑页 useEffect 走 4 级预填;onChange 写 district
//  6) 新建 / 编辑页都加了 district 的 Form.Item
//
// 此前 v0.x 漏 district 字段, 列表显示 "xx区xx街道" (历史脏数据), 编辑无法保存区级.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf-8");

describe("Customer.district 字段已加进 4 级位置", () => {
  it("schema.prisma 中 Customer 模型含 district 字段, 在 city 与 address 之间", () => {
    const schema = read("prisma/schema.prisma");
    const customerBlock = schema.match(/model\s+Customer\s*\{[\s\S]*?\n\}/);
    expect(customerBlock).toBeTruthy();
    expect(customerBlock![0]).toMatch(/district\s+String\?/);
    const order = customerBlock![0].match(
      /province\s+String[\s\S]*?city\s+String[\s\S]*?district\s+String\?[\s\S]*?address\s+String\?[\s\S]*?town\s+String\?/
    );
    expect(order, "district 应在 city 之后, address 之前").toBeTruthy();
  });

  it("迁移文件 20260621_customer_district 存在且 SQL 为 ADD COLUMN", () => {
    const base = join(ROOT, "prisma", "migrations");
    const dirs = readdirSync(base);
    const hit = dirs.find((d) => d.includes("customer_district"));
    expect(hit, "应存在 customer_district 迁移目录").toBeTruthy();
    const sql = read(`prisma/migrations/${hit}/migration.sql`);
    expect(sql).toMatch(/ADD\s+COLUMN\s+"district"/i);
  });
});

describe("validator / service 放行 district", () => {
  it("customerCreateSchema 接受 district 可选字段", () => {
    const src = read("lib/validators/customer.ts");
    expect(src).toMatch(/district:\s*z\.string\(\)\.max\(40\)\.optional\(\)/);
  });

  it("buildCustomerUpdateData 把 district 当作 nullable 字符串", () => {
    const src = read("lib/customer-update.ts");
    const block = src.match(/STRINGABLE_NULLABLE[\s\S]*?\];/);
    expect(block, "应能定位 STRINGABLE_NULLABLE 数组").toBeTruthy();
    expect(block![0]).toMatch(/"district"/);
  });

  it("createCustomer 把 district 转 null (与 address/shortName 同语义)", () => {
    const src = read("server/services/customer.ts");
    // createCustomer 末尾是 tx.customer.create({ ... }); }); } (含 rlsTransaction 包装),
    // 这里用更宽松的写法匹配到下一个空行或下一个 export.
    const createBlock = src.match(
      /export\s+async\s+function\s+createCustomer[\s\S]*?(?=\nexport\s+async\s+function|\n\n)/
    );
    expect(createBlock, "应能定位 createCustomer 函数").toBeTruthy();
    expect(createBlock![0]).toMatch(/district:\s*input\.district\s*\|\|\s*null/);
  });
});

describe("类型: Customer 含 district", () => {
  it("lib/types/entities.ts 暴露 district 字段", () => {
    const src = read("lib/types/entities.ts");
    const block = src.match(/export\s+type\s+Customer\s*=\s*\{[\s\S]*?\n\};/);
    expect(block, "应能定位 Customer 类型").toBeTruthy();
    expect(block![0]).toMatch(/district:\s*string\s*\|\s*null/);
  });
});

describe("渲染 4 处全部拼接 district (省 / 市 / 区)", () => {
  it("列表页拼接 district", () => {
    const src = read("app/(app)/customers/page.tsx");
    expect(src).toMatch(/\[r\.province,\s*r\.city,\s*r\.district\]\.filter\(Boolean\)\.join/);
  });

  it("详情页加 所在区 描述项", () => {
    const src = read("app/(app)/customers/[id]/page.tsx");
    expect(src).toMatch(/所在区/);
    expect(src).toMatch(/dataIndex:\s*"district"/);
  });

  it("导出 API 拼接 district", () => {
    const src = read("app/api/customers/export/route.ts");
    expect(src).toMatch(/x\.district/);
  });

  it("PDF API 拼接 district", () => {
    const src = read("app/api/customers/[id]/pdf/route.ts");
    expect(src).toMatch(/\[c\.province,\s*c\.city,\s*c\.district\]/);
  });
});

describe("表单 4 级: onChange 写 district, 编辑预填走 4 级", () => {
  it("新建页 onChange 写 district: labels[2]", () => {
    const src = read("app/(app)/customers/new/page.tsx");
    expect(src).toMatch(/district:\s*labels\[2\]\s*\|\|\s*""/);
    expect(src).toMatch(/town:\s*labels\[3\]\s*\|\|\s*""/);
    expect(src).not.toMatch(/address:\s*labels\.filter\(Boolean\)\.join/);
  });

  it("编辑页 onChange 写 district: labels[2]", () => {
    const src = read("app/(app)/customers/[id]/edit/page.tsx");
    expect(src).toMatch(/district:\s*labels\[2\]\s*\|\|\s*""/);
    expect(src).toMatch(/town:\s*labels\[3\]\s*\|\|\s*""/);
  });

  it("编辑页 useEffect 预填走 4 级 (province/city/district/town)", () => {
    const src = read("app/(app)/customers/[id]/edit/page.tsx");
    const effect = src.match(
      /useEffect\(\(\)\s*=>\s*\{[\s\S]*?for\s*\(\s*const\s+label\s+of\s+\[data\.[^\]]+\][\s\S]*?setCascadeValue\(codes\);\s*\},?\s*\[data\]\);/
    );
    expect(effect, "应能定位 4 级预填 useEffect").toBeTruthy();
    expect(effect![0]).toMatch(/data\.district/);
    expect(effect![0]).toMatch(/data\.town/);
  });

  it("两页都加 district 的 Form.Item (noStyle hidden)", () => {
    const newSrc = read("app/(app)/customers/new/page.tsx");
    const editSrc = read("app/(app)/customers/[id]/edit/page.tsx");
    expect(newSrc).toMatch(/<Form\.Item\s+name="district"\s+noStyle>/);
    expect(editSrc).toMatch(/<Form\.Item\s+name="district"\s+noStyle>/);
  });

  it("编辑页 initialValues 含 district", () => {
    const src = read("app/(app)/customers/[id]/edit/page.tsx");
    const iv = src.match(/initialValues=\{\{[\s\S]*?\}\}/);
    expect(iv, "应能定位 initialValues").toBeTruthy();
    expect(iv![0]).toMatch(/district:\s*data\.district/);
  });
});
