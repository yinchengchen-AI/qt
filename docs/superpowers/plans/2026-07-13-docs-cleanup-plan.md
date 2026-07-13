# 项目文档整理与无用文件清理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按设计文档 `docs/superpowers/specs/2026-07-13-docs-cleanup-design.md` 整理 `docs/` 目录、清理临时/备份/损坏文件、统一命名规范，并建立文档索引。

**Architecture:** 通过目录分类（`architecture/`、`user/`、`ops/`、`reference/`、`history/`）将持续维护文档与历史归档分离；直接删除明显临时/备份/损坏文件；对工具目录先审计再清理；最终通过 `docs/README.md` 和根目录 `README.md` 提供文档地图。

**Tech Stack:** Git、Markdown、Bash、Node.js（用于 typecheck/lint 验证）。

## Global Constraints

- `docs/` 下所有文件名使用英文小写 + 连字符
- 例外：`DESIGN-v3.md` 和 `USER_MANUAL.md` 保留原名
- 不修改被移动/合并文档的核心内容，只调整章节标题和相对链接
- 所有删除/移动操作必须可通过 git 恢复
- 工具目录清理前必须先列出清单并确认
- 每次任务完成后运行 `git status --short` 确认变更符合预期

---

### Task 1: 删除临时/备份/损坏文件

**Files:**
- Delete: `.env.bak`
- Keep: `lib/copy.ts`（`app/(app)/admin/users/new/page.tsx` 仍依赖其 `copyToClipboard`，不删除；执行中曾误删，已从 git 历史恢复）
- Delete: `docs/contract-fake-close-recovery-list.csv`
- Delete: `docs/db-schema-snapshot.sql`
- Delete: `docker-data/postgres.corrupt-20260703`
- Delete: `backups/profile-migration-2026-06-25-104730`
- Delete: `backups/profile-migration-2026-06-25-105143`

**Interfaces:**
- Consumes: 设计文档 §4.1 清理清单
- Produces: 工作树中不再包含这些文件

- [ ] **Step 1: 确认文件存在并查看内容**

```bash
ls -la .env.bak docs/contract-fake-close-recovery-list.csv docs/db-schema-snapshot.sql
ls -ld docker-data/postgres.corrupt-20260703 backups/profile-migration-2026-06-25-*
```

Expected: 所有文件/目录均存在。

- [ ] **Step 2: 删除文件和目录**

```bash
rm -f .env.bak docs/contract-fake-close-recovery-list.csv docs/db-schema-snapshot.sql
rm -rf docker-data/postgres.corrupt-20260703 backups/profile-migration-2026-06-25-104730 backups/profile-migration-2026-06-25-105143
```

- [ ] **Step 3: 验证删除结果**

```bash
git status --short
```

Expected: 显示上述文件/目录为 `D`（deleted）状态。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "chore(docs): 删除临时/备份/损坏文件

- .env.bak
- docs/contract-fake-close-recovery-list.csv、docs/db-schema-snapshot.sql
- docker-data/postgres.corrupt-20260703
- backups/profile-migration-2026-06-25-*
- 保留 lib/copy.ts（被 admin 用户新增页依赖，误删后已从 git 历史恢复）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 创建新的 docs/ 目录结构

**Files:**
- Create: `docs/architecture/`（目录）
- Create: `docs/user/`（目录）
- Create: `docs/ops/`（目录）
- Create: `docs/reference/`（目录）
- Create: `docs/history/code-review/`（目录）
- Create: `docs/history/postmortem/`（目录）
- Create: `docs/history/security/`（目录）

**Interfaces:**
- Consumes: 设计文档 §3 目标目录结构
- Produces: 新的空目录结构

- [ ] **Step 1: 创建目录**

```bash
mkdir -p docs/architecture docs/user docs/ops docs/reference \
  docs/history/code-review docs/history/postmortem docs/history/security
```

- [ ] **Step 2: 验证目录结构**

```bash
find docs -maxdepth 2 -type d | sort
```

Expected: 输出包含上述所有新目录。

- [ ] **Step 3: 提交（目录为空时 git 不追踪，可跳过或保留到 Task 3 一起提交）**

此任务无需单独提交，目录将在文件移动后被 git 追踪。

---

### Task 3: 移动持续维护文档到目标目录

