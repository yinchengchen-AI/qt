# qt-biz 项目代码审查报告

> **项目**: 杭州企泰安全科技业务管理系统 (qt-biz)  
> **审查日期**: 2026-06-10  
> **审查范围**: 项目结构、Schema、API Routes、Service Layer、验证器、认证授权、审计日志、领域事件、定时任务、前端页面  
> **整体评分**: **B+**

---

## 一、项目概况

| 维度 | 评估 |
|------|------|
| **技术栈** | Next.js 16 + React 19 + TypeScript + Prisma 7 + PostgreSQL + Ant Design |
| **架构模式** | App Router API Routes + Service Layer + Prisma ORM |
| **代码规模** | 约 50+ API 路由，13+ 服务模块，完整的 CRUD + 状态机 + 统计 + 导出 |
| **整体评分** | **B+** — 架构清晰、安全设计到位，但在性能优化、类型安全和工程化方面仍有提升空间 |

---

## 二、架构设计（优秀 ✅）

### 2.1 分层架构清晰

项目采用良好的分层设计：

- **API Route** (`app/api/*/route.ts`)：负责 HTTP 接入、参数校验、鉴权、响应封装
- **Service Layer** (`server/services/*.ts`)：负责业务逻辑、事务管理、领域事件发射
- **Data Access** (`lib/prisma.ts`)：Prisma Client 统一入口

### 2.2 统一基础设施

- `lib/api.ts`：统一的 `ok()` / `err()` 响应封装，`ApiError` 带错误码
- `lib/session.ts`：`requireSession()` 统一鉴权入口
- `server/audit.ts`：审计日志自动脱敏（password、bankAccount、phone 等 13 个敏感字段）

### 2.3 领域事件与定时任务

- `server/events/bus.ts`：事务内发射领域事件，写入 Message 表，并触发外部通道（fire-and-forget）
- `server/jobs/runner.ts`：4 类定时任务（合同到期、发票超期、项目到期、客户静默），带当天去重机制

---

## 三、安全与权限（良好 ✅，有小问题 ⚠️）

### 3.1 认证授权

- **JWT + Credentials** 登录，8 小时会话有效期
- **每次请求查 DB 验证用户状态**（防止 DISABLED 后旧 token 仍可用）— 安全性高但性能开销大
- **RBAC 权限矩阵**：4 角色（ADMIN/SALES/FINANCE/OPS）硬编码，权限粒度到资源+操作

### 3.2 数据隔离

- **SALES 行级隔离**：通过 `ownershipWhere` 或 `contract: { ownerUserId: user.id }` 过滤
- **RLS 兜底**：`lib/rls.ts` 在事务内设置 PostgreSQL GUC 变量

### 3.3 安全问题 ⚠️

| 问题 | 位置 | 风险 | 建议 |
|------|------|------|------|
| 测试账号硬编码 | `app/login/page.tsx:81-84` | 生产环境暴露测试入口 | 使用环境变量 `NODE_ENV` 条件渲染，或彻底移除 |
| 默认密码 123456 | `server/services/user.ts:126` | 新用户创建后密码可预测 | 强制首次登录修改密码，或生成随机密码后邮件发送 |
| 无 Rate Limiting | 全局 | 暴力破解/爬虫风险 | 增加 `rate-limiter-flexible` 或 Nginx 层限流 |
| 无 CSP 配置 | `next.config.js` | XSS 风险 | 配置 Content-Security-Policy |
| JWT 无 Refresh Token | `lib/auth.ts` | 8 小时后强制重新登录 | 增加 Refresh Token 机制 |

---

## 四、数据模型与数据库（良好 ✅，有优化空间 ⚠️）

### 4.1 Schema 设计亮点

- 软删除通过 `deletedAt` 实现
- 金额字段使用 `@db.Decimal(18,2)`，避免浮点误差
- 时间戳使用 `@db.Timestamptz(6)`，带时区
- `Sequence` 表实现原子性业务编号生成（upsert + RETURNING）

### 4.2 已知问题

| 问题 | 位置 | 影响 | 建议 |
|------|------|------|------|
| Enum 用 String 存储 | `prisma/schema.prisma` | 类型安全丧失，运行时可能传入非法值 | 在 Zod 校验层严格校验，或等 Prisma 修复后迁移回 enum |
| 缺少复合索引 | `Contract`/`Invoice` 等 | 按 `ownerUserId + status + deletedAt` 查询时性能下降 | 增加 `@@index([ownerUserId, status, deletedAt])` |
| Message.link 为 Json | `schema.prisma` | 按 link 查询时无法利用索引 | 若查询频繁，考虑拆分为独立字段 |
| 无数据库 CHECK 约束 | 金额相关字段 | 发票金额超合同总额等校验仅在应用层 | 增加 PostgreSQL CHECK 约束作为最终防线 |

---

## 五、业务逻辑与代码质量（良好 ✅，有改进点 ⚠️）

### 5.1 亮点

- **状态机完整**：合同（DRAFT→PENDING_REVIEW→EFFECTIVE）、发票、回款、项目均有状态流转
- **业务规则校验严格**：发票金额不超合同总额、回款不超发票金额、合同日期逻辑校验
- **事务使用规范**：关键操作（创建合同+项目、回款确认+更新发票）均使用 `prisma.$transaction`
- **防环检测**：部门树移动时通过向上遍历检测环

