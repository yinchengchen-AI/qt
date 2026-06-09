# 企泰业务管理 · 设计系统落地 + 全部主要页对齐

## Summary

把登录页的「深海军蓝 + 安全琥珀」视觉语言做成全站设计令牌,并抽出 `PageHeader / Page / StatGrid / StatusTag` 等公共组件,落到 19 个主要页(Dashboard、5 列表、5 详情、3 表单、3 统计、消息/公告),让侧栏保留白底但用新强调色。`/admin/*` 不动(其中 3 页是 P3 计划内的占位),`/not-found` 顺手换成新风格。完成后 E2E 截图对比验证。

## Design Tokens(单点改、全站生效)

新增 `app/tokens.css`(独立 CSS 文件被 `globals.css` 引用)定义 CSS 变量;在 `app/layout.tsx` 把同一组值透传给 antd `ConfigProvider.theme.token`,保证 antd 组件和我手写的组件颜色一致。

| Token | 值 | 用途 |
| --- | --- | --- |
| `--qt-navy-900` | `#0a1c33` | colorPrimary、品牌主色 |
| `--qt-navy-700` | `#0f2a47` | hover / 描边 |
| `--qt-navy-500` | `#1e3a5f` | 次要按钮 |
| `--qt-amber-500` | `#f59e0b` | warning、强调徽章 |
| `--qt-amber-300` | `#fbbf24` | hover、装饰渐变 |
| `--qt-success` | `#10b981` | 成功态 |
| `--qt-error`   | `#ef4444` | 错误态 |
| `--qt-bg`      | `#f6f8fb` | 页面底色 |
| `--qt-surface` | `#ffffff` | 卡片底色 |
| `--qt-border`  | `#e2e8f0` | 描边 |
| `--qt-text-1`  | `#0f172a` | 主文字 |
| `--qt-text-2`  | `#475569` | 次文字 |
| `--qt-text-3`  | `#94a3b8` | 辅助文字 |
| `--qt-radius`  | `10px`   | 卡片 / 按钮 |
| `--qt-radius-sm` | `6px`  | 标签 / 输入 |

antd `ConfigProvider.theme`:`colorPrimary=#0a1c33`,`colorInfo=#0f2a47`,`colorWarning=#f59e0b`,`colorSuccess=#10b981`,`colorError=#ef4444`,`borderRadius=10`,`fontSize=14`。

## 新增公共组件(全部在 `components/`)

- **`components/page-header.tsx`** + `page-header.module.css`
  Props:`title`、`subtitle?`、`back?`(boolean 或 string,渲染 `←`)、`actions?: ReactNode`、`breadcrumb?: { label, href? }[]`、`meta?: ReactNode`(右上角 metadata 槽)。
  视觉:大标题 22px / 700、灰副标题、底部 1px 边线、可选面包屑、右侧 action 区。
- **`components/page.tsx`** + `page.module.css`
  薄包装,统一 `padding: 24px 28px; max-width: 1440px;` 居中,所有主区页都过它。
- **`components/stat-grid.tsx`** + `stat-grid.module.css`
  替代 Dashboard / 统计页的裸 `ProCard split="vertical"`,支持 `columns` 控制栅格;`items: { label, value, prefix?, suffix?, delta?, tone? }[]`。Dashboard 顶部的 4 个数字 + 账龄 4 个桶用它统一。
- **`components/status-tag.tsx`** + `status-tag.module.css`
  把所有页面里散落的 `STATUS_COLOR: Record<string, string>` 收口。props:`status`、`type: 'customer' | 'contract' | 'project' | 'invoice' | 'payment' | 'message' | 'announcement'`。色板统一:default / info(navy) / processing(amber) / success(green) / warning / danger。
- **`components/empty-state.tsx`** + `empty-state.module.css`
  统一加载中 / 错误 / 真空态。Props:`loading?`、`error?`、`empty?`、`icon?`、`description?`、`action?: ReactNode`。
- **`components/qt-mark.tsx`**
  复用登录页的 Q 字标 SVG(内联),`size` 控制尺寸,放在侧栏头部和移动端品牌条。

新增 `lib/status.ts`:导出每个业务域的 `STATUS_PALETTE` 和 `formatStatus(status, type)` 工具函数,供 `StatusTag` 和各页 `valueEnum` 复用,消除重复的 `STATUS_COLOR` 常量。

## Shell 调整(只换强调色)

`components/dashboard-shell.tsx`:
- `ProLayout` 传 `token={{ colorTextMenuSelected: '#0a1c33', colorBgMenuItemSelected: 'rgba(15,42,71,0.08)', sider: { colorMenuBackground: '#ffffff' } }}` 保持白底,只换选中色
- 头部 logo 文字「企泰业务管理」前加 `<QtMark size={28} />`,与登录页 Q 字标呼应
- `BellOutlined` 区域不动
- `Drawer` `width={420}` 不变(那 2 个 deprecation warning 是 antd 6 升级遗留,本任务不动)

## Page-by-page 变更

**Dashboard / 工作台**(`app/dashboard/page.tsx`)
- 用 `<Page>` + `<PageHeader title="工作台" subtitle="业务关键指标实时概览" />` 包裹
- 顶部 4 个 KPI(合同额 / 已开票额 / 已回款额 / 未回款额)用 `<StatGrid columns={4}>` 替掉 `ProCard split="vertical"` + 4 个 `StatisticCard`
- 应收账款账龄 4 桶用 `<StatGrid columns={4}>` + 90+ 自动套 danger tone

