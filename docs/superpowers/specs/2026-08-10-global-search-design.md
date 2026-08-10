# 全局搜索设计文档

- 日期：2026-08-10
- 状态：已确认（方案 A）
- 范围：顶栏搜索框，跨 客户 / 合同 / 发票 / 回款 四类实体检索

## 1. 背景与目标

系统现有各列表页的关键字过滤相互独立，用户无法跨模块快速定位记录（如"来个电话反查客户"、"按发票号找合同"）。本设计在 DashboardShell 顶栏新增全局搜索框，输入即显示分组下拉结果，点击直达详情页或跳转对应列表页查看全部。

## 2. 方案选型

| 方案 | 结论 |
|---|---|
| A. 聚合搜索 API + 顶栏 AutoComplete | **采用**：单次请求、载荷精简、权限收口 |
| B. 前端并行复用 4 个列表 API | 否决：每次击键 4 请求，keyword 口径不统一 |
| C. pg_trgm 全文检索 | 否决：数据量小，ILIKE 足够，YAGNI |

## 3. 架构与改动清单

新增：

- `app/api/search/route.ts` — 聚合搜索路由（薄壳）
- `server/services/search.ts` — `searchAll(user, q)` 聚合查询
- `lib/validators/search.ts` — Zod 校验 `q`（trim，1~50 字符）
- `components/global-search.tsx` — 顶栏搜索组件（`"use client"`）
- `tests/api/search.test.ts` — Vitest 接口测试
- `tests/e2e/global-search.spec.ts` — Playwright 冒烟（可选）

改造：

- `components/dashboard-shell.tsx` — Header 插入 `<GlobalSearch/>`
- `app/(app)/customers/page.tsx`、`contracts/page.tsx`、`invoices/page.tsx`、`payments/page.tsx` — 各支持 URL `?keyword=` 作为 ProTable 搜索表单初值（沿用 customers 页 `district/town` 初值模式）

## 4. API 契约

`GET /api/search?q={keyword}`

```json
{
  "q": "企泰",
  "customers": { "total": 3, "items": [{ "id", "code", "name", "shortName", "contactName", "contactPhone" }] },
  "contracts": { "total": 1, "items": [{ "id", "contractNo", "title", "customerName", "status" }] },
  "invoices":  { "total": 0, "items": [{ "id", "invoiceNo", "customerName", "amount", "status" }] },
  "payments":  { "total": 2, "items": [{ "id", "paymentNo", "customerName", "amount", "status" }] }
}
```

- 每组 `items` 最多 5 条，按 `updatedAt` 倒序；`total` 为该组命中总数
- 金额字段（`amount`）由 `Prisma.Decimal` 转 string 返回，前端用 `lib/money.ts` 格式化
- 路由遵循现有薄壳惯例：`runWithRequestContext` → `requireSession()` → Zod 校验 → `searchAll(user, q)` → `ok(data)` / `err(e)`
- 不新增权限点；任何登录用户可调用，行级隔离在 service 层兜底
- 只读操作，不写 `OperationLog`

## 5. 搜索字段（宽字段方案）

匹配方式：Prisma `contains` + `mode: "insensitive"`（沿用 contract crud 现有写法）。

| 实体 | 字段 |
|---|---|
| Customer | `code` / `name` / `shortName` / `unifiedSocialCreditCode` / `contactName` / `contactPhone` |
| Contract | `contractNo` / `title` / `customerName` |
| Invoice | `invoiceNo` / `invoiceCode` / `customerName` |
| Payment | `paymentNo` / `bankRefNo` / `customer.name`（经关系） |

`searchAll` 内部 `Promise.all` 并行 4 个查询（各 `findMany(take: 5)` + `count`）。

## 6. 行级隔离与软删除

- SALES / EXPERT：Customer、Contract 用 `ownerEq(user)`；Invoice、Payment 用 `ownerViaContract(user)`（来自 `lib/ownership.ts`），与列表页口径完全一致，`total` 也是隔离后口径
- ADMIN / FINANCE / OPS：全量
- 所有查询带 `deletedAt: null`，回收站数据不出现在结果中

## 7. 前端交互

- antd `AutoComplete`，`popupMatchSelectWidth: 420`，`SearchOutlined` 前缀，占位"搜客户 / 合同号 / 发票号 / 回款单"
- 防抖 300ms；`q` trim 后 < 2 字符不发请求；GET 请求带 `AbortController`，新请求 abort 旧请求防乱序
- 下拉按四类分组渲染：组头显示"分类名 (total)"与"全部 ›"；条目显示主行（命中片段 `<mark>` 高亮，主题色 token）+ 次要行（编号 / 客户名 / 状态徽标）
- 点击条目 → `router.push` 详情页；点击"全部 ›" → 对应列表页 `?keyword=xxx`
- 键盘：↑↓ 移动、Enter 进入选中项、Esc 收起；无结果时显示"未找到匹配 xxx 的记录"
- 加载中显示 spinner；接口失败降级为下拉里一行"搜索失败，请重试"，不弹全局 message
- 桌面端：搜索框约 220~260px，位于面包屑与消息铃铛之间；移动端（`isPhone`）只显示搜索图标，点击展开全宽输入框（沿用现有 isMobile 适配模式）

## 8. 边界与异常

- `q` < 2 字符：service 直接返回空分组，不查库（Zod `min(1)` 仅防直接调 API）
- LIKE 通配符：`% _ \` 在 service 层转义（Prisma `contains` 不自动转义）
- 超长输入：Zod 截断至 50 字符
- 无命中：返回全空分组（`total: 0, items: []`），不报错

## 9. 测试

`tests/api/search.test.ts`（Vitest）：

1. 按客户名 / 合同号 / 发票号 / 回款单号 / 信用代码 / 联系人电话各命中一次，断言分组与字段
2. SALES 用户只返回自己名下记录且 `total` 正确；ADMIN 返回全量
3. 空 q、1 字符 q、超长 q、含 `%_` 的 q 的行为
4. 无命中返回全空分组而非报错
5. 软删除记录不出现

`tests/e2e/global-search.spec.ts`（Playwright，可选）：登录后顶栏输入关键字，断言下拉出现分组与条目，点击跳转详情页。

## 10. 实施顺序

1. `lib/validators/search.ts`
2. `server/services/search.ts` + 单测
3. `app/api/search/route.ts`
4. `components/global-search.tsx`
5. DashboardShell Header 集成
6. 4 个列表页 `?keyword=` 初值支持
7. e2e 冒烟（可选）
