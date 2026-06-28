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

  it("customerCreateSchema 接受 town (所在镇街) 可选字段", () => {
    const src = read("lib/validators/customer.ts");
    expect(src).toMatch(/town:\s*z\.string\(\)\.max\(50\)\.optional\(\)/);
  });

  it("buildCustomerUpdateData 把 district 当作 nullable 字符串", () => {
    const src = read("lib/customer-update.ts");
    const block = src.match(/STRINGABLE_NULLABLE[\s\S]*?\];/);
    expect(block, "应能定位 STRINGABLE_NULLABLE 数组").toBeTruthy();
    expect(block![0]).toMatch(/"district"/);
  });

  it("createCustomer 把 district 转 null (与 address/shortName 同语义)", () => {
    const src = read("server/services/customer/crud.ts");
    // createCustomer 末尾是 tx.customer.create({ ... }); }); } (含 rlsTransaction 包装),
    // 这里用更宽松的写法匹配到下一个空行或下一个 export.
    const createBlock = src.match(
      /export\s+async\s+function\s+createCustomer[\s\S]*?(?=\nexport\s+async\s+function|\n\n)/
    );
    expect(createBlock, "应能定位 createCustomer 函数").toBeTruthy();
    expect(createBlock![0]).toMatch(/district:\s*input\.district\s*\|\|\s*null/);
  });

  it("createCustomer 也把 town 转 null (4 级级联最末级, 与 district 同语义)", () => {
    const src = read("server/services/customer/crud.ts");
    const createBlock = src.match(
      /export\s+async\s+function\s+createCustomer[\s\S]*?(?=\nexport\s+async\s+function|\n\n)/
    );
    expect(createBlock, "应能定位 createCustomer 函数").toBeTruthy();
    expect(createBlock![0]).toMatch(/town:\s*input\.town\s*\|\|\s*null/);
  });

  it("buildCustomerUpdateData 把 town 列入 STRINGABLE_NULLABLE, 写库时归一为 null", () => {
    const src = read("lib/customer-update.ts");
    const block = src.match(/STRINGABLE_NULLABLE[\s\S]*?\];/);
    expect(block, "应能定位 STRINGABLE_NULLABLE 数组").toBeTruthy();
    expect(block![0]).toMatch(/"town"/);
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
  it("列表页拼接 district + town (4 级位置)", () => {
    const src = read("app/(app)/customers/page.tsx");
    // 4 级 [省/市/区/镇街] 一并 join, 老数据缺镇街时 filter 掉
    expect(src).toMatch(/\[r\.province,\s*r\.city,\s*r\.district,\s*r\.town\]\.filter\(Boolean\)\.join/);
  });

  it("详情页加 所在区 描述项", () => {
    const src = read("app/(app)/customers/[id]/page.tsx");
    expect(src).toMatch(/所在区/);
    expect(src).toMatch(/dataIndex:\s*"district"/);
  });

  it("详情页加 所在镇街 描述项 (4 级位置)", () => {
    const src = read("app/(app)/customers/[id]/page.tsx");
    // 描述项 + 对应 dataIndex
    expect(src).toMatch(/所在镇街/);
    expect(src).toMatch(/dataIndex:\s*"town"/);
    // 镇街列必须在 详细地址 之前 (排版顺序: 省/市/区/镇街/详细地址)
    const townIdx = src.search(/dataIndex:\s*"town"/);
    const addrIdx = src.search(/dataIndex:\s*"address"/);
    expect(townIdx).toBeGreaterThan(0);
    expect(addrIdx).toBeGreaterThan(townIdx);
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
  // 新建/编辑页已抽成 CustomerForm 组件, 表单行为集中在组件内
  const formSrc = () => read("components/customers/customer-form.tsx");

  it("CustomerForm onChange 写 district / town, 并把级联名 join 到 address 自动填充", () => {
    const src = formSrc();
    expect(src).toMatch(/district:\s*labels\[2\]\s*\|\|\s*""/);
    expect(src).toMatch(/town:\s*labels\[3\]\s*\|\|\s*""/);
    // address 自动填充级联名 (用户可继续追加门牌号 / 楼层)
    expect(src).toMatch(/address:\s*labels\.filter\(Boolean\)\.join\(""\)/);
  });

  it("CustomerForm 用 ZHEJIANG_DIVISIONS 限制级联选项到浙江省", () => {
    const src = formSrc();
    expect(src).toMatch(/import\s*\{[^}]*ZHEJIANG_DIVISIONS[^}]*\}\s*from\s*"@\/lib\/china-divisions"/);
    expect(src).toMatch(/<LocationCascader[\s\S]*?options=\{ZHEJIANG_DIVISIONS\}/);
  });

  it("CustomerForm onChange 把 value 路径 setCascadeValue, 同步 Cascader 受控显示", () => {
    const src = formSrc();
    // 受控用法的 onChange 必须回写 cascadeValue, 不然 React 重渲染时 Cascader 选中显示
    // 会被 value prop 拉回初始 codes, 表现为"选完不显示"
    expect(src).toMatch(/onChange=\{handleCascadeChange\}/);
    const handler = src.match(
      /const handleCascadeChange = \(value: string\[\], labels: string\[\]\) => \{[\s\S]*?\};/
    );
    expect(handler, "应能定位 handleCascadeChange 函数").toBeTruthy();
    expect(handler![0]).toMatch(/setCascadeValue\(value\)/);
  });

  it("CustomerForm useEffect 从浙江子树预填, 并走 4 级 (province/city/district/town)", () => {
    const src = formSrc();
    const effect = src.match(
      /useEffect\(\(\)\s*=>\s*\{[\s\S]*?for\s*\(\s*const\s+label\s+of\s+\[initialValues\.[^\]]+\][\s\S]*?setCascadeValue\(codes\);\s*\},?\s*\[initialValues\]\);/
    );
    expect(effect, "应能定位 4 级预填 useEffect").toBeTruthy();
    expect(effect![0]).toMatch(/ZHEJIANG_DIVISIONS/);
    expect(effect![0]).toMatch(/initialValues\.district/);
    expect(effect![0]).toMatch(/initialValues\.town/);
  });

  it("CustomerForm 有 district / town 的 hidden Form.Item", () => {
    const src = formSrc();
    expect(src).toMatch(/<Form\.Item\s+name="district"\s+noStyle>/);
    expect(src).toMatch(/<Form\.Item\s+name="town"\s+noStyle>/);
    // 收集所有 ProFormText 闭标签块, 断言没有 name="town" 的可见控件
    const proFormTexts = src.match(/<ProFormText[\s\S]*?\/>/g) ?? [];
    expect(
      proFormTexts.some((b) => /name="town"/.test(b)),
      "CustomerForm ProFormText 中不应有 name=\"town\" 的可见控件"
    ).toBe(false);
  });

  it("CustomerForm 把所在地 cascader + 详细地址 同行排版 (FormGrid columns=2)", () => {
    const src = formSrc();
    // 截取 "位置与联系" section 内的 FormGrid, 找同时含 LocationCascader 和 name="address" 的那一格
    const sec = src.match(/<FormSection title="\u4f4d\u7f6e\u4e0e\u8054\u7cfb"[\s\S]*?(?=<FormSection[\s>]|SubmitBar|\n\s*<\/FormCard)/);
    expect(sec, "应能定位位置与联系 section").toBeTruthy();
    const grids = sec![0].match(/<FormGrid columns=\{2\}>[\s\S]*?<\/FormGrid>/g) ?? [];
    const locationGrid = grids.find((g) => /<LocationCascader/.test(g) && /name="address"/.test(g));
    expect(locationGrid, "位置 section 内应有一个 FormGrid 同时装下 cascader 和 详细地址").toBeTruthy();
  });

  it("编辑页把 initialValues 透传给 CustomerForm", () => {
    const src = read("app/(app)/customers/[id]/edit/page.tsx");
    expect(src).toMatch(/initialValues=\{data\}/);
  });

  it("新建/编辑页都使用 CustomerForm 组件", () => {
    const newSrc = read("app/(app)/customers/new/page.tsx");
    const editSrc = read("app/(app)/customers/[id]/edit/page.tsx");
    expect(newSrc).toMatch(/<CustomerForm[\s\S]*?mode="create"/);
    expect(editSrc).toMatch(/<CustomerForm[\s\S]*?mode="edit"/);
  });
});