**5 个列表页**(customers / contracts / projects / invoices / payments)
- `Page > PageHeader(title, subtitle="描述该页能做什么") + actions: 新建按钮`
- 保留 `ProTable`(查询/分页/列配置现成的),只换外壳:加 `cardBordered={false}` + `search={{ labelWidth: 'auto' }}`,表格容器去掉默认 padding,背景透到 page 底色
- 把每个页内联的 `STATUS_COLOR` 替换为 `formatStatus(row.status, 'customer' | 'contract' | …)` + `<StatusTag>`

**5 个详情页**(customers/[id] / contracts/[id] / projects/[id] / invoices/[id] / payments/[id])
- `Page > PageHeader(back: true, title: 实体名 + 编号, extra: [编辑/删除])`
- `ProDescriptions` 维持,但包一层 `<EmptyState loading isLoading error>` 处理
- 跟进记录 / 关联合同 / 附件 这些子区块统一用 `<PageHeader level={2}>`(缩小版)+ 表格,不再裸 `ProCard title`

**3 个表单页**(customers/new、customers/[id]/edit、contracts/new、projects/new、invoices/new、payments/new)
- `Page > PageHeader(back, title, subtitle)`
- 表单本身保留 `ProForm`(它和权限/字典配合最稳),但通过 ConfigProvider 已经统一色,无需大改;只把页面级 `padding` 收一下

**3 个统计页**(statistics/overview, /aging, /performance)
- `Page > PageHeader(title, subtitle, extra: [RangePicker, 导出按钮])`
- 顶部 4 卡片用 `<StatGrid>`
- 图表用 `@ant-design/charts` 保留(色板已经在 antd 主题里影响),外层包 `<Card bordered={false}>` 收紧

**消息 / 公告**(`/messages`, `/announcements`)
- `Page > PageHeader`
- `messages` 把类型枚举替换为 `formatStatus(row.type, 'message')`
- `announcements` 编辑弹窗保留 antd Modal,内部用 antd Form 即可(由主题色统一)

**Admin**(users / roles / dictionaries / operation-logs)
- users 已经是 `Alert` 占位,加 `<PageHeader title="用户管理" subtitle="P3 阶段实施">` 包一下即可
- 其余 3 页用 `<Page>` + `<PageHeader>` 包现有 `ProTable`

**全局错误/404**(`app/not-found.tsx`)
- 重写成跟登录同语言的「404 · 找不到页面」卡,带 Q 字标 + 「返回工作台」按钮,延续深色品牌色块装饰

## Key files changed

- 新建:`app/tokens.css`、`components/page.tsx`+css、`components/page-header.tsx`+css、`components/stat-grid.tsx`+css、`components/status-tag.tsx`+css、`components/empty-state.tsx`+css、`components/qt-mark.tsx`、`lib/status.ts`
- 改:`app/layout.tsx`(接 tokens)、`app/globals.css`(引入 tokens.css)、`app/not-found.tsx`、`components/dashboard-shell.tsx`(logo + ProLayout token)
- 改 19 个 page:`app/dashboard/page.tsx` + `app/{customers,contracts,projects,invoices,payments}/page.tsx` + `app/{customers,contracts,projects,invoices,payments}/[id]/page.tsx` + 5 个 new/edit 表单 + 3 个 statistics + `app/messages/page.tsx` + `app/announcements/page.tsx` + 4 个 admin 子页

## Out of scope(明确不做)

- `/admin/*` 的实际功能实现(都是 P3 占位,只包壳)
- 任何后端 / Prisma / API 改动
- antd 6 deprecation 警告(`Drawer.width` / `Statistic.valueStyle`)——是 pro-components 旧 API 引起,不在本任务范围
- 移动端深度优化(只确保不破版)
- 新增 / 删除业务功能
- 国际化(继续中文)
- 暗色模式

## Test plan

实现完成后跑 Playwright 真机验证:
1. **路由全绿**:`for p in /login /dashboard /customers /customers/{一个真实 id} /customers/new /contracts /projects /invoices /payments /statistics/overview /statistics/aging /statistics/performance /messages /announcements /admin/users /admin/roles /admin/dictionaries /admin/operation-logs /not-found` 全部 `code=200`
2. **视觉对比**:`/tmp/qt-shots/after-{dashboard,customers,contracts,projects,statistics,detail,form}.png`,目检:
   - 标题 / 副标题层级一致
   - 主按钮、链接、focus 描边都是海军蓝系
   - 状态 Tag 颜色统一(amber=进行中 / green=成功 / red=失败)
   - 侧栏选中态是海军蓝字 + 浅蓝底
3. **回归**:`admin/123456` 登录 → 工作台 / 客户列表 / 客户详情三连走通
4. **lint/typecheck**:`pnpm lint && pnpm typecheck` 无新增 error(已有的 antd 6 deprecation 忽略)

## Assumptions

- 侧栏白底,只换 ProLayout `token` 内的选中色 / 链接色,不动背景和折叠行为
- antd `ConfigProvider.theme` 改动 = 一次到位,无需额外做「暗色 / 主题切换」开关
- 19 个主要页是按「最高频 + 最有展示价值」选的:业务核心流程 13 个 + 统计 / 消息 / 公告 + 4 个 admin 占位;`/login` 已在新版,不在本批次改动;`/api/*` 不动
- `StatusTag` 的色板按业务域集中映射,但允许页面级 `formatStatus` 临时调整一个例外(比如合同 `EXPIRED` 偏 volcano,这种保留覆盖能力,不强制全收口)
- 不引入新依赖,只用 antd + pro-components + @ant-design/charts + 已装的 dayjs
- 接受 antd 6 + pro-components 3.1.12 的 2 个 deprecation warning 共存(本任务不修)
