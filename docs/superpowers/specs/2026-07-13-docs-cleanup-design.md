# 项目文档整理与无用文件清理方案

> 目标：整理 qt-biz 项目文档，清理临时/备份/损坏文件，统一文档结构和命名规范。
> 编制日期：2026-07-13

---

## 1. 背景与范围

### 1.1 当前问题

- `docs/` 目录文件数量多、命名不统一，中英文混合，难以快速定位
- 一次性/阶段性文档（阶段验收、事故复盘、安全审查）与持续维护文档（设计规范、用户手册、部署方案）混在一起
- 项目根目录及源码旁存在临时/备份/损坏文件，未纳入 gitignore 或不应入版本库
- `.omc/.remember/.superpowers` 等工具目录积累运行时产物，需要审计清理

### 1.2 范围

- **整理**：`docs/` 目录下的所有 Markdown 文档
- **同步**：根目录入口文档 `README.md`、`CLAUDE.md`、`AGENTS.md`
- **清理**：源码旁的临时/备份/损坏文件
- **审计**：`.omc/.remember/.superpowers` 等工具目录

---

## 2. 设计原则

1. **持续维护文档与历史归档分离**：仍在更新的文档放在 `architecture/`、`user/`、`ops/`、`reference/`；一次性的阶段报告、复盘、审查放入 `history/`
2. **删除优于隐藏**：明显临时/备份/损坏的文件直接删除，不归档
3. **统一命名**：`docs/` 下所有文件名使用英文小写 + 连字符；中文标题保留在文件内
4. **最小破坏性**：不修改文件内容，只做移动、重命名、合并；合并时保留原始章节
5. **建立索引**：新增 `docs/README.md` 作为文档地图

---

## 3. 目标目录结构

```
docs/
├── README.md                        # 文档地图（新增）
├── architecture/                    # 架构与核心设计（持续维护）
│   ├── DESIGN-v3.md                 # 详细设计规范（保留原名，便于识别版本）
│   └── RLS.md                       # 行级安全部署说明
├── user/                            # 用户侧文档
│   └── USER_MANUAL.md               # 用户手册（保留原名）
├── ops/                             # 运维与部署
│   ├── db-bootstrap.md              # 数据库初始化
│   └── deploy-ecs.md                # 阿里云 ECS 部署方案 + 部署记录合并
├── reference/                       # 参考材料
│   ├── project-summary.md           # 项目总结
│   └── design-system-alignment.md   # 设计系统落地
└── history/                         # 历史归档（不再更新）
    ├── code-review/
    │   ├── code-review-announcement.md
    │   ├── code-review.md
    │   └── phase-review.md          # P2 + P3 阶段验收报告合并
    ├── postmortem/
    │   ├── contract-fake-close-recovery.md
    │   └── cron-silent-failure-postmortem.md
    └── security/
        └── login-security-review-2026-07-11.md
```

根目录入口文档保持不动：
- `README.md`：补充 docs/ 索引入口
- `CLAUDE.md`：项目级 Claude Code 指引
- `AGENTS.md`：贡献者规范与迁移规则

---

## 4. 文件清理清单

### 4.1 直接删除

| 文件/目录 | 原因 | 操作 |
|---|---|---|
| `.env.bak` | 环境变量备份，不应入版本库 | 删除 |
| `lib/copy.ts` | 无引用的复制文件 | 删除 |
| `docs/contract-fake-close-recovery-list.csv` | 数据文件混入文档目录 | 删除（如业务需要可移入 `ops/legacy/csv/`） |
| `docs/db-schema-snapshot.sql` | 可由 `prisma/migrations/` 生成 | 删除 |
| `docker-data/postgres.corrupt-20260703` | 损坏的 PostgreSQL 数据目录 | 删除 |
| `backups/profile-migration-2026-06-25-*` | 旧迁移备份 | 删除 |

### 4.2 移动/重命名

