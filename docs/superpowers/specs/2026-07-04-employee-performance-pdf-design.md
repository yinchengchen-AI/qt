# 员工业绩 PDF 导出重设计

## 背景

当前「统计分析 / 员工业绩」页面的 PDF 导出只渲染了一张「签约明细」表，且列结构、小计形式与 Excel 导出不一致。业务希望 PDF 内容与导出的 Excel 文件保持一致。

Excel 导出包含两个 sheet：

1. **员工业绩汇总**：按签约人聚合（姓名、合同数、合同额、已开票额、已回款额、未回款额、开票率、回款率）。
2. **签约明细**：按签约人分组的合同级明细（区域、企业、服务项目、签约人、合同号、签约日期、合同金额），含组末小计和全表总计。

## 目标

- PDF 结构与 Excel 双 sheet 对齐：同时包含「员工业绩汇总」和「签约明细」两张表。
- 横向 A4 排版，便于展示 7~8 列数据。
- 明细表采用独立小计行（而非当前紧凑的末行小计列），与 Excel 一致。
- 汇总表与明细表分页显示。
- 小计行浅灰底加粗，总计行深灰底加粗。
- 不引入新的 PDF 生成依赖，继续沿用现有的 HTML 打印页方案。

## 方案

采用「扩展现有 `print-html.ts`」方案（方案 A）：

- 复用 `lib/print-html.ts` 的 `renderPrintHtml` 与 `PrintDoc` 抽象。
- 在 `app/api/statistics/employee-performance/pdf/route.ts` 中构造两个 `PrintTableSection`。
- 补齐 `PrintTableSection.rowClass` 在 `renderTable` 中的实际渲染。
- 新增 CSS 处理横向页面、强制分页、小计/总计行高亮。

## 数据流

1. 路由仍并行调用 `getSignerSummary()` 和 `getSignerContractDetail()`。
2. 构造 `PrintDoc`：
   - `mainRows`：统计周期、签约人数、合同份数。
   - `summary`：保留现有顶部 KPI 卡片（合同总额、已开票额、已回款额、未回款额），作为一页纸的视觉锚点。
   - `sections[0]`：员工业绩汇总表。
   - `sections[1]`：签约明细表。
3. 返回 HTML，浏览器打印对话框选择「另存为 PDF」。

## 页面结构

### 第 1 页：汇总 + 员工业绩汇总表

- 顶部品牌 header（logo、系统名、报表标题、周期、打印时间）。
- 汇总 KPI 卡片（4 个）：合同总额、已开票额、已回款额、未回款额。
- 员工业绩汇总表：
  - 列：姓名、合同数、合同额、已开票额、已回款额、未回款额、开票率(%)、回款率(%)。
  - 金额列右对齐，保留 2 位小数；比率列右对齐，保留 1 位小数。
  - 末行：「总计 ({N} 人)」深灰底加粗。

### 第 2 页起：签约明细表

- 列：所属区域、企业名称、服务项目、签约人、合同号、签约日期、合同金额。
- 按签约人分组，组内按签约日期升序。
- 每组后插入小计行：「小计：{签约人}」+ 合同份数 + 合同金额，浅灰底加粗。
- 最后插入总计行：「总计：全公司 ({N} 份合同)」+ 签约人数 + 合同金额，深灰底加粗。

## 样式与 CSS

为支持横向而不影响其它报表，给 `PrintDoc` 增加可选字段 `orientation?: "portrait" | "landscape"`，默认 `"portrait"`。`renderPrintHtml` 根据该字段输出对应的 `@page size`：

```css
@page { size: A4 ${orientation}; margin: 0; }
```

同时新增以下样式：

```css
/* 明细表强制从新页开始 */
.print-section + .print-section { page-break-before: always; }

/* 小计行 */
tr.subtotal { background: #e5e7eb; font-weight: 700; }

/* 总计行 */
tr.total { background: #d1d5db; font-weight: 700; }
```

给 `renderTable` 补上 `rowClass` 的拼接逻辑（当前类型已声明但未使用）：

```ts
const rowCls = s.rowClass ? s.rowClass(r) : undefined;
const trAttr = rowCls ? ` class="${esc(rowCls)}"` : "";
return `<tr${trAttr}>...</tr>`;
```

## 文件改动

1. **`lib/print-html.ts`**
   - 在 `PrintDoc` 类型中增加 `orientation?: "portrait" | "landscape"`，默认纵向。
   - 在 `renderTable` 中启用 `rowClass`。
   - 新增分页、小计/总计样式；`@page size` 根据 `orientation` 动态输出。
   - 保持其它报表的默认纵向行为不变。

2. **`app/api/statistics/employee-performance/pdf/route.ts`**
   - 设置 `orientation: "landscape"`。
   - 构造两个 `PrintTableSection`。
   - 明细表为每组末尾生成小计行，最后生成总计行。
   - 汇总表生成总计行。
   - 金额/比率格式化与 Excel 对齐。

## 验证

1. 浏览器访问 `/api/statistics/employee-performance/pdf?from=...&to=...`。
2. 检查：
   - 页面方向为横向。
   - 第 1 页含汇总表，第 2 页起为明细表。
   - 明细表每组后有小计行，末尾有总计行。
   - 小计/总计行背景色和加粗正确。
3. 与同参数 Excel 导出对比金额、人数、合同数是否一致。
4. 运行现有测试：
   - `npx vitest run tests/api/reports-export.test.ts`
   - `npx vitest run tests/api/signer-contract-detail.test.ts`
   - `npm run typecheck`
   - `npm run lint`

## 排除项

- 不引入 Puppeteer / Playwright / pdf-lib 等服务器端 PDF 生成方案。
- 不改变用户「浏览器另存为 PDF」的使用流程。
- 不动 Excel 导出的现有逻辑。
