# qt-biz 文档地图

## 入口

| 文档 | 内容 |
|---|---|
| [../README.md](../README.md) | 项目入口, 快速开始 + 技术栈 + 最近更新 |
| [../CHANGELOG.md](../CHANGELOG.md) | 每个版本的详细变更 |
| [architecture/DESIGN-v3.md](architecture/DESIGN-v3.md) | 系统设计 (数据库 / RLS / 权限 / 业务流程) |

## 用户手册

- [user/USER_MANUAL.md](user/USER_MANUAL.md) — 业务人员操作手册

## 运维 (ops/)

| 文档 | 内容 |
|---|---|
| [ops/deploy-current.md](ops/deploy-current.md) | **当前部署流程** (v0.13.8+);日常部署只看这份 |
| [ops/deploy-history/](ops/deploy-history/) | 历史部署记录与事故复盘 (v0.1.0 ~ v0.13.7) |
| [ops/db-bootstrap.md](ops/db-bootstrap.md) | 数据库初始化 / 迁移漂移恢复 |
| [ops/dictionary-maintenance.md](ops/dictionary-maintenance.md) | 字典维护 (合同状态 / 客户类型 等) |

## 架构 (architecture/)

- [architecture/DESIGN-v3.md](architecture/DESIGN-v3.md) — v3 设计
- [architecture/RLS.md](architecture/RLS.md) — 行级安全策略
- [reference/design-system-alignment.md](reference/design-system-alignment.md) — 设计系统对齐
- [reference/project-summary.md](reference/project-summary.md) — 项目摘要

## 规范 (specs/)

- [specs/dict-redesign.md](specs/dict-redesign.md) — 字典重设计

## 计划 (superpowers/plans/)

历史规划与方案文档, 实施后归档。`specs/` 是设计稿, `plans/` 是执行稿。

## 事故复盘 (history/)

- [history/postmortem/cron-silent-failure-postmortem.md](history/postmortem/cron-silent-failure-postmortem.md) — 2025-09~2026-06 cron 静默失败 9 个月
- [history/postmortem/contract-fake-close-recovery.md](history/postmortem/contract-fake-close-recovery.md) — 合同假完结恢复
- [history/security/login-security-review-2026-07-11.md](history/security/login-security-review-2026-07-11.md) — 登录安全加固复盘
- [history/code-review/code-review-announcement.md](history/code-review/code-review-announcement.md) — code review 流程公告
- [history/code-review/phase-review.md](history/code-review/phase-review.md) — 阶段评审
