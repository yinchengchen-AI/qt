# 项目文档地图

本文档汇总了 qt-biz 项目的所有文档入口。

## 项目入口文档

| 文档 | 说明 |
|---|---|
| [README.md](/README.md) | 项目总览、开发环境、构建与部署 |
| [CLAUDE.md](/CLAUDE.md) | Claude Code 项目指引 |
| [AGENTS.md](/AGENTS.md) | 贡献者规范、数据库迁移规则 |

## 文档目录

### architecture/ — 架构与核心设计

| 文档 | 说明 |
|---|---|
| [DESIGN-v3.md](./architecture/DESIGN-v3.md) | 详细设计规范 |
| [RLS.md](./architecture/RLS.md) | 行级安全（RLS）部署说明 |

### user/ — 用户手册

| 文档 | 说明 |
|---|---|
| [USER_MANUAL.md](./user/USER_MANUAL.md) | 最终用户操作手册 |

### ops/ — 运维与部署

| 文档 | 说明 |
|---|---|
| [db-bootstrap.md](./ops/db-bootstrap.md) | 数据库初始化 |
| [deploy-ecs.md](./ops/deploy-ecs.md) | 阿里云 ECS 单主机部署方案与记录 |

### reference/ — 参考材料

| 文档 | 说明 |
|---|---|
| [project-summary.md](./reference/project-summary.md) | 项目总结 |
| [design-system-alignment.md](./reference/design-system-alignment.md) | 设计系统落地与主要页面对齐 |

### history/ — 历史归档（不再更新）

#### code-review/

| 文档 | 说明 |
|---|---|
| [code-review-announcement.md](./history/code-review/code-review-announcement.md) | 代码审查公告 |
| [code-review.md](./history/code-review/code-review.md) | 代码审查报告 |
| [phase-review.md](./history/code-review/phase-review.md) | P2/P3 阶段验收报告 |

#### postmortem/

| 文档 | 说明 |
|---|---|
| [contract-fake-close-recovery.md](./history/postmortem/contract-fake-close-recovery.md) | 合同误关闭恢复复盘 |
| [cron-silent-failure-postmortem.md](./history/postmortem/cron-silent-failure-postmortem.md) | 定时任务静默失败复盘 |

#### security/

| 文档 | 说明 |
|---|---|
| [login-security-review-2026-07-11.md](./history/security/login-security-review-2026-07-11.md) | 登录安全审查报告 |

#### test-reports/

| 文档 | 说明 |
|---|---|
| [playwright-e2e-report.md](./history/test-reports/playwright-e2e-report.md) | Playwright E2E 测试报告 |

## 历史文件名对照表

| 旧文件名 | 新位置 |
|---|---|
| `docs/CODE_REVIEW_ANNOUNCEMENT_MESSAGE.md` | `docs/history/code-review/code-review-announcement.md` |
| `docs/CODE_REVIEW.md` | `docs/history/code-review/code-review.md` |
| `docs/P2_REVIEW.md` | 并入 `docs/history/code-review/phase-review.md` |
| `docs/P3_REVIEW.md` | 并入 `docs/history/code-review/phase-review.md` |
| `docs/PROJECT_SUMMARY.md` | `docs/reference/project-summary.md` |
| `docs/RLS.md` | `docs/architecture/RLS.md` |
| `docs/DESIGN-v3.md` | `docs/architecture/DESIGN-v3.md` |
| `docs/USER_MANUAL.md` | `docs/user/USER_MANUAL.md` |
| `docs/ 企泰业务管理 · 设计系统落地 + 全部主要页对齐.md` | `docs/reference/design-system-alignment.md` |
| `docs/db-bootstrap.md` | `docs/ops/db-bootstrap.md` |
| `docs/阿里云 ECS 单主机部署方案 — qt-biz v0.1.0.md` | 并入 `docs/ops/deploy-ecs.md` |
| `docs/部署记录 — qt-biz v0.1.0 — Aliyun ECS.md` | 并入 `docs/ops/deploy-ecs.md` |
| `docs/contract-fake-close-recovery.md` | `docs/history/postmortem/contract-fake-close-recovery.md` |
| `docs/cron-silent-failure-postmortem.md` | `docs/history/postmortem/cron-silent-failure-postmortem.md` |
| `docs/login-security-review-2026-07-11.md` | `docs/history/security/login-security-review-2026-07-11.md` |
| `docs/PLAYWRIGHT_E2E_REPORT.md` | `docs/history/test-reports/playwright-e2e-report.md` |

## 维护说明

- 新增持续维护文档请放入 `architecture/`、`user/`、`ops/` 或 `reference/` 对应分类
- 新增一次性报告、复盘、审查请放入 `history/` 下对应子目录
- 文件名使用英文小写 + 连字符，中文标题保留在文件内部 H1
