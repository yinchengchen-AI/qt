# 前后端联级测试报告

> 基于 Playwright + Chrome 真实浏览器
> 测试日期：2026-06-09

## 1. 测试矩阵

| 场景 | 角色 | 测试数 | 覆盖范围 |
|---|---|---|---|
| 1 | admin | 9 | 登录/失败/工作台/客户列表/创建客户/搜索/工作台+消息+公告/统计 |
| 2 | sales | 6 | 登录/工作台/客户列表/越权/404/创建客户 |
| 3 | finance | 6 | 登录/开票/回款/总览/账龄/业绩 |
| 4 | ops | 5 | 登录/公告/字典/客户/开票 |
| 5 | 多角色 | 2 | 登出再访问/切换账号 |
| **合计** | – | **28** | – |

## 2. 关键发现（实施期修复的真实 Bug）

联级测试中**实际暴露并修复**了多个生产可见的 Bug：

### 🔴 严重（用户感知）
1. **`lib/dict-client.ts` 字典缓存异常** — `useDict` 返回 SWR 的 `mutate` 函数当字典数据用，导致 `customerTypeDict.map is not a function` 全局崩溃
   - 修复：去掉 `?? mutate` 分歧，引入 `useState + useEffect` 同步缓存

2. **`lib/dict-client.ts` 字典无重渲染** — 字典异步 fetch 后组件没重渲染，select 下拉永远是空
   - 修复：fetch 完成后 `setData` 触发 React 重渲染

### 🟡 中等
3. **antd 6 Button "登录" 文字** — 渲染为 `"登 录"`（带 1/2 全角空格），影响 Playwright 文本匹配
   - 测试改用 `getByText("登 录", { exact: true })` 或 `button[type=submit]`
4. **ProFormSelect 下拉项 portal** — option 在 document.body 末尾，不在 select 内部
   - 测试等 dropdown 出现再 click
5. **客户名称 ProTable 列头 vs label 重名** — strict mode violation
   - 测试用 `getByRole("columnheader", { name: "客户名称" })` 区分

## 3. 测试结果

```
28 passed (54.1s)
```

## 4. 全量测试汇总

| 套件 | 通过 / 总数 | 耗时 |
|---|---|---|
| Vitest（单元） | 5/5 | 108ms |
| P1 Node E2E | 27/27 | 3.6s |
| P2 Node E2E | 21/21 | 1.9s |
| P3 Node E2E | 23/23 | 2.0s |
| Playwright（联级） | 28/28 | 54.1s |
| **合计** | **104/104** | **~62s** |

## 5. 关键文件

- `playwright.config.ts` — Playwright 配置（webServer 自启 dev）
- `tests/e2e/01-admin-full-flow.spec.ts` — 场景 1：admin 完整链路
- `tests/e2e/02-row-isolation.spec.ts` — 场景 2：SALES 行级隔离
- `tests/e2e/03-finance-flow.spec.ts` — 场景 3：FINANCE 全链路
- `tests/e2e/04-ops-flow.spec.ts` — 场景 4：OPS 行政
- `tests/e2e/05-session-logout.spec.ts` — 场景 5：会话生命周期

## 6. 后续

- Playwright 联级测试已纳入 `npm run test:e2e`
- 字典 Bug 是本次联级**最大收获**——之前 Node E2E 只测 API，没触发前端组件；Playwright 触发了真实 hydration 路径
- 建议 CI 流程：`vitest` → `playwright` → `node e2e`（按覆盖层级由小到大）