### 5.2 代码质量问题

| 问题 | 位置 | 影响 | 建议 |
|------|------|------|------|
| `as any` 类型断言 | `server/services/contract.ts` 等 | 类型安全丧失 | 定义正确的 Prisma Input 类型，或扩展 Prisma Client |
| 函数过长 | `contract.ts` 创建/更新 | 可读性、可维护性下降 | 拆分为：校验→构建数据→执行事务→发射事件 |
| N+1 查询 | `statistics.ts:getTopCustomers` | 每个客户单独查合同/发票/回款 | 使用 `groupBy` + `in` 查询，或引入缓存 |
| 统计服务循环查询 | `statistics.ts:getSalesPerformance` | 每个销售单独 4 次查询 | 使用 SQL 聚合或 Prisma 的 `groupBy` 优化 |
| 定时任务无分布式锁 | `server/jobs/runner.ts` | 多实例部署时重复执行 | 增加 Redis 分布式锁或 PostgreSQL Advisory Lock |

---

## 六、API 设计（良好 ✅，有规范问题 ⚠️）

### 6.1 优点

- RESTful 风格统一
- 统一的 Zod 校验层 (`lib/validators/*.ts`)
- 兼容老用法的字典查询 (`?category=xxx`)

### 6.2 问题

| 问题 | 位置 | 建议 |
|------|------|------|
| 错误响应未区分类型 | 所有 `route.ts` | Zod 错误返回 400 + 字段详情，业务错误返回 409/403，系统错误返回 500 |
| 部分路由缺少校验 | `dashboard/summary` 的 `from/to` | 增加日期格式和范围校验 |
| 无 API 版本控制 | 全局 | 建议路径增加 `/api/v1/` 前缀 |
| 无 OpenAPI/Swagger | 全局 | 增加文档生成（如 `next-swagger-doc`） |

---

## 七、前端代码（一般 ⚠️）

| 问题 | 位置 | 建议 |
|------|------|------|
| 测试账号快速填充 | `app/login/page.tsx:173-185` | 生产环境必须移除，或加 `process.env.NODE_ENV === 'development'` 判断 |
| 硬编码备案号 | `app/login/page.tsx:191` | 使用环境变量配置 |
| 无错误边界 | 全局 | 增加 `error.tsx` 和 `global-error.tsx` |
| 无 Loading 骨架屏 | 数据列表页 | 增加 `loading.tsx` 或 Suspense fallback |

---

## 八、工程化与 DevOps（一般 ⚠️）

| 问题 | 位置 | 建议 |
|------|------|------|
| ESLint 规则降级 | `.eslintrc.json` | `react-hooks/exhaustive-deps` 等降为 `warn`，建议恢复为 `error` |
| `tsconfig.tsbuildinfo` 未忽略 | 根目录 | 加入 `.gitignore`（文件 805KB） |
| 缺少单元测试 | `vitest` 已配置 | 核心服务层（权限、金额计算、状态机）应补充测试 |
| 无 Docker 配置 | 根目录 | 增加 `Dockerfile` + `docker-compose.yml` |
| 无健康检查端点 | 全局 | 增加 `/api/health` 路由 |
| `.env.example` 不完整 | 根目录 | 补充 `NEXTAUTH_SECRET` 生成说明、数据库 URL 格式 |

---

## 九、关键风险项（需优先处理 🔴）

1. **生产环境测试账号暴露** — 安全风险最高
2. **定时任务无分布式锁** — 部署多实例时必然重复执行
3. **统计查询 N+1** — 数据量增长后性能急剧下降
4. **Enum 用 String 存储** — 数据完整性依赖应用层校验
5. **JWT 每次请求查 DB** — 高并发时数据库压力增大

---

## 十、改进建议优先级

| 优先级 | 事项 | 预估工作量 |
|--------|------|-----------|
| P0 | 移除/条件化登录页测试账号 | 30 分钟 |
| P0 | 增加定时任务分布式锁 | 2 小时 |
| P1 | 优化统计查询（N+1 → 聚合查询） | 4 小时 |
| P1 | 增加 Rate Limiting | 2 小时 |
| P1 | 增加 API 错误分类响应 | 3 小时 |
| P2 | 补充核心服务单元测试 | 8 小时 |
| P2 | 增加 Docker 配置 | 2 小时 |
| P2 | 增加数据库复合索引 | 1 小时 |
| P3 | 增加 Refresh Token 机制 | 4 小时 |
| P3 | 增加 OpenAPI 文档 | 4 小时 |

---

## 十一、总结

qt-biz 是一个**架构清晰、业务规则完整、安全设计用心**的企业级管理系统。作者在权限隔离、审计日志、状态机、领域事件等方面展现了良好的工程素养。主要改进空间集中在**性能优化（统计查询、JWT 验证）、生产环境安全（测试账号、限流）、工程化完善（测试、Docker、文档）**三个方面。

建议优先处理 P0 和 P1 项，即可将项目提升至 **A-** 级别。