describe("ZHEJIANG_DIVISIONS / LocationCascader.options 浙江省限制", () => {
  it("lib/china-divisions.ts 导出 ZHEJIANG_DIVISIONS (浙江省子树)", () => {
    const src = read("lib/china-divisions.ts");
    expect(src).toMatch(/export\s+const\s+ZHEJIANG_DIVISIONS:/);
    // 找到的应是 label === "浙江省" 的节点
    expect(src).toMatch(/DIVISIONS\.find\(\s*\(?n\)?\s*=>\s*n\.label\s*===\s*"\u6d59\u6c5f\u7701"/);
  });

  it("LocationCascader 接收 options prop (默认仍是全量 DIVISIONS)", () => {
    const src = read("components/form/LocationCascader.tsx");
    expect(src).toMatch(/options\?:\s+DivisionNode\[\];/);
    expect(src).toMatch(/options\s*=\s*DIVISIONS/);
    // 渲染时把 options 传给 antd Cascader
    expect(src).toMatch(/<Cascader<DivisionNode>[\s\S]*?options=\{options\}/);
  });

  it("LocationCascader onChange 透传 Cascader 的 value 路径 (受控同步必需)", () => {
    const src = read("components/form/LocationCascader.tsx");
    // 透传: 内部 Cascader.onChange 触发时, 必须把 antd 给的 newValue 作为 onChange 第一参数
    expect(src).toMatch(/onChange\?\s*:\s*\(?\s*value:\s*string\[\][\s\S]*?labels:[\s\S]*?selectedOptions/);
    expect(src).toMatch(/onChange=\{\(newValue,[\s\S]*?onChange\(newValue as string\[\][\s\S]*?labels/);
  });
});