**Files:**
- Move: `docs/DESIGN-v3.md` → `docs/architecture/DESIGN-v3.md`
- Move: `docs/RLS.md` → `docs/architecture/RLS.md`
- Move: `docs/USER_MANUAL.md` → `docs/user/USER_MANUAL.md`
- Move: `docs/db-bootstrap.md` → `docs/ops/db-bootstrap.md`
- Move: `docs/PROJECT_SUMMARY.md` → `docs/reference/project-summary.md`
- Move: `docs/企泰业务管理 · 设计系统落地 + 全部主要页对齐.md` → `docs/reference/design-system-alignment.md`

**Interfaces:**
- Consumes: Task 2 创建的目录
- Produces: 持续维护文档位于新位置

- [ ] **Step 1: 移动文件**

```bash
git mv docs/DESIGN-v3.md docs/architecture/DESIGN-v3.md
git mv docs/RLS.md docs/architecture/RLS.md
git mv docs/USER_MANUAL.md docs/user/USER_MANUAL.md
git mv docs/db-bootstrap.md docs/ops/db-bootstrap.md
git mv "docs/PROJECT_SUMMARY.md" docs/reference/project-summary.md
git mv "docs/企泰业务管理 · 设计系统落地 + 全部主要页对齐.md" docs/reference/design-system-alignment.md
```

- [ ] **Step 2: 验证移动结果**

```bash
git status --short
find docs/architecture docs/user docs/ops docs/reference -type f | sort
```

Expected: `git status` 显示上述文件为 `R`（renamed）状态；`find` 输出 6 个文件。

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "chore(docs): 移动持续维护文档到分类目录

- architecture/: DESIGN-v3.md, RLS.md
- user/: USER_MANUAL.md
- ops/: db-bootstrap.md
- reference/: project-summary.md, design-system-alignment.md

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 移动历史归档文档到目标目录

**Files:**
- Move: `docs/CODE_REVIEW_ANNOUNCEMENT_MESSAGE.md` → `docs/history/code-review/code-review-announcement.md`
- Move: `docs/CODE_REVIEW.md` → `docs/history/code-review/code-review.md`
- Move: `docs/contract-fake-close-recovery.md` → `docs/history/postmortem/contract-fake-close-recovery.md`
- Move: `docs/cron-silent-failure-postmortem.md` → `docs/history/postmortem/cron-silent-failure-postmortem.md`
- Move: `docs/login-security-review-2026-07-11.md` → `docs/history/security/login-security-review-2026-07-11.md`

**Interfaces:**
- Consumes: Task 2 创建的目录
- Produces: 历史归档文档位于新位置

- [ ] **Step 1: 移动文件**

```bash
git mv docs/CODE_REVIEW_ANNOUNCEMENT_MESSAGE.md docs/history/code-review/code-review-announcement.md
git mv docs/CODE_REVIEW.md docs/history/code-review/code-review.md
git mv docs/contract-fake-close-recovery.md docs/history/postmortem/contract-fake-close-recovery.md
git mv docs/cron-silent-failure-postmortem.md docs/history/postmortem/cron-silent-failure-postmortem.md
git mv docs/login-security-review-2026-07-11.md docs/history/security/login-security-review-2026-07-11.md
```

- [ ] **Step 2: 验证移动结果**

```bash
git status --short
find docs/history -type f | sort
```

Expected: `git status` 显示上述文件为 `R` 状态；`find` 输出 5 个文件。

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "chore(docs): 移动历史归档文档到 history/ 分类目录

- code-review/: code-review-announcement.md, code-review.md
- postmortem/: contract-fake-close-recovery.md, cron-silent-failure-postmortem.md
- security/: login-security-review-2026-07-11.md

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 合并 P2/P3 Review 为 phase-review.md

**Files:**
- Create: `docs/history/code-review/phase-review.md`
- Delete: `docs/P2_REVIEW.md`
- Delete: `docs/P3_REVIEW.md`

**Interfaces:**
- Consumes: `docs/P2_REVIEW.md`、`docs/P3_REVIEW.md`
- Produces: `docs/history/code-review/phase-review.md`

- [ ] **Step 1: 创建合并后的文件**