| 源路径 | 目标路径 | 说明 |
|---|---|---|
| `docs/CODE_REVIEW_ANNOUNCEMENT_MESSAGE.md` | `docs/history/code-review/code-review-announcement.md` | 代码审查公告 |
| `docs/CODE_REVIEW.md` | `docs/history/code-review/code-review.md` | 代码审查报告 |
| `docs/P2_REVIEW.md` + `docs/P3_REVIEW.md` | `docs/history/code-review/phase-review.md` | 合并阶段验收报告 |
| `docs/contract-fake-close-recovery.md` | `docs/history/postmortem/contract-fake-close-recovery.md` | 事故复盘 |
| `docs/cron-silent-failure-postmortem.md` | `docs/history/postmortem/cron-silent-failure-postmortem.md` | 事故复盘 |
| `docs/login-security-review-2026-07-11.md` | `docs/history/security/login-security-review-2026-07-11.md` | 安全审查 |
| `docs/PROJECT_SUMMARY.md` | `docs/reference/project-summary.md` | 项目总结 |
| `docs/RLS.md` | `docs/architecture/RLS.md` | RLS 说明 |
| `docs/DESIGN-v3.md` | `docs/architecture/DESIGN-v3.md` | 详细设计规范 |
| `docs/USER_MANUAL.md` | `docs/user/USER_MANUAL.md` | 用户手册 |
| `docs/企泰业务管理 · 设计系统落地 + 全部主要页对齐.md` | `docs/reference/design-system-alignment.md` | 设计系统落地 |
| `docs/db-bootstrap.md` | `docs/ops/db-bootstrap.md` | 数据库初始化 |
| `docs/阿里云 ECS 单主机部署方案 — qt-biz v0.1.0.md` + `docs/部署记录 — qt-biz v0.1.0 — Aliyun ECS.md` | `docs/ops/deploy-ecs.md` | 合并部署方案与记录 |

---

## 5. 合并规则

### 5.1 P2 + P3 Review → phase-review.md

- 保留两个文件的原始章节
- 新增顶层结构：`# Phase Review` → `## P2 阶段验收` / `## P3 阶段验收`
- 保留各自的时间、范围、完成度表格

### 5.2 ECS 部署方案 + 部署记录 → deploy-ecs.md

- 以部署方案为骨架
- 将部署记录作为 `## 实际部署记录` 附录章节
- 保留版本号、日期、操作步骤、回滚记录

---

## 6. 命名规范

- `docs/` 下所有文件名使用 **英文小写 + 连字符**
- 例外：`DESIGN-v3.md` 和 `USER_MANUAL.md` 因历史识别度高，保留原名
- 中文标题统一放在文件内部的 H1 标题
- `history/` 下的归档文件如原文件名含日期（如 `login-security-review-2026-07-11.md`），可保留日期以标识时间点

---

## 7. 工具目录审计策略

对 `.omc/.remember/.superpowers` 进行全面审计，原则如下：

- `.omc/skills/**`：项目级 skill，**保留**
- `.omc/state/`：当前/历史会话状态，**列出后删除过期会话**
- `.remember/logs/` 与 `.remember/tmp/`：**删除过期日志与临时文件**
- `.remember/archive.md`、`now.md`、`recent.md`：跨会话记忆，**保留**
- `.superpowers/`：检查内容，运行时产物 **删除**，配置类文件 **保留**

审计结果需在实施前向用户展示清单，确认后再删除。

---

## 8. 新增文件

### 8.1 docs/README.md

作为文档地图，包含：
- 项目简介与入口文档链接
- `architecture/`、`user/`、`ops/`、`reference/`、`history/` 的说明
- 每份文档的一句话用途
- 如何维护文档的简短说明

---

## 9. 验收标准

- [ ] `docs/` 目录结构符合本方案
- [ ] 所有应删除的临时/备份/损坏文件已删除
- [ ] 所有文档移动/重命名后，内部相对链接（如有）已更新
- [ ] `README.md` 已补充 docs/ 索引入口
- [ ] `docs/README.md` 已创建并包含完整文档地图
- [ ] `npm run typecheck` 通过（文档改动不影响 TS）
- [ ] `npm run lint` 通过
- [ ] 工具目录审计清单已展示并确认

---

## 10. 风险与回滚

- **风险**：移动或合并文档后，外部书签/引用失效。缓解：保留原始文件名在 `docs/README.md` 的"历史文件名对照表"中。
- **风险**：误删运行时目录影响当前会话。缓解：工具目录先审计列出，用户确认后再删除。
- **回滚**：所有删除/移动操作通过 git 管理，如需恢复可从 git 历史检出。