```bash
cat > docs/history/code-review/phase-review.md << 'EOF'
# 阶段验收报告

> P2 + P3 阶段验收报告合并归档

---

EOF

# 追加 P2 内容并调整标题层级
echo "## P2 阶段验收" >> docs/history/code-review/phase-review.md
tail -n +2 docs/P2_REVIEW.md >> docs/history/code-review/phase-review.md

echo "" >> docs/history/code-review/phase-review.md
echo "---" >> docs/history/code-review/phase-review.md
echo "" >> docs/history/code-review/phase-review.md

# 追加 P3 内容并调整标题层级
echo "## P3 阶段验收" >> docs/history/code-review/phase-review.md
tail -n +2 docs/P3_REVIEW.md >> docs/history/code-review/phase-review.md
```

- [ ] **Step 2: 调整内部标题层级（将 P2/P3 原始 # 标题降级为 ###）**

```bash
# 将 P2 部分内的 # 标题降级为 ###（跳过文件开头的 ## P2 阶段验收）
python3 - << 'PYEOF'
from pathlib import Path
p = Path('docs/history/code-review/phase-review.md')
text = p.read_text(encoding='utf-8')
lines = text.splitlines()

result = []
section = None
for line in lines:
    if line.startswith('## P2 阶段验收'):
        section = 'p2'
        result.append(line)
        continue
    if line.startswith('## P3 阶段验收'):
        section = 'p3'
        result.append(line)
        continue
    if section in ('p2', 'p3') and line.startswith('# '):
        line = '### ' + line[2:]
    elif section in ('p2', 'p3') and line.startswith('## '):
        line = '#### ' + line[3:]
    result.append(line)

p.write_text('\n'.join(result) + '\n', encoding='utf-8')
PYEOF
```

- [ ] **Step 3: 删除原始文件**

```bash
git rm docs/P2_REVIEW.md docs/P3_REVIEW.md
```

- [ ] **Step 4: 验证合并结果**

```bash
git status --short
wc -l docs/history/code-review/phase-review.md
head -50 docs/history/code-review/phase-review.md
```

Expected: `git status` 显示 `docs/P2_REVIEW.md` 和 `docs/P3_REVIEW.md` 为 `D`，新文件为 `A`；合并文件同时包含 P2 和 P3 内容。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "chore(docs): 合并 P2/P3 Review 为 phase-review.md

- 新增 docs/history/code-review/phase-review.md
- 删除 docs/P2_REVIEW.md、docs/P3_REVIEW.md
- 保留原始章节，标题层级统一降级

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 合并 ECS 部署方案与部署记录为 deploy-ecs.md

**Files:**
- Create: `docs/ops/deploy-ecs.md`
- Delete: `docs/阿里云 ECS 单主机部署方案 — qt-biz v0.1.0.md`
- Delete: `docs/部署记录 — qt-biz v0.1.0 — Aliyun ECS.md`

**Interfaces:**
- Consumes: `docs/阿里云 ECS 单主机部署方案 — qt-biz v0.1.0.md`、`docs/部署记录 — qt-biz v0.1.0 — Aliyun ECS.md`
- Produces: `docs/ops/deploy-ecs.md`

- [ ] **Step 1: 创建合并后的文件**

```bash
SOURCE_PLAN="docs/阿里云 ECS 单主机部署方案 — qt-biz v0.1.0.md"
SOURCE_RECORD="docs/部署记录 — qt-biz v0.1.0 — Aliyun ECS.md"
TARGET="docs/ops/deploy-ecs.md"

# 写入部署方案内容
cp "$SOURCE_PLAN" "$TARGET"

# 追加部署记录作为附录
cat >> "$TARGET" << 'EOF'

---

# 实际部署记录

EOF

tail -n +2 "$SOURCE_RECORD" >> "$TARGET"
```

- [ ] **Step 2: 删除原始文件**

```bash
git rm "docs/阿里云 ECS 单主机部署方案 — qt-biz v0.1.0.md" "docs/部署记录 — qt-biz v0.1.0 — Aliyun ECS.md"
```

- [ ] **Step 3: 验证合并结果**

```bash
git status --short
wc -l docs/ops/deploy-ecs.md
grep -n "实际部署记录" docs/ops/deploy-ecs.md
```

Expected: 两个源文件为 `D`，`docs/ops/deploy-ecs.md` 为 `A`；文件中包含"实际部署记录"附录。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "chore(docs): 合并 ECS 部署方案与部署记录

- 新增 docs/ops/deploy-ecs.md
- 删除 阿里云 ECS 单主机部署方案、部署记录两个中文文件名
- 部署记录作为附录章节保留

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: 创建 docs/README.md 文档地图

**Files:**
- Create: `docs/README.md`

**Interfaces:**
- Consumes: 整理后的 docs/ 目录结构
- Produces: 文档地图

- [ ] **Step 1: 创建 docs/README.md**

```bash
cat > docs/README.md << 'EOF'
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
| [DESIGN-v3.md../../architecture/DESIGN-v3.md) | 详细设计规范 |
| [RLS.md../../architecture/RLS.md) | 行级安全（RLS）部署说明 |

### user/ — 用户手册

| 文档 | 说明 |
|---|---|
| [USER_MANUAL.md../../user/USER_MANUAL.md) | 最终用户操作手册 |

### ops/ — 运维与部署

| 文档 | 说明 |
|---|---|
| [db-bootstrap.md../../ops/db-bootstrap.md) | 数据库初始化 |
| [deploy-ecs.md../../ops/deploy-ecs.md) | 阿里云 ECS 单主机部署方案与记录 |

### reference/ — 参考材料

| 文档 | 说明 |
|---|---|
| [project-summary.md../../reference/project-summary.md) | 项目总结 |
| [design-system-alignment.md../../reference/design-system-alignment.md) | 设计系统落地与主要页面对齐 |

### history/ — 历史归档（不再更新）

#### code-review/

| 文档 | 说明 |
|---|---|
| [code-review-announcement.md../../history/code-review/code-review-announcement.md) | 代码审查公告 |
| [code-review.md../../history/code-review/code-review.md) | 代码审查报告 |
| [phase-review.md../../history/code-review/phase-review.md) | P2/P3 阶段验收报告 |

#### postmortem/

| 文档 | 说明 |
|---|---|
| [contract-fake-close-recovery.md../../history/postmortem/contract-fake-close-recovery.md) | 合同误关闭恢复复盘 |
| [cron-silent-failure-postmortem.md../../history/postmortem/cron-silent-failure-postmortem.md) | 定时任务静默失败复盘 |

#### security/

| 文档 | 说明 |
|---|---|
| [login-security-review-2026-07-11.md../../history/security/login-security-review-2026-07-11.md) | 登录安全审查报告 |

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
| `docs/企泰业务管理 · 设计系统落地 + 全部主要页对齐.md` | `docs/reference/design-system-alignment.md` |
| `docs/db-bootstrap.md` | `docs/ops/db-bootstrap.md` |
| `docs/阿里云 ECS 单主机部署方案 — qt-biz v0.1.0.md` | 并入 `docs/ops/deploy-ecs.md` |
| `docs/部署记录 — qt-biz v0.1.0 — Aliyun ECS.md` | 并入 `docs/ops/deploy-ecs.md` |
| `docs/contract-fake-close-recovery.md` | `docs/history/postmortem/contract-fake-close-recovery.md` |
| `docs/cron-silent-failure-postmortem.md` | `docs/history/postmortem/cron-silent-failure-postmortem.md` |
| `docs/login-security-review-2026-07-11.md` | `docs/history/security/login-security-review-2026-07-11.md` |

## 维护说明

- 新增持续维护文档请放入 `architecture/`、`user/`、`ops/` 或 `reference/` 对应分类
- 新增一次性报告、复盘、审查请放入 `history/` 下对应子目录
- 文件名使用英文小写 + 连字符，中文标题保留在文件内部 H1
EOF
```

- [ ] **Step 2: 验证文件**

```bash
git status --short
grep -c "##" docs/README.md
```

Expected: `docs/README.md` 为 `A`；文件包含多个二级标题。

- [ ] **Step 3: 提交**

```bash
git add docs/README.md
git commit -m "chore(docs): 新增 docs/README.md 文档地图

- 提供项目入口文档链接
- 列出 architecture/user/ops/reference/history 全部文档
- 提供历史文件名对照表

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: 更新根目录 README.md 的文档索引

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: `docs/README.md`
- Produces: 根 README.md 中新增 docs/ 入口

- [ ] **Step 1: 在 README.md 中找到合适位置插入 docs/ 入口**

在 README.md 的"项目文档"或"开发指南"附近（如不存在则在文件开头附近）添加：

```markdown
## 文档索引

完整文档地图见 [docs/README.md../../README.md)。

主要入口：
- [设计规范../../architecture/DESIGN-v3.md)
- [用户手册../../user/USER_MANUAL.md)
- [部署方案../../ops/deploy-ecs.md)
- [项目总结../../reference/project-summary.md)
```

- [ ] **Step 2: 验证修改**

```bash
git diff README.md
```

Expected: README.md 出现新增"文档索引"章节。

- [ ] **Step 3: 提交**

```bash
git add README.md
git commit -m "chore(docs): 根 README.md 补充 docs/ 文档索引

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: 审计并清理工具目录

**Files:**
- `.omc/`
- `.remember/`
- `.superpowers/`

**Interfaces:**
- Consumes: 设计文档 §7 工具目录审计策略
- Produces: 清理后的工具目录清单

- [ ] **Step 1: 列出工具目录内容**

```bash
find .omc -maxdepth 3 -type f | head -50
find .remember -maxdepth 2 -type f | sort
find .superpowers -maxdepth 3 -type f | head -50
```

- [ ] **Step 2: 识别可删除项**

根据设计文档 §7：
- `.omc/state/sessions/` 中过期的会话文件
- `.remember/logs/` 中的过期日志
- `.remember/tmp/` 中的临时文件
- `.superpowers/` 中的运行时产物

将清单记录到临时文件：

```bash
cat > /tmp/tools-cleanup-list.txt << 'EOF'
# 待清理项示例，请根据实际情况调整
.omc/state/sessions/{过期会话ID}/...
.remember/logs/...
.remember/tmp/...
.superpowers/...
EOF
```

- [ ] **Step 3: 向用户展示清单并确认**

```bash
cat /tmp/tools-cleanup-list.txt
```

Expected: 用户确认后执行删除。

- [ ] **Step 4: 执行删除（用户确认后）**

```bash
# 示例命令，具体路径根据 Step 2 清单调整
# rm -rf .remember/logs/*
# rm -rf .remember/tmp/*
# rm -rf .omc/state/sessions/{过期会话ID}
# rm -rf .superpowers/{运行时产物}
```

- [ ] **Step 5: 验证清理结果**

```bash
git status --short
```

Expected: 工具目录中的非 git 追踪文件变更不会显示（这些目录通常在 .gitignore 中）。

- [ ] **Step 6: 提交（如有变更）**

如果清理导致 git 追踪文件变更，提交：

```bash
git add -A
git commit -m "chore(docs): 清理工具目录过期会话与日志

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: 最终验证

**Files:**
- All docs/ files
- `README.md`

**Interfaces:**
- Consumes: 前面所有任务的产出
- Produces: 验证通过的结果

- [ ] **Step 1: 检查 docs/ 最终结构**

```bash
find docs -type f | sort
```

Expected: 输出与设计文档 §3 一致，无遗留中文命名文件在 docs/ 根目录。

- [ ] **Step 2: 检查是否有死链接或残留文件**

```bash
ls docs/*.md 2>/dev/null || echo "docs/ 根目录已无 markdown 文件"
```

Expected: 没有输出或显示无 markdown 文件。

- [ ] **Step 3: 运行类型检查（确保没有引用被移动/删除文件）**

```bash
npm run typecheck 2>&1 | tail -20
```

Expected: 0 errors。

- [ ] **Step 4: 运行 lint**

```bash
npm run lint 2>&1 | tail -20
```

Expected: 无新增 lint 错误（文档改动通常不影响 lint）。

- [ ] **Step 5: 检查 git 状态**

```bash
git status --short
```

Expected: 工作树干净（无未提交变更）。

- [ ] **Step 6: 完成标记**

无需提交，所有任务已完成。

---

## 自审结果

- **Spec coverage**: 设计文档中所有要求（目录结构、删除清单、合并、命名规范、docs/README.md、根 README.md 索引、工具目录审计）均已对应到任务。
- **Placeholder scan**: 无 TBD、TODO、"implement later" 等占位符；Task 9 中的具体路径需根据实际审计清单调整，这是预期行为。
- **Type consistency**: 不涉及代码类型，所有文件路径已精确给出。

---

## 执行方式

Plan complete and saved to `docs/superpowers/plans/2026-07-13-docs-cleanup-plan.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
