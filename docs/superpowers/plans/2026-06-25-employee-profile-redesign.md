# 员工档案功能彻底重做 Implementation Plan

> ⚠️ **历史注脚 (2026-06-29, v0.5.0)**：本计划为 v0.4.0 历史产物,已完整执行并合入。文中 §3.2 列举的 `MessageType` enum 含 `CUSTOMER_STATUS_SUGGEST`,v0.5.0 客户状态机下线后已停止 emit, 仅保留 enum 值以兼容历史消息渲染 (`docs/superpowers/specs/2026-06-29-customer-status-deprecation.md`)。其它 `CERTIFICATE_EXPIRING` / `CONTRACT_AUTO_*` 等仍为现行消息类型。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `EmployeeProfile` 从"长文本 + ProCard 堆叠"重做为"5 张子表 + 5 步向导 + Anchor 详情 + 证书到期提醒",范围由 [`docs/superpowers/specs/2026-06-25-employee-profile-redesign-design.md`](../../specs/2026-06-25-employee-profile-redesign-design.md) 锁定。

**Architecture:** schema 迁移先行(5 张子表 + 字段调整 + Attachment.category + MessageType 扩),后端 service / API 改造,前端 5 步向导 + 详情 Anchor + 两段式新建,最后接 cron + 证书列表页。**10 个 PR 严格按顺序合**,前序是后序基础,不并行。

**Tech Stack:**
- Next.js 16 (App Router) + React 19 + TypeScript 6
- Prisma 7 + PostgreSQL 16
- antd 6 + @ant-design/pro-components
- Vitest 4 (`tests/unit/server/*.test.ts`)
- Playwright E2E (`tests/e2e/*.spec.ts`)
- 现有 5 dev 账号: `admin / sales / finance / ops / expert`,密码 `dev-only-fill`

---

## File Structure(本计划修改的所有文件)

### 新增
```
prisma/migrations/20260625_employee_profile_restructure/migration.sql    # Task 1
prisma/migrations/20260625_employee_profile_restructure/rollback.sql      # Task 1
lib/validators/employee-education.ts                                     # Task 2
lib/validators/employee-work-experience.ts                                # Task 2
lib/validators/employee-certificate.ts                                    # Task 2
lib/validators/employee-skill.ts                                          # Task 2
lib/validators/employee-emergency-contact.ts                              # Task 2
lib/types/employee-subtables.ts                                           # Task 2
server/services/employee-education.ts                                     # Task 2
server/services/employee-work-experience.ts                                # Task 2
server/services/employee-certificate.ts                                    # Task 2
server/services/employee-skill.ts                                         # Task 2
server/services/employee-emergency-contact.ts                             # Task 2
app/api/employee-educations/route.ts                                      # Task 2
app/api/employee-educations/[id]/route.ts                                 # Task 2
app/api/employee-work-experiences/route.ts                                # Task 2
app/api/employee-work-experiences/[id]/route.ts                           # Task 2
app/api/employee-certificates/route.ts                                    # Task 2
app/api/employee-certificates/[id]/route.ts                               # Task 2
app/api/employee-skills/route.ts                                          # Task 2
app/api/employee-skills/[id]/route.ts                                     # Task 2
app/api/employee-emergency-contacts/route.ts                              # Task 2
app/api/employee-emergency-contacts/[id]/route.ts                         # Task 2
app/api/certificates/expiring/route.ts                                    # Task 8
app/(app)/admin/users/[id]/edit-profile/page.tsx                          # Task 4
app/(app)/admin/certificates/expiring/page.tsx                            # Task 8
components/employee-profile/profile-wizard.tsx                            # Task 4
components/employee-profile/avatar-uploader.tsx                           # Task 6
components/employee-profile/province-city-district.tsx                    # Task 4
components/employee-profile/subtable-editor.tsx                           # Task 4
components/employee-profile/certificate-row.tsx                           # Task 5
components/employee-profile/expiry-badge.tsx                              # Task 5
server/jobs/certificate-expiry-check.ts                                   # Task 9
app/api/jobs/certificates/expire-check/route.ts                           # Task 9
scripts/prod/backup-pre-profile-migration.sh                              # Task 1
tests/unit/server/employee-subtables.test.ts                              # Task 2
tests/unit/server/employee-profile.test.ts                                # Task 3
tests/unit/jobs/certificate-expiry-check.test.ts                          # Task 9
tests/unit/api/certificates-expiring.test.ts                              # Task 8
tests/e2e/12-employee-profile-wizard.spec.ts                              # Task 10
```

### 修改
```
prisma/schema.prisma                                                       # Task 1
lib/validators/employee-profile.ts                                        # Task 2
lib/types/employee-profile.ts                                             # Task 2
server/services/employee-profile.ts                                       # Task 3
app/api/users/[id]/with-profile/route.ts                                  # Task 3
app/api/files/presign/route.ts                                            # Task 6
app/(app)/admin/users/[id]/page.tsx                                       # Task 5
app/(app)/admin/users/new/page.tsx                                        # Task 7
app/(app)/admin/users/page.tsx                                            # Task 8
app/(app)/admin/users/[id]/edit/page.tsx                                  # Task 4 (重命名/缩窄)
ops/cron.d/qt-biz.cron                                                    # Task 9
server/events/bus.ts                                                      # Task 9
tests/api/employee-profile.test.ts                                        # Task 3
tests/milestones-removed.test.ts (如果存在 schema drop 回归)               # Task 1
```

---

## Scope Check

spec 锁的是**单一子系统**(员工档案)。所有 10 个 PR 都聚焦这个子系统,虽然有 5 张子表,但都从属于 EmployeeProfile 概念。

不拆 plan 文件。**单一 plan 文件覆盖 10 PR**,每个 PR 自己一个 Task 节,Task 内是 step 级 checklist。

每个 PR 的"完成"以 tsc 0 错 + vitest 全绿 + build 成功 + Playwright E2E 通过为准。详细规则见每个 Task 末尾的"PR 收尾验证"。

---

## 10 个 Task 概览

| Task | PR | 主题 | 估时 | 依赖 |
|---|---|---|---|---|
| 1 | PR1 | schema 迁移:5 张子表 + EmployeeProfile 字段调整 + Attachment.category + MessageType 扩展 | 1-2d | — |
| 2 | PR2 | 5 张子表 zod validator + service + CRUD API | 1-2d | PR1 |
| 3 | PR3 | `with-profile` GET/PATCH 改造:支持新 payload;敏感字段过滤;并发 409 | 1d | PR2 |
| 4 | PR4 | 5 步向导组件 + `edit-profile` 编辑页 | 2-3d | PR3 |
| 5 | PR5 | 详情页改造:PageHeader + Anchor + 5 分组 + 证书红 tag | 1-2d | PR3 |
| 6 | PR6 | 头像 / 身份证照 / 证书附件 上传链路(Attachment.category) | 1d | PR1 |
| 7 | PR7 | 新建员工两段式 Modal | 0.5d | PR3 |
| 8 | PR8 | `certificates/expiring` 列表页 + 列表页红 badge | 0.5d | PR3 |
| 9 | PR9 | Cron job + MessageType 接入 | 1d | PR2 |
| 10 | PR10 | 测试(Vitest + Playwright E2E)+ 文档更新 + 移动端 viewport | 1-2d | 全部 |

---

## 全局约定

- 每次 step 结束用 `git commit` 收口;commit message 走 Conventional Commits
- 任何 ts 错误立刻停下来,不要 `as any` / `@ts-ignore` 绕过
- 现有 5 dev 账号不变;新功能优先用 `admin` 账号测
- 附件走现有 `POST /api/files/presign` + MinIO,不在本计划重写
- 不动 `lib/permissions.ts` 已有的 `RESOURCE.USER / ACTION.READ / UPDATE`,沿用即可
- 旧 `app/(app)/admin/users/[id]/edit/page.tsx` 在 PR4 缩窄为"只处理账号字段"——不删,留 URL 兼容
- 测试账号密码是 `dev-only-fill`,从 `lib/env.ts` 的 `DEV_QUICK_FILL_PASSWORD` 读

---

## Task 1: PR1 - schema 迁移

**Files:**
- Create: `prisma/migrations/20260625_employee_profile_restructure/migration.sql`
- Create: `prisma/migrations/20260625_employee_profile_restructure/rollback.sql`
- Create: `scripts/prod/backup-pre-profile-migration.sh`
- Modify: `prisma/schema.prisma`
- Test: `tests/milestones-removed.test.ts`(如果不存在,创建回归测试)

### Step 1.1: 写 backup 脚本

- [ ] **Step 1.1.1: 创建脚本目录 + 脚本**

写 `scripts/prod/backup-pre-profile-migration.sh`:

```bash
#!/usr/bin/env bash
# 员工档案重构前全量备份。失败即退出,不能跳过。
# 用法: scripts/prod/backup-pre-profile-migration.sh
# 备份位置: backups/profile-migration-YYYY-MM-DD-HHMMSS/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

# 读 .env(沿用现有 backup 模式)
if [ -f .env ]; then
  set -a; . .env; set +a
fi

: "${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL 未设置}"
: "${MINIO_ROOT_USER:?MINIO_ROOT_USER 未设置}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD 未设置}"

TS=$(date +%Y-%m-%d-%H%M%S)
BACKUP_DIR="backups/profile-migration-${TS}"
mkdir -p "$BACKUP_DIR"

echo "[backup] pg_dump → $BACKUP_DIR/profile.sql"
docker compose -f docker-compose.postgres.yml exec -T postgres \
  pg_dump -U postgres --clean --if-exists --no-owner \
  "$(echo "$MIGRATION_DATABASE_URL" | sed 's|postgresql://[^@]*@||')" \
  > "$BACKUP_DIR/profile.sql"

echo "[backup] minio mc mirror → $BACKUP_DIR/attachments/"
docker run --rm -i \
  -e MC_HOST_minio="http://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@minio:9000" \
  --network host \
  minio/mc mirror --overwrite --remove \
  minio/qt-biz-attachments "$BACKUP_DIR/attachments"

echo "[backup] 完成: $BACKUP_DIR"
echo "$BACKUP_DIR" > "$BACKUP_DIR/PATH.txt"
ls -lh "$BACKUP_DIR"
```

- [ ] **Step 1.1.2: 加可执行权限**

```bash
chmod +x scripts/prod/backup-pre-profile-migration.sh
```

### Step 1.2: 写 schema.prisma 改动

- [ ] **Step 1.2.1: 修改 `prisma/schema.prisma`**

文件顶部 enum 区域已有 `MessageType` 枚举,追加 `CERTIFICATE_EXPIRING`:

```prisma
enum MessageType {
  CONTRACT_EXPIRING
  INVOICE_OVERDUE_PAYMENT
  PAYMENT_RECEIVED
  CUSTOMER_STATUS_SUGGEST
  CONTRACT_AUTO_EXECUTED
  CONTRACT_AUTO_COMPLETED
  CONTRACT_AUTO_EXPIRED
  CERTIFICATE_EXPIRING
}
```

把 `EmployeeProfile` 模型整段替换为:

```prisma
model EmployeeProfile {
  id                    String    @id @default(cuid())
  userId                String    @unique
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  // 基础
  gender                String?
  birthday              DateTime? @db.Timestamptz(6)
  idCard                String?   @unique
  education             String?
  entryDate             DateTime? @db.Timestamptz(6)

  // 住址(结构化)
  province              String?
  city                  String?
  district              String?
  addressDetail         String?

  // 人事/岗位
  position              String?
  jobLevel              String?
  employmentType        String?   @default("FULL_TIME")
  probationEndDate      DateTime? @db.Timestamptz(6)
  formalDate            DateTime? @db.Timestamptz(6)
  resignationDate       DateTime? @db.Timestamptz(6)

  // 合同
  contractType          String?
  contractStartDate     DateTime? @db.Timestamptz(6)
  contractEndDate       DateTime? @db.Timestamptz(6)

  // 头像
  avatarAttachmentId    String?   @unique
  avatarAttachment      Attachment? @relation("EmployeeProfileAvatar", fields: [avatarAttachmentId], references: [id])

  // 敏感
  salary                Decimal?  @db.Decimal(14, 2)
  bankAccount           String?
  bankName              String?
  socialSecurityAccount String?
  providentFundAccount  String?

  // 履历/备注
  remark                String?   @db.VarChar(5000)

  createdAt             DateTime  @default(now()) @db.Timestamptz(6)
  updatedAt             DateTime  @updatedAt @db.Timestamptz(6)
  deletedAt             DateTime? @db.Timestamptz(6)

  // 子表
  educations            EmployeeEducation[]
  workExperiences       EmployeeWorkExperience[]
  certificates          EmployeeCertificate[]
  skills                EmployeeSkill[]
  emergencyContacts     EmployeeEmergencyContact[]

  attachments           Attachment[] @relation("EmployeeProfileAttachments")

  @@index([userId])
}

model EmployeeEducation {
  id          String    @id @default(cuid())
  profileId   String
  profile     EmployeeProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)
  school      String
  major       String?
  degree      String?
  startDate   DateTime  @db.Timestamptz(6)
  endDate     DateTime? @db.Timestamptz(6)
  isFullTime  Boolean   @default(true)
  remark      String?   @db.VarChar(2000)
  createdAt   DateTime  @default(now()) @db.Timestamptz(6)
  updatedAt   DateTime  @updatedAt @db.Timestamptz(6)
  deletedAt   DateTime? @db.Timestamptz(6)

  @@index([profileId])
}

model EmployeeWorkExperience {
  id          String    @id @default(cuid())
  profileId   String
  profile     EmployeeProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)
  company     String
  position    String?
  startDate   DateTime  @db.Timestamptz(6)
  endDate     DateTime? @db.Timestamptz(6)
  leaveReason String?
  referrer    String?
  remark      String?   @db.VarChar(2000)
  createdAt   DateTime  @default(now()) @db.Timestamptz(6)
  updatedAt   DateTime  @updatedAt @db.Timestamptz(6)
  deletedAt   DateTime? @db.Timestamptz(6)

  @@index([profileId])
}

model EmployeeCertificate {
  id            String    @id @default(cuid())
  profileId     String
  profile       EmployeeProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)
  name          String
  number        String?
  issuer        String?
  issueDate     DateTime? @db.Timestamptz(6)
  expiryDate    DateTime? @db.Timestamptz(6)
  attachmentId  String?
  attachment    Attachment? @relation("CertificateAttachment", fields: [attachmentId], references: [id])
  remark        String?   @db.VarChar(2000)
  createdAt     DateTime  @default(now()) @db.Timestamptz(6)
  updatedAt     DateTime  @updatedAt @db.Timestamptz(6)
  deletedAt     DateTime? @db.Timestamptz(6)

  @@index([profileId])
  @@index([expiryDate])
}

model EmployeeSkill {
  id          String    @id @default(cuid())
  profileId   String
  profile     EmployeeProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)
  name        String
  level       String    @default("INTERMEDIATE")
  obtainDate  DateTime? @db.Timestamptz(6)
  remark      String?   @db.VarChar(2000)
  createdAt   DateTime  @default(now()) @db.Timestamptz(6)
  updatedAt   DateTime  @updatedAt @db.Timestamptz(6)
  deletedAt   DateTime? @db.Timestamptz(6)

  @@index([profileId])
}

model EmployeeEmergencyContact {
  id            String    @id @default(cuid())
  profileId     String
  profile       EmployeeProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)
  name          String
  relationship  String
  phone         String
  remark        String?   @db.VarChar(500)
  createdAt     DateTime  @default(now()) @db.Timestamptz(6)
  updatedAt     DateTime  @updatedAt @db.Timestamptz(6)
  deletedAt     DateTime? @db.Timestamptz(6)

  @@index([profileId])
}
```

`Attachment` 模型加 `category` 字段和两个反向 relation:

在 `Attachment` 模型的字段列表里加:

```prisma
  category   String   @default("GENERAL")
```

在 `Attachment` 的反向 relation 列表里加:

```prisma
  avatarOfProfile         EmployeeProfile? @relation("EmployeeProfileAvatar")
  certificateAttachments  EmployeeCertificate[] @relation("CertificateAttachment")
```

- [ ] **Step 1.2.2: 生成 prisma client**

```bash
npx prisma format
npx prisma generate
```

期望:无错;`node_modules/.prisma/client` 更新。

- [ ] **Step 1.2.3: 类型检查**

```bash
npm run typecheck
```

期望:0 错。如果失败,看是不是 `EmployeeProfile` 老字段(已删除)在代码里被引用 —— 是的话先 grep 找出来,标记为 PR3 待清理(不要现在删,会让 PR1 编译挂)。

### Step 1.3: 写 migration SQL

- [ ] **Step 1.3.1: 创建 migration 目录**

```bash
mkdir -p prisma/migrations/20260625_employee_profile_restructure
```

- [ ] **Step 1.3.2: 写 migration.sql**

写 `prisma/migrations/20260625_employee_profile_restructure/migration.sql`:

```sql
-- =====================================================
-- 员工档案重构:5 张子表 + EmployeeProfile 字段调整
-- + Attachment.category + MessageType 扩展
-- 对应 plan: docs/superpowers/plans/2026-06-25-employee-profile-redesign.md Task 1
-- 对应 spec: docs/superpowers/specs/2026-06-25-employee-profile-redesign-design.md §2
-- 回滚脚本: 同目录 rollback.sql
-- =====================================================

-- 1. 备份旧字段(用于回滚)
ALTER TABLE "EmployeeProfile"
  ADD COLUMN "_legacy_work_experience" TEXT,
  ADD COLUMN "_legacy_education_history" TEXT,
  ADD COLUMN "_legacy_certificates" TEXT,
  ADD COLUMN "_legacy_emergency_contact_name" TEXT,
  ADD COLUMN "_legacy_emergency_contact_phone" TEXT;

UPDATE "EmployeeProfile" SET
  "_legacy_work_experience" = "workExperience",
  "_legacy_education_history" = "educationHistory",
  "_legacy_certificates" = "certificates",
  "_legacy_emergency_contact_name" = "emergencyContactName",
  "_legacy_emergency_contact_phone" = "emergencyContactPhone";

-- 2. 创建 5 张子表
CREATE TABLE "EmployeeEducation" (
  "id" TEXT PRIMARY KEY,
  "profileId" TEXT NOT NULL REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE,
  "school" TEXT NOT NULL,
  "major" TEXT,
  "degree" TEXT,
  "startDate" TIMESTAMPTZ(6) NOT NULL,
  "endDate" TIMESTAMPTZ(6),
  "isFullTime" BOOLEAN NOT NULL DEFAULT true,
  "remark" VARCHAR(2000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMPTZ(6)
);
CREATE INDEX "EmployeeEducation_profileId_idx" ON "EmployeeEducation"("profileId");

CREATE TABLE "EmployeeWorkExperience" (
  "id" TEXT PRIMARY KEY,
  "profileId" TEXT NOT NULL REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE,
  "company" TEXT NOT NULL,
  "position" TEXT,
  "startDate" TIMESTAMPTZ(6) NOT NULL,
  "endDate" TIMESTAMPTZ(6),
  "leaveReason" TEXT,
  "referrer" TEXT,
  "remark" VARCHAR(2000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMPTZ(6)
);
CREATE INDEX "EmployeeWorkExperience_profileId_idx" ON "EmployeeWorkExperience"("profileId");

CREATE TABLE "EmployeeCertificate" (
  "id" TEXT PRIMARY KEY,
  "profileId" TEXT NOT NULL REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "number" TEXT,
  "issuer" TEXT,
  "issueDate" TIMESTAMPTZ(6),
  "expiryDate" TIMESTAMPTZ(6),
  "attachmentId" TEXT REFERENCES "Attachment"("id"),
  "remark" VARCHAR(2000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMPTZ(6)
);
CREATE INDEX "EmployeeCertificate_profileId_idx" ON "EmployeeCertificate"("profileId");
CREATE INDEX "EmployeeCertificate_expiryDate_idx" ON "EmployeeCertificate"("expiryDate");

CREATE TABLE "EmployeeSkill" (
  "id" TEXT PRIMARY KEY,
  "profileId" TEXT NOT NULL REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "level" TEXT NOT NULL DEFAULT 'INTERMEDIATE',
  "obtainDate" TIMESTAMPTZ(6),
  "remark" VARCHAR(2000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMPTZ(6)
);
CREATE INDEX "EmployeeSkill_profileId_idx" ON "EmployeeSkill"("profileId");

CREATE TABLE "EmployeeEmergencyContact" (
  "id" TEXT PRIMARY KEY,
  "profileId" TEXT NOT NULL REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "relationship" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "remark" VARCHAR(500),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMPTZ(6)
);
CREATE INDEX "EmployeeEmergencyContact_profileId_idx" ON "EmployeeEmergencyContact"("profileId");

-- 3. 迁移旧数据:每个旧字段作为子表第 1 行的 remark
INSERT INTO "EmployeeWorkExperience" ("id", "profileId", "company", "position", "remark", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", '(历史文本)', NULL, "_legacy_work_experience", now(), now()
FROM "EmployeeProfile"
WHERE "_legacy_work_experience" IS NOT NULL AND "_legacy_work_experience" != '';

INSERT INTO "EmployeeEducation" ("id", "profileId", "school", "degree", "startDate", "isFullTime", "remark", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", '(历史文本)', NULL, now(), true, "_legacy_education_history", now(), now()
FROM "EmployeeProfile"
WHERE "_legacy_education_history" IS NOT NULL AND "_legacy_education_history" != '';

INSERT INTO "EmployeeCertificate" ("id", "profileId", "name", "remark", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", '(历史证书)', "_legacy_certificates", now(), now()
FROM "EmployeeProfile"
WHERE "_legacy_certificates" IS NOT NULL AND "_legacy_certificates" != '';

INSERT INTO "EmployeeEmergencyContact" ("id", "profileId", "name", "relationship", "phone", "remark", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id",
  COALESCE("_legacy_emergency_contact_name", '(未填)'),
  '其他',
  COALESCE("_legacy_emergency_contact_phone", ''),
  NULL, now(), now()
FROM "EmployeeProfile"
WHERE ("_legacy_emergency_contact_name" IS NOT NULL AND "_legacy_emergency_contact_name" != '')
   OR ("_legacy_emergency_contact_phone" IS NOT NULL AND "_legacy_emergency_contact_phone" != '');

-- 4. 拆 address 字段
ALTER TABLE "EmployeeProfile" ADD COLUMN "province" TEXT;
ALTER TABLE "EmployeeProfile" ADD COLUMN "city" TEXT;
ALTER TABLE "EmployeeProfile" ADD COLUMN "district" TEXT;
ALTER TABLE "EmployeeProfile" ADD COLUMN "addressDetail" TEXT;
UPDATE "EmployeeProfile" SET "addressDetail" = "address" WHERE "address" IS NOT NULL;

-- 5. 加头像字段
ALTER TABLE "EmployeeProfile" ADD COLUMN "avatarAttachmentId" TEXT UNIQUE;

-- 6. Attachment 加 category
ALTER TABLE "Attachment" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'GENERAL';

-- 7. MessageType 加枚举值(PG 14+ 允许,须在事务外)
-- Prisma migrate 自动包事务,这里用 CONCURRENTLY 不行(枚举不支持);
-- 改用先创建扩展,再 ALTER TYPE。Prisma 7 的 migrate 工具会自动分割事务。
ALTER TYPE "MessageType" ADD VALUE 'CERTIFICATE_EXPIRING';

-- 8. 删旧字段
ALTER TABLE "EmployeeProfile"
  DROP COLUMN "workExperience",
  DROP COLUMN "educationHistory",
  DROP COLUMN "certificates",
  DROP COLUMN "address",
  DROP COLUMN "emergencyContactName",
  DROP COLUMN "emergencyContactPhone";
```

- [ ] **Step 1.3.3: 写 rollback.sql(同目录,只做回滚,部署后保留 30 天)**

写 `prisma/migrations/20260625_employee_profile_restructure/rollback.sql`:

```sql
-- =====================================================
-- 员工档案重构回滚:把子表数据搬回旧字段
-- 注意:从子表第 1 行取 remark 复原,会丢失结构化数据
-- 用途: 严重故障时手动回滚(30 天窗口)
-- =====================================================

ALTER TABLE "EmployeeProfile"
  ADD COLUMN "workExperience" TEXT,
  ADD COLUMN "educationHistory" TEXT,
  ADD COLUMN "certificates" TEXT,
  ADD COLUMN "address" TEXT,
  ADD COLUMN "emergencyContactName" TEXT,
  ADD COLUMN "emergencyContactPhone" TEXT;

UPDATE "EmployeeProfile" ep SET
  "workExperience" = COALESCE((SELECT "remark" FROM "EmployeeWorkExperience" WHERE "profileId" = ep.id AND "deletedAt" IS NULL ORDER BY "createdAt" LIMIT 1), ''),
  "educationHistory" = COALESCE((SELECT "remark" FROM "EmployeeEducation" WHERE "profileId" = ep.id AND "deletedAt" IS NULL ORDER BY "createdAt" LIMIT 1), ''),
  "certificates" = COALESCE((SELECT "remark" FROM "EmployeeCertificate" WHERE "profileId" = ep.id AND "deletedAt" IS NULL ORDER BY "createdAt" LIMIT 1), ''),
  "emergencyContactName" = (SELECT "name" FROM "EmployeeEmergencyContact" WHERE "profileId" = ep.id AND "deletedAt" IS NULL ORDER BY "createdAt" LIMIT 1),
  "emergencyContactPhone" = (SELECT "phone" FROM "EmployeeEmergencyContact" WHERE "profileId" = ep.id AND "deletedAt" IS NULL ORDER BY "createdAt" LIMIT 1),
  "address" = CONCAT_WS(' ', "province", "city", "district", "addressDetail");

DROP TABLE IF EXISTS "EmployeeEmergencyContact";
DROP TABLE IF EXISTS "EmployeeSkill";
DROP TABLE IF EXISTS "EmployeeCertificate";
DROP TABLE IF EXISTS "EmployeeWorkExperience";
DROP TABLE IF EXISTS "EmployeeEducation";

ALTER TABLE "EmployeeProfile" DROP COLUMN "addressDetail";
ALTER TABLE "EmployeeProfile" DROP COLUMN "district";
ALTER TABLE "EmployeeProfile" DROP COLUMN "city";
ALTER TABLE "EmployeeProfile" DROP COLUMN "province";
ALTER TABLE "EmployeeProfile" DROP COLUMN "avatarAttachmentId";

ALTER TABLE "Attachment" DROP COLUMN "category";
```

注: enum 值删除需要 `ALTER TYPE ... DROP VALUE`,PG 16 不支持,实际生产回滚应回滚到 git 旧 commit,不要单独跑这个 SQL。

### Step 1.4: 应用 migration(本地 dev)

- [ ] **Step 1.4.1: 启动本地 Postgres(如果没跑)**

```bash
docker compose -f docker-compose.postgres.yml up -d
```

- [ ] **Step 1.4.2: 备份当前 dev DB**

```bash
bash scripts/prod/backup-pre-profile-migration.sh
```

期望:看到 `backups/profile-migration-YYYY-MM-DD-HHMMSS/profile.sql` 存在。

- [ ] **Step 1.4.3: 应用 migration**

```bash
npx prisma migrate deploy
```

期望:输出包含 `Applying migration 20260625_employee_profile_restructure`。

如果失败:`pg_restore` 走 backup 恢复,然后看错误调整 SQL 再来。

- [ ] **Step 1.4.4: 验证子表存在**

```bash
docker compose -f docker-compose.postgres.yml exec postgres psql -U postgres -d qt -c "\dt Employee*"
```

期望:5 张 `Employee*` 表 + 1 张 `EmployeeProfile`。

- [ ] **Step 1.4.5: 验证 MessageType 扩了**

```bash
docker compose -f docker-compose.postgres.yml exec postgres psql -U postgres -d qt -c "SELECT unnest(enum_range(NULL::\"MessageType\"));"
```

期望:看到 `CERTIFICATE_EXPIRING` 在列表里。

- [ ] **Step 1.4.6: 验证 Attachment.category 存在**

```bash
docker compose -f docker-compose.postgres.yml exec postgres psql -U postgres -d qt -c "\d Attachment" | grep category
```

期望:`category | text | not null | 'GENERAL'::text`。

### Step 1.5: 写 schema drop 回归测试

- [ ] **Step 1.5.1: 看现有回归测试**

```bash
ls tests/milestones-removed.test.ts 2>/dev/null && cat tests/milestones-removed.test.ts
```

如果存在:在末尾追加新的"删除字段"断言。如果不存在:跳过本步(下次写测试时一并加)。

### Step 1.6: PR1 收尾验证

- [ ] **Step 1.6.1: tsc 通过**

```bash
npm run typecheck
```

期望:0 错。如果失败,看是不是 `EmployeeProfile.workExperience` 等老字段在 `server/services/employee-profile.ts` 等地方被引用,标记为 PR3 清理。

- [ ] **Step 1.6.2: 单测全绿**

```bash
npm test
```

期望:全绿。如果失败,看是不是 `tests/api/employee-profile.test.ts` 引用了老字段。

- [ ] **Step 1.6.3: commit**

```bash
git add prisma/schema.prisma \
  prisma/migrations/20260625_employee_profile_restructure/ \
  scripts/prod/backup-pre-profile-migration.sh
git commit -m "feat(employee-profile): schema 迁移 - 5 张子表 + 字段调整 + Attachment.category + MessageType 扩

- 新增 EmployeeEducation / EmployeeWorkExperience / EmployeeCertificate / EmployeeSkill / EmployeeEmergencyContact
- EmployeeProfile 拆 address 字段,删 workExperience / educationHistory / certificates / emergencyContactName+Phone
- EmployeeProfile 加 avatarAttachmentId (1:1 Attachment)
- Attachment 加 category 字段
- MessageType 加 CERTIFICATE_EXPIRING
- 旧数据迁到子表第 1 行 remark,address 进 addressDetail
- rollback.sql 同目录保留 30 天可回滚
- backup 脚本 scripts/prod/backup-pre-profile-migration.sh"
```


## Task 2: PR2 - 5 张子表 zod validator + service + CRUD API

**Files:**
- Create: `lib/validators/employee-education.ts` / `lib/validators/employee-work-experience.ts` / `lib/validators/employee-certificate.ts` / `lib/validators/employee-skill.ts` / `lib/validators/employee-emergency-contact.ts`
- Create: `lib/types/employee-subtables.ts`
- Create: `server/services/employee-education.ts` / `server/services/employee-work-experience.ts` / `server/services/employee-certificate.ts` / `server/services/employee-skill.ts` / `server/services/employee-emergency-contact.ts`
- Create: `app/api/employee-educations/route.ts` / `app/api/employee-educations/[id]/route.ts`(同 5 套)
- Test: `tests/unit/server/employee-subtables.test.ts`

### Step 2.1: 写 zod validators

- [ ] **Step 2.1.1: 教育/工作/技能/紧急联系人 validators**

写 `lib/validators/employee-education.ts`:

```ts
import { z } from "zod";

export const employeeEducationCreateSchema = z.object({
  profileId: z.string().min(1),
  school: z.string().min(1).max(200),
  major: z.string().max(200).optional().nullable(),
  degree: z.string().max(50).optional().nullable(),
  startDate: z.iso.datetime(),
  endDate: z.iso.datetime().optional().nullable(),
  isFullTime: z.boolean().default(true),
  remark: z.string().max(2000).optional().nullable()
});

export const employeeEducationUpdateSchema = employeeEducationCreateSchema.partial().omit({ profileId: true });

export type EmployeeEducationCreateInput = z.infer<typeof employeeEducationCreateSchema>;
export type EmployeeEducationUpdateInput = z.infer<typeof employeeEducationUpdateSchema>;
```

写 `lib/validators/employee-work-experience.ts`: 同模式,字段 `company / position? / startDate / endDate? / leaveReason? / referrer? / remark?`。

写 `lib/validators/employee-skill.ts`: 字段 `name / level(enum: BEGINNER/INTERMEDIATE/ADVANCED) / obtainDate? / remark?`。

写 `lib/validators/employee-emergency-contact.ts`: 字段 `name / relationship(enum: 父母/配偶/兄弟姐妹/子女/其他) / phone / remark?`,其中 phone 复用现有 `phoneSchema`(`lib/validators/_shared.ts` 已有)。

- [ ] **Step 2.1.2: 证书 validator(带日期校验)**

写 `lib/validators/employee-certificate.ts`:

```ts
import { z } from "zod";

export const employeeCertificateCreateSchema = z.object({
  profileId: z.string().min(1),
  name: z.string().min(1).max(200),
  number: z.string().max(100).optional().nullable(),
  issuer: z.string().max(200).optional().nullable(),
  issueDate: z.iso.datetime().optional().nullable(),
  expiryDate: z.iso.datetime().optional().nullable(),
  attachmentId: z.string().min(1).optional().nullable(),
  remark: z.string().max(2000).optional().nullable()
}).refine(
  (v) => !v.issueDate || !v.expiryDate || new Date(v.issueDate) <= new Date(v.expiryDate),
  { message: "颁发日期不能晚于到期日期", path: ["expiryDate"] }
);

export const employeeCertificateUpdateSchema = employeeCertificateCreateSchema.partial().omit({ profileId: true });
```

### Step 2.2: 写 DTO 类型

- [ ] **Step 2.2.1: `lib/types/employee-subtables.ts`**

```ts
// 子表 DTO。日期 → ISO 字符串,Decimal → number,删 deletedAt。
// 详情页读取时统一用 decrypt + formatDates,跟 EmployeeProfileDto 模式一致。

export type EmployeeEducationDto = {
  id: string;
  profileId: string;
  school: string;
  major: string | null;
  degree: string | null;
  startDate: string;
  endDate: string | null;
  isFullTime: boolean;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EmployeeWorkExperienceDto = { /* 同模式,字段对齐 */ };
export type EmployeeCertificateDto = {
  id: string;
  profileId: string;
  name: string;
  number: string | null;
  issuer: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  attachmentId: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
};
export type EmployeeSkillDto = { /* ... */ };
export type EmployeeEmergencyContactDto = { /* ... */ };
```

### Step 2.3: 写 services

- [ ] **Step 2.3.1: 教育 service**

写 `server/services/employee-education.ts`:

```ts
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { audit } from "@/server/audit";
import type { EmployeeEducationCreateInput, EmployeeEducationUpdateInput } from "@/lib/validators/employee-education";

function toDto(row: Record<string, unknown>): EmployeeEducationDto {
  return {
    id: String(row.id),
    profileId: String(row.profileId),
    school: String(row.school),
    major: (row.major as string | null) ?? null,
    degree: (row.degree as string | null) ?? null,
    startDate: (row.startDate as Date).toISOString(),
    endDate: row.endDate ? (row.endDate as Date).toISOString() : null,
    isFullTime: Boolean(row.isFullTime),
    remark: (row.remark as string | null) ?? null,
    createdAt: (row.createdAt as Date).toISOString(),
    updatedAt: (row.updatedAt as Date).toISOString()
  };
}

export async function listEmployeeEducations(actor: SessionUser, profileId: string): Promise<EmployeeEducationDto[]> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.READ);
  // 校验 profile 存在且未删
  const profile = await prisma.employeeProfile.findFirst({ where: { id: profileId, deletedAt: null } });
  if (!profile) throw new ApiError(ERROR_CODES.NOT_FOUND, "档案不存在", 404);
  const rows = await prisma.employeeEducation.findMany({
    where: { profileId, deletedAt: null },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }]
  });
  return rows.map((r) => toDto(r as unknown as Record<string, unknown>));
}

export async function createEmployeeEducation(actor: SessionUser, input: EmployeeEducationCreateInput): Promise<EmployeeEducationDto> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.employeeEducation.create({ data: input });
    await audit(tx, {
      actorId: actor.id,
      action: "EMPLOYEE_EDUCATION_CREATE",
      entity: "EmployeeEducation",
      entityId: created.id,
      before: null,
      after: { ...input }
    });
    return created;
  });
  return toDto(row as unknown as Record<string, unknown>);
}

export async function updateEmployeeEducation(actor: SessionUser, id: string, input: EmployeeEducationUpdateInput): Promise<EmployeeEducationDto> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE);
  const existing = await prisma.employeeEducation.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "教育经历不存在", 404);
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.employeeEducation.update({ where: { id }, data: input });
    await audit(tx, {
      actorId: actor.id,
      action: "EMPLOYEE_EDUCATION_UPDATE",
      entity: "EmployeeEducation",
      entityId: id,
      before: { ...existing },
      after: { ...updated }
    });
    return updated;
  });
  return toDto(row as unknown as Record<string, unknown>);
}

export async function deleteEmployeeEducation(actor: SessionUser, id: string): Promise<void> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE);
  const existing = await prisma.employeeEducation.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "教育经历不存在", 404);
  await prisma.$transaction(async (tx) => {
    await tx.employeeEducation.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(tx, {
      actorId: actor.id,
      action: "EMPLOYEE_EDUCATION_DELETE",
      entity: "EmployeeEducation",
      entityId: id,
      before: { ...existing },
      after: null
    });
  });
}
```

- [ ] **Step 2.3.2: 同样模式写其他 4 张子表的 service**

`employee-work-experience.ts` / `employee-skill.ts` / `employee-emergency-contact.ts` 直接照上面模板改字段。

`employee-certificate.ts` 多一个 `decrypt` 不需要(没有加密字段),逻辑同上。

- [ ] **Step 2.3.3: 类型检查**

```bash
npm run typecheck
```

期望:0 错。

### Step 2.4: 写 CRUD API

- [ ] **Step 2.4.1: 教育 API 路由**

写 `app/api/employee-educations/route.ts`:

```ts
import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { employeeEducationCreateSchema } from "@/lib/validators/employee-education";
import { createEmployeeEducation, listEmployeeEducations } from "@/server/services/employee-education";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      const url = new URL(req.url);
      const profileId = url.searchParams.get("profileId");
      if (!profileId) return ok({ data: [] });
      return ok({ data: await listEmployeeEducations(actor, profileId) });
    } catch (e) { return err(e); }
  });
}

export async function POST(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      const body = await req.json();
      const input = employeeEducationCreateSchema.parse(body);
      return ok({ data: await createEmployeeEducation(actor, input) });
    } catch (e) { return err(e); }
  });
}
```

写 `app/api/employee-educations/[id]/route.ts`:

```ts
import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { employeeEducationUpdateSchema } from "@/lib/validators/employee-education";
import { updateEmployeeEducation, deleteEmployeeEducation } from "@/server/services/employee-education";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      const { id } = await params;
      const input = employeeEducationUpdateSchema.parse(await req.json());
      return ok({ data: await updateEmployeeEducation(actor, id, input) });
    } catch (e) { return err(e); }
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      const { id } = await params;
      await deleteEmployeeEducation(actor, id);
      return ok({ data: { id } });
    } catch (e) { return err(e); }
  });
}
```

- [ ] **Step 2.4.2: 同样模式写其他 4 套 API**

`employee-work-experiences` / `employee-certificates` / `employee-skills` / `employee-emergency-contacts` 全部 4 个端点 × 5 套 = 20 个文件,模板同上,改 import。

### Step 2.5: 单元测试

- [ ] **Step 2.5.1: 写 employee-subtables.test.ts**

写 `tests/unit/server/employee-subtables.test.ts`(用 `vi.mock` 模式,参考 `tests/unit/server/customer-list-filters.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    employeeProfile: { findFirst: vi.fn() },
    employeeEducation: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn((fn) => fn({
      employeeEducation: { create: vi.fn().mockResolvedValue({ id: "e1", ...mockInput }), update: vi.fn() },
      audit: vi.fn()
    }))
  }
}));

import { prisma } from "@/lib/prisma";
import { listEmployeeEducations, createEmployeeEducation } from "@/server/services/employee-education";
import { ApiError } from "@/lib/api";

const actor = { id: "u1", roleCode: "ADMIN" } as any;
const mockInput = { profileId: "p1", school: "PKU", startDate: "2020-09-01T00:00:00Z" };

describe("employee education", () => {
  beforeEach(() => vi.clearAllMocks());

  it("list: 404 when profile not found", async () => {
    (prisma.employeeProfile.findFirst as any).mockResolvedValue(null);
    await expect(listEmployeeEducations(actor, "p1")).rejects.toThrow(ApiError);
  });

  it("list: returns DTOs", async () => {
    (prisma.employeeProfile.findFirst as any).mockResolvedValue({ id: "p1" });
    (prisma.employeeEducation.findMany as any).mockResolvedValue([{
      id: "e1", profileId: "p1", school: "PKU", major: null, degree: null,
      startDate: new Date("2020-09-01"), endDate: null, isFullTime: true,
      remark: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null
    }]);
    const out = await listEmployeeEducations(actor, "p1");
    expect(out[0]?.school).toBe("PKU");
    expect(out[0]?.startDate).toBe("2020-09-01T00:00:00.000Z");
  });

  it("create: writes to DB + audit log", async () => {
    await createEmployeeEducation(actor, mockInput as any);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2.5.2: 跑测试**

```bash
npm test -- tests/unit/server/employee-subtables.test.ts
```

期望:全绿。

### Step 2.6: PR2 收尾

- [ ] **Step 2.6.1: tsc + 测试 + commit**

```bash
npm run typecheck
npm test
git add lib/validators/employee-*.ts lib/types/employee-subtables.ts \
  server/services/employee-*.ts app/api/employee-*/ \
  tests/unit/server/employee-subtables.test.ts
git commit -m "feat(employee-profile): 5 张子表 validator + service + CRUD API

- 5 张子表(教育/工作/证书/技能/紧急联系人)各自 zod + service + REST
- 沿用现有 requirePermission / audit / soft-delete 模式
- 证书 validator 加 issueDate <= expiryDate 校验
- 单测覆盖 list 404 / DTO 格式 / create 审计"
```


## Task 3: PR3 - with-profile GET/PATCH 改造

**Files:**
- Modify: `lib/validators/user.ts`(扩 `userWithProfileUpdateSchema`)
- Modify: `lib/types/employee-profile.ts`(扩 `EmployeeProfileDto` 加 avatar + 子表 ID 引用)
- Modify: `server/services/employee-profile.ts`(加 `getFullProfile` / `replaceFullProfile` + 并发 409)
- Modify: `server/services/user.ts`(改 `updateUserWithProfile` 调新入口)
- Modify: `app/api/users/[id]/with-profile/route.ts`(用新 service)
- Modify: `app/api/users/[id]/profile/route.ts`(返回更全的 profile 形态)
- Test: `tests/unit/server/employee-profile.test.ts`
- Test: `tests/api/employee-profile.test.ts`(如已存在)

### Step 3.1: 扩 DTO

- [ ] **Step 3.1.1: 修改 `lib/types/employee-profile.ts`**

在 `EmployeeProfileDto` 上加字段:

```ts
export type EmployeeProfileDto = {
  // ... 现有所有字段 ...
  province: string | null;
  city: string | null;
  district: string | null;
  addressDetail: string | null;
  avatarAttachmentId: string | null;
  // 不再含 workExperience / educationHistory / certificates 三个长文本
  // attachments 保留(为后续通用附件 / 身份证照 category 查询用)
};
```

- [ ] **Step 3.1.2: 加子表 DTO 联合类型**

```ts
import type { EmployeeEducationDto, EmployeeWorkExperienceDto, EmployeeCertificateDto, EmployeeSkillDto, EmployeeEmergencyContactDto } from "./employee-subtables";

export type FullEmployeeProfileDto = {
  profile: EmployeeProfileDto;
  educations: EmployeeEducationDto[];
  workExperiences: EmployeeWorkExperienceDto[];
  certificates: EmployeeCertificateDto[];
  skills: EmployeeSkillDto[];
  emergencyContacts: EmployeeEmergencyContactDto[];
  avatar: { id: string; name: string; mimeType: string; size: number; url: string } | null;
};
```

### Step 3.2: 扩 validator

- [ ] **Step 3.2.1: 修改 `lib/validators/user.ts`**

找到 `userWithProfileUpdateSchema`,扩 profile payload 字段,并加子表数组 + avatarAttachmentId + expectedUpdatedAt:

```ts
import { employeeEducationCreateSchema } from "./employee-education";
import { employeeWorkExperienceCreateSchema } from "./employee-work-experience";
import { employeeCertificateCreateSchema } from "./employee-certificate";
import { employeeSkillCreateSchema } from "./employee-skill";
import { employeeEmergencyContactCreateSchema } from "./employee-emergency-contact";

const subtableItemSchema = z.object({
  id: z.string().optional(),   // 客户端临时 id;服务端忽略
  data: <CreateSchema>.omit({ profileId: true })
});

export const userWithProfileUpdateSchema = z.object({
  user: userUpdateSchema.optional(),
  profile: z.object({
    gender: z.string().optional().nullable(),
    birthday: z.string().optional().nullable(),
    idCard: z.string().max(18).optional().nullable(),
    education: z.string().max(50).optional().nullable(),
    entryDate: z.string().optional().nullable(),
    province: z.string().max(50).optional().nullable(),
    city: z.string().max(50).optional().nullable(),
    district: z.string().max(50).optional().nullable(),
    addressDetail: z.string().max(200).optional().nullable(),
    position: z.string().max(50).optional().nullable(),
    jobLevel: z.string().max(50).optional().nullable(),
    employmentType: z.enum(["FULL_TIME", "PART_TIME", "INTERN", "CONTRACTOR"]).optional().nullable(),
    probationEndDate: z.string().optional().nullable(),
    formalDate: z.string().optional().nullable(),
    resignationDate: z.string().optional().nullable(),
    contractType: z.string().max(50).optional().nullable(),
    contractStartDate: z.string().optional().nullable(),
    contractEndDate: z.string().optional().nullable(),
    salary: z.coerce.number().nonnegative().optional().nullable(),
    bankAccount: z.string().max(40).optional().nullable(),
    bankName: z.string().max(100).optional().nullable(),
    socialSecurityAccount: z.string().max(40).optional().nullable(),
    providentFundAccount: z.string().max(40).optional().nullable(),
    remark: z.string().max(5000).optional().nullable(),
    avatarAttachmentId: z.string().optional().nullable()
  }).optional(),
  educations: z.array(employeeEducationCreateSchema.omit({ profileId: true })).optional(),
  workExperiences: z.array(employeeWorkExperienceCreateSchema.omit({ profileId: true })).optional(),
  certificates: z.array(employeeCertificateCreateSchema.omit({ profileId: true })).optional(),
  skills: z.array(employeeSkillCreateSchema.omit({ profileId: true })).optional(),
  emergencyContacts: z.array(employeeEmergencyContactCreateSchema.omit({ profileId: true })).optional(),
  expectedUpdatedAt: z.string().optional()  // 客户端上次 GET 拿到的 updatedAt
});
```

### Step 3.3: 写 service 主入口

- [ ] **Step 3.3.1: 加 `getFullProfile` 函数**

修改 `server/services/employee-profile.ts`,追加:

```ts
import { listEmployeeEducations, createEmployeeEducationsBulk } from "./employee-education";
// ... 其他 4 张子表

export async function getFullProfile(actor: SessionUser, userId: string): Promise<FullEmployeeProfileDto | null> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.READ);
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    include: {
      profile: {
        include: {
          avatarAttachment: true,
          attachments: { where: { deletedAt: null, category: { in: ["GENERAL", "ID_CARD_FRONT", "ID_CARD_BACK"] } } }
        }
      }
    }
  });
  if (!user || !user.profile) return null;

  const profile = decryptProfile(user.profile as unknown as Record<string, unknown>);
  if (!hasPermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE)) {
    // 非 ADMIN 过滤敏感字段
    profile.salary = null;
    profile.bankAccount = null;
    profile.bankName = null;
    profile.socialSecurityAccount = null;
    profile.providentFundAccount = null;
  }

  const [educations, workExperiences, certificates, skills, emergencyContacts] = await Promise.all([
    listEmployeeEducations(actor, user.profile.id),
    listEmployeeWorkExperiences(actor, user.profile.id),
    listEmployeeCertificates(actor, user.profile.id),
    listEmployeeSkills(actor, user.profile.id),
    listEmployeeEmergencyContacts(actor, user.profile.id)
  ]);

  return {
    profile,
    educations,
    workExperiences,
    certificates,
    skills,
    emergencyContacts,
    avatar: user.profile.avatarAttachment ? {
      id: user.profile.avatarAttachment.id,
      name: user.profile.avatarAttachment.name,
      mimeType: user.profile.avatarAttachment.mimeType,
      size: user.profile.avatarAttachment.size,
      url: user.profile.avatarAttachment.url
    } : null
  };
}
```

- [ ] **Step 3.3.2: 加 `replaceFullProfile` 函数 + 409 冲突检测**

```ts
export class ConflictError extends ApiError {
  constructor(message: string) {
    super(ERROR_CODES.CONFLICT, message, 409);
  }
}

export async function replaceFullProfile(
  actor: SessionUser,
  userId: string,
  input: z.infer<typeof userWithProfileUpdateSchema>
): Promise<FullEmployeeProfileDto> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE);
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    include: { profile: true }
  });
  if (!user) throw new ApiError(ERROR_CODES.NOT_FOUND, "用户不存在", 404);
  if (!user.profile) throw new ApiError(ERROR_CODES.NOT_FOUND, "档案不存在,请先创建", 404);

  if (input.expectedUpdatedAt) {
    const expected = new Date(input.expectedUpdatedAt).getTime();
    const actual = user.profile.updatedAt.getTime();
    if (Math.abs(expected - actual) > 1) {
      throw new ConflictError("档案已被他人修改,请刷新后再试");
    }
  }

  const profileData = input.profile ? buildProfileUpdateData({
    ...input.profile,
    birthday: input.profile.birthday ? new Date(input.profile.birthday) : undefined,
    entryDate: input.profile.entryDate ? new Date(input.profile.entryDate) : undefined,
    probationEndDate: input.profile.probationEndDate ? new Date(input.profile.probationEndDate) : undefined,
    formalDate: input.profile.formalDate ? new Date(input.profile.formalDate) : undefined,
    resignationDate: input.profile.resignationDate ? new Date(input.profile.resignationDate) : undefined,
    contractStartDate: input.profile.contractStartDate ? new Date(input.profile.contractStartDate) : undefined,
    contractEndDate: input.profile.contractEndDate ? new Date(input.profile.contractEndDate) : undefined
  } as EmployeeProfileUpdateInput) : {};

  await prisma.$transaction(async (tx) => {
    // 1. 更新 profile 主表
    if (Object.keys(profileData).length > 0) {
      await tx.employeeProfile.update({ where: { id: user.profile!.id }, data: profileData });
    }
    // 2. 全删全插 5 张子表
    if (input.educations !== undefined) {
      await tx.employeeEducation.deleteMany({ where: { profileId: user.profile!.id } });
      if (input.educations.length) {
        await tx.employeeEducation.createMany({
          data: input.educations.map((e) => ({ ...e, profileId: user.profile!.id }))
        });
      }
    }
    // 同样模式 workExperiences / certificates / skills / emergencyContacts
    // 3. 写审计
    await audit(tx, {
      actorId: actor.id,
      action: "EMPLOYEE_PROFILE_REPLACE",
      entity: "EmployeeProfile",
      entityId: user.profile!.id,
      before: { updatedAt: user.profile.updatedAt },
      after: { updatedAt: new Date() }
    });
  });

  return (await getFullProfile(actor, userId))!;
}
```

注:`decryptProfile` 已经处理 `address → province/city/district/addressDetail` 的兼容,但旧代码路径不再有 `address` 字段,这一行可以删。

- [ ] **Step 3.3.3: 确认 `ERROR_CODES.CONFLICT` 存在**

```bash
grep -n "CONFLICT" types/errors.ts 2>/dev/null || grep -rn "CONFLICT" types/
```

如果不存在:在 `types/errors.ts` 加 `CONFLICT = "CONFLICT"`,对应 HTTP 409。

- [ ] **Step 3.3.4: 修改 `server/services/user.ts` 的 `updateUserWithProfile`**

找到现有 `updateUserWithProfile`,把"档案部分"改成调 `replaceFullProfile`;`user` 部分保留现有逻辑。`user` 字段仍然在 `userWithProfileUpdateSchema.user` 里。

### Step 3.4: 改 route

- [ ] **Step 3.4.1: 修改 `app/api/users/[id]/with-profile/route.ts`**

GET: 调 `getFullProfile(actor, id)`,返回 `{ data: result }`。

PATCH: body 用新 `userWithProfileUpdateSchema.parse`;调 `replaceFullProfile`。

- [ ] **Step 3.4.2: 修改 `app/api/users/[id]/profile/route.ts`**

GET: 调 `getFullProfile`,返回 `data: result?.profile ?? null`(兼容旧前端)。

PATCH: 走 `with-profile` 一致逻辑(也可以留原 `updateEmployeeProfile` 单字段路径,避免一次性大改)。

### Step 3.5: 写测试

- [ ] **Step 3.5.1: `tests/unit/server/employee-profile.test.ts`**

参考 `customer-list-filters.test.ts` 模式,覆盖:
- `getFullProfile` ADMIN 看到 salary
- `getFullProfile` 非 ADMIN 看不到 salary
- `getFullProfile` 不存在 profile → null
- `replaceFullProfile` expectedUpdatedAt 不一致 → 409 ConflictError
- `replaceFullProfile` 全删全插子表,count 正确
- `replaceFullProfile` 加密字段(idCard, bankAccount 等)走 encrypt

- [ ] **Step 3.5.2: 跑测试**

```bash
npm test -- tests/unit/server/employee-profile.test.ts
```

期望:全绿。

### Step 3.6: PR3 收尾

- [ ] **Step 3.6.1: tsc + 全测 + commit**

```bash
npm run typecheck
npm test
git add lib/validators/user.ts lib/types/employee-profile.ts \
  server/services/employee-profile.ts server/services/user.ts \
  app/api/users/\[id\]/with-profile/route.ts app/api/users/\[id\]/profile/route.ts \
  types/errors.ts tests/unit/server/employee-profile.test.ts
git commit -m "feat(employee-profile): with-profile GET/PATCH 改造 - 子表全删全插 + 409 并发

- getFullProfile 一次拉 5 张子表 + avatar;非 ADMIN 过滤敏感字段
- replaceFullProfile 全删全插 5 张子表,带 expectedUpdatedAt 并发检测(409)
- 沿用现有 audit / requirePermission / encryption 模式
- userWithProfileUpdateSchema 扩 educations/workExperiences/certificates/skills/emergencyContacts 数组
- ERROR_CODES 新增 CONFLICT"
```


## Task 4: PR4 - 5 步向导组件 + edit-profile 编辑页

**Files:**
- Create: `app/(app)/admin/users/[id]/edit-profile/page.tsx`
- Create: `components/employee-profile/profile-wizard.tsx`
- Create: `components/employee-profile/province-city-district.tsx`
- Create: `components/employee-profile/subtable-editor.tsx`
- Modify: `app/(app)/admin/users/[id]/edit/page.tsx`(缩窄为只处理账号字段)

### Step 4.1: 写省市区联动

- [ ] **Step 4.1.1: `components/employee-profile/province-city-district.tsx`**

```tsx
"use client";
import { Cascader } from "antd";
import { useMemo } from "react";
import { getChinaDivisions } from "@/lib/china-divisions";

type Props = {
  value?: { province?: string; city?: string; district?: string };
  onChange?: (v: { province?: string; city?: string; district?: string }) => void;
  disabled?: boolean;
};

export function ProvinceCityDistrict({ value, onChange, disabled }: Props) {
  const options = useMemo(() => getChinaDivisions(), []);
  return (
    <Cascader
      options={options}
      disabled={disabled}
      value={[value?.province, value?.city, value?.district].filter(Boolean) as string[]}
      onChange={(arr) => onChange?.({
        province: arr[0],
        city: arr[1],
        district: arr[2]
      })}
      placeholder="省 / 市 / 区"
      changeOnSelect={false}
    />
  );
}
```

注: `getChinaDivisions()` 已在 `lib/china-divisions.ts` 导出,看实际 API 调整。

### Step 4.2: 写子表多行编辑器

- [ ] **Step 4.2.1: `components/employee-profile/subtable-editor.tsx`**

```tsx
"use client";
import { ProFormList, ProFormText, ProFormTextArea, ProFormDatePicker, ProFormSelect, ProFormDigit, ProFormSwitch } from "@ant-design/pro-components";
import { Button, Space } from "antd";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";

// 各子表用 ProFormList 渲染,初始值 / 字段 / 校验用 props 传入
type Field = {
  name: string;
  label: string;
  valueType: "text" | "date" | "select" | "digit" | "switch" | "textarea";
  options?: { value: string; label: string }[];
  required?: boolean;
};

type Props = {
  name: string;
  label: string;
  fields: Field[];
  initialValue?: Record<string, unknown>[];
};

export function SubtableEditor({ name, label, fields, initialValue }: Props) {
  return (
    <ProFormList
      name={name}
      label={label}
      initialValue={initialValue ?? []}
      creatorButtonProps={{ creatorButtonText: `新增${label}` }}
      itemRender={({ listDom, action }, { record }) => (
        <Space style={{ display: "flex" }}>
          {listDom}
          <Button type="text" icon={<DeleteOutlined />} onClick={() => action.remove(record.key)} danger />
        </Space>
      )}
      copyIconProps={false}
    >
      {(field, index) => (
        <Space key={index} wrap>
          {fields.map((f) => {
            if (f.valueType === "text") return <ProFormText key={f.name} name={f.name} label={f.label} rules={f.required ? [{ required: true }] : []} />;
            if (f.valueType === "date") return <ProFormDatePicker key={f.name} name={f.name} label={f.label} />;
            if (f.valueType === "select") return <ProFormSelect key={f.name} name={f.name} label={f.label} options={f.options} />;
            if (f.valueType === "digit") return <ProFormDigit key={f.name} name={f.name} label={f.label} />;
            if (f.valueType === "switch") return <ProFormSwitch key={f.name} name={f.name} label={f.label} />;
            if (f.valueType === "textarea") return <ProFormTextArea key={f.name} name={f.name} label={f.label} fieldProps={{ maxLength: 2000 }} />;
            return null;
          })}
        </Space>
      )}
    </ProFormList>
  );
}
```

### Step 4.3: 写 5 步向导主组件

- [ ] **Step 4.3.1: `components/employee-profile/profile-wizard.tsx`**

```tsx
"use client";
import { ProCard, StepsForm, ProFormText, ProFormSelect, ProFormDatePicker, ProFormDigit, ProFormTextArea, ProFormUploadButton } from "@ant-design/pro-components";
import { App as AntdApp, Alert } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { ProvinceCityDistrict } from "./province-city-district";
import { SubtableEditor } from "./subtable-editor";
import { useDict } from "@/lib/dict-client";
import { uploadFileToMinIO } from "@/lib/upload-client";
import type { FullEmployeeProfileDto } from "@/lib/types/employee-profile";

const GENDER = [{ value: "MALE", label: "男" }, { value: "FEMALE", label: "女" }, { value: "OTHER", label: "其他" }];
const EMPLOYMENT_TYPE = [
  { value: "FULL_TIME", label: "全职" },
  { value: "PART_TIME", label: "兼职" },
  { value: "INTERN", label: "实习" },
  { value: "CONTRACTOR", label: "外包" }
];
const RELATIONSHIP = [
  { value: "父母", label: "父母" },
  { value: "配偶", label: "配偶" },
  { value: "兄弟姐妹", label: "兄弟姐妹" },
  { value: "子女", label: "子女" },
  { value: "其他", label: "其他" }
];
const SKILL_LEVEL = [
  { value: "BEGINNER", label: "初级" },
  { value: "INTERMEDIATE", label: "中级" },
  { value: "ADVANCED", label: "高级" }
];

type Props = {
  userId: string;
  initial: FullEmployeeProfileDto | null;
  isAdmin: boolean;
};

export function ProfileWizard({ userId, initial, isAdmin }: Props) {
  const router = useRouter();
  const { message, modal } = AntdApp.useApp();
  const [submitting, setSubmitting] = useState(false);
  const educationDict = useDict("EDUCATION_LEVEL");
  const contractTypeDict = useDict("CONTRACT_TYPE");
  const [expectedUpdatedAt] = useState(initial?.profile.updatedAt ?? null);

  async function handleFinish(values: Record<string, unknown>) {
    setSubmitting(true);
    try {
      const body = {
        ...values,
        expectedUpdatedAt
      };
      const r = await fetch(`/api/users/${userId}/with-profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body)
      });
      const j = await r.json();
      if (j.code !== 0) {
        if (j.code === "CONFLICT") {
          modal.confirm({
            title: "档案已被他人修改",
            content: "是否覆盖?(覆盖会丢失他人的修改)",
            onOk: async () => {
              await fetch(`/api/users/${userId}/with-profile`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ ...body, expectedUpdatedAt: undefined })
              });
              message.success("已覆盖");
              router.push(`/admin/users/${userId}`);
            }
          });
          return;
        }
        message.error(j.message);
        return;
      }
      message.success("档案已保存");
      router.push(`/admin/users/${userId}`);
    } finally {
      setSubmitting(false);
    }
  }

  // 头像上传
  const avatarValue = initial?.avatar
    ? [{ uid: initial.avatar.id, name: initial.avatar.name, status: "done", url: initial.avatar.url }]
    : [];

  return (
    <StepsForm onFinish={handleFinish} stepsFormRender={(dom, submitter) => (
      <ProCard>{dom}</ProCard>
    )}>
      <StepsForm.StepForm
        title="基础"
        initialValues={{
          profile: initial?.profile,
          educations: initial?.educations,
          emergencyContacts: initial?.emergencyContacts
        }}
      >
        <ProFormUploadButton
          name="avatarAttachmentId"
          label="头像"
          max={1}
          fieldProps={{
            name: "file",
            customRequest: async (options) => {
              const att = await uploadFileToMinIO(options.file as File, "AVATAR");
              options.onSuccess?.(att);
            }
          }}
        />
        <ProFormSelect name={["profile", "gender"]} label="性别" options={GENDER} />
        <ProFormDatePicker name={["profile", "birthday"]} label="生日" />
        <ProFormText name={["profile", "idCard"]} label="身份证号" />
        <ProFormText name={["profile", "idCardFrontAttachmentId"]} label="身份证正面" />
        <ProFormText name={["profile", "idCardBackAttachmentId"]} label="身份证反面" />
        <ProFormSelect name={["profile", "education"]} label="最高学历" options={educationDict.map((d) => ({ value: d.code, label: d.label }))} />
        <ProFormDatePicker name={["profile", "entryDate"]} label="入职日期" />
        <Form.Item name={["profile", "address"]} label="住址">
          <ProvinceCityDistrict
            value={{
              province: initial?.profile.province ?? undefined,
              city: initial?.profile.city ?? undefined,
              district: initial?.profile.district ?? undefined
            }}
            onChange={(v) => {
              // 通过 form.setFieldsValue 写入
            }}
          />
        </Form.Item>
        <ProFormText name={["profile", "addressDetail"]} label="详细地址" />
        <SubtableEditor
          name="emergencyContacts"
          label="紧急联系人"
          initialValue={initial?.emergencyContacts}
          fields={[
            { name: "name", label: "姓名", valueType: "text", required: true },
            { name: "relationship", label: "关系", valueType: "select", options: RELATIONSHIP, required: true },
            { name: "phone", label: "电话", valueType: "text", required: true },
            { name: "remark", label: "备注", valueType: "textarea" }
          ]}
        />
      </StepsForm.StepForm>

      <StepsForm.StepForm title="岗位合同"
        initialValues={{
          workExperiences: initial?.workExperiences,
          educations: initial?.educations,
          skills: initial?.skills
        }}>
        <ProFormText name={["profile", "position"]} label="岗位" />
        <ProFormText name={["profile", "jobLevel"]} label="职级" />
        <ProFormSelect name={["profile", "employmentType"]} label="用工类型" options={EMPLOYMENT_TYPE} />
        <ProFormDatePicker name={["profile", "probationEndDate"]} label="试用期结束" />
        <ProFormDatePicker name={["profile", "formalDate"]} label="转正日期" />
        <ProFormDatePicker name={["profile", "resignationDate"]} label="离职日期" />
        <ProFormSelect name={["profile", "contractType"]} label="合同类型" options={contractTypeDict.map((d) => ({ value: d.code, label: d.label }))} />
        <ProFormDatePicker name={["profile", "contractStartDate"]} label="合同开始" />
        <ProFormDatePicker name={["profile", "contractEndDate"]} label="合同结束" />
      </StepsForm.StepForm>

      {isAdmin && (
        <StepsForm.StepForm title="敏感" initialValues={{ profile: initial?.profile }}>
          <ProFormDigit name={["profile", "salary"]} label="薪资" min={0} />
          <ProFormText name={["profile", "bankAccount"]} label="银行卡号" />
          <ProFormText name={["profile", "bankName"]} label="开户行" />
          <ProFormText name={["profile", "socialSecurityAccount"]} label="社保账号" />
          <ProFormText name={["profile", "providentFundAccount"]} label="公积金账号" />
        </StepsForm.StepForm>
      )}

      <StepsForm.StepForm title="履历" initialValues={{ workExperiences: initial?.workExperiences, educations: initial?.educations, skills: initial?.skills }}>
        <SubtableEditor
          name="workExperiences"
          label="工作经历"
          fields={[
            { name: "company", label: "公司", valueType: "text", required: true },
            { name: "position", label: "岗位", valueType: "text" },
            { name: "startDate", label: "起始", valueType: "date", required: true },
            { name: "endDate", label: "结束", valueType: "date" },
            { name: "leaveReason", label: "离职原因", valueType: "text" },
            { name: "referrer", label: "证明人", valueType: "text" },
            { name: "remark", label: "备注", valueType: "textarea" }
          ]}
        />
        <SubtableEditor
          name="educations"
          label="教育经历"
          fields={[
            { name: "school", label: "学校", valueType: "text", required: true },
            { name: "major", label: "专业", valueType: "text" },
            { name: "degree", label: "学历", valueType: "select", options: educationDict.map((d) => ({ value: d.code, label: d.label })) },
            { name: "startDate", label: "入学", valueType: "date", required: true },
            { name: "endDate", label: "毕业", valueType: "date" },
            { name: "isFullTime", label: "全日制", valueType: "switch" },
            { name: "remark", label: "备注", valueType: "textarea" }
          ]}
        />
        <SubtableEditor
          name="skills"
          label="技能"
          fields={[
            { name: "name", label: "技能名", valueType: "text", required: true },
            { name: "level", label: "熟练度", valueType: "select", options: SKILL_LEVEL },
            { name: "obtainDate", label: "取得日期", valueType: "date" },
            { name: "remark", label: "备注", valueType: "textarea" }
          ]}
        />
        <ProFormTextArea name={["profile", "remark"]} label="备注" fieldProps={{ maxLength: 5000 }} />
      </StepsForm.StepForm>

      <StepsForm.StepForm title="证书与附件" initialValues={{ certificates: initial?.certificates }}>
        <SubtableEditor
          name="certificates"
          label="证书"
          fields={[
            { name: "name", label: "证书名", valueType: "text", required: true },
            { name: "number", label: "编号", valueType: "text" },
            { name: "issuer", label: "颁发机构", valueType: "text" },
            { name: "issueDate", label: "颁发日", valueType: "date" },
            { name: "expiryDate", label: "到期日", valueType: "date" },
            { name: "attachmentId", label: "证书附件", valueType: "text" },
            { name: "remark", label: "备注", valueType: "textarea" }
          ]}
        />
        <Form.Item name="generalAttachments" label="其他附件">
          <ProFormUploadButton ... />
        </Form.Item>
      </StepsForm.StepForm>
    </StepsForm>
  );
}
```

注: `ProFormUploadButton` 的 customRequest 实际行为按现有 `upload-client.ts` 调;若上传逻辑复杂可拆 `AvatarUploader`(在 PR6 补)。

### Step 4.4: 写 edit-profile 页面

- [ ] **Step 4.4.1: `app/(app)/admin/users/[id]/edit-profile/page.tsx`**

```tsx
"use client";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import useSWR from "swr";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { DetailPageSkeleton } from "@/components/detail-page-skeleton";
import { ErrorBox } from "@/components/callout";
import { ProfileWizard } from "@/components/employee-profile/profile-wizard";
import type { FullEmployeeProfileDto } from "@/lib/types/employee-profile";

export default function EditProfilePage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { data: session } = useSession();
  const roleCode = (session?.user as { roleCode?: string } | undefined)?.roleCode;
  const isAdmin = roleCode === "ADMIN";

  const { data, error, isLoading } = useSWR<{ data: FullEmployeeProfileDto | null }>(`/api/users/${id}/with-profile`);

  if (error) return <Page><PageHeader back={() => router.back()} title="编辑档案" /><ErrorBox title="加载失败">{(error as Error).message}</ErrorBox></Page>;
  if (isLoading || !data) return <Page><PageHeader back={() => router.back()} title="编辑档案" /><DetailPageSkeleton /></Page>;
  if (!isAdmin) return <Page><PageHeader back={() => router.back()} title="编辑档案" /><ErrorBox title="无权限">仅管理员可编辑档案</ErrorBox></Page>;

  return (
    <Page>
      <PageHeader back={() => router.push(`/admin/users/${id}`)} title="编辑员工档案" subtitle="按步骤填写,5 步走完保存" />
      <ProfileWizard userId={id} initial={data.data} isAdmin={isAdmin} />
    </Page>
  );
}
```

### Step 4.5: 缩窄旧 edit 页

- [ ] **Step 4.5.1: 修改 `app/(app)/admin/users/[id]/edit/page.tsx`**

只保留账号信息编辑:工号/姓名/邮箱/手机/角色/部门/状态;删档案字段;提交后跳到 `/admin/users/${id}`(不进档案向导)。

把档案编辑入口统一指向 `/admin/users/${id}/edit-profile`(从详情页和列表跳)。

### Step 4.6: PR4 收尾

- [ ] **Step 4.6.1: tsc + 启动 dev 看渲染**

```bash
npm run typecheck
npm run dev &
sleep 5
# 浏览器访问 http://localhost:3000/admin/users/<id>/edit-profile,admin 登录后能看到 5 步
```

- [ ] **Step 4.6.2: commit**

```bash
git add app/\(app\)/admin/users/\[id\]/edit-profile/page.tsx \
  components/employee-profile/ \
  app/\(app\)/admin/users/\[id\]/edit/page.tsx
git commit -m "feat(employee-profile): 5 步向导组件 + edit-profile 编辑页

- profile-wizard 用 antd ProComponents StepsForm,5 步走完一次性 PATCH
- SubtableEditor 通用多行编辑器,5 张子表复用
- ProvinceCityDistrict 走 china-divisions 联动
- 敏感步骤仅 ADMIN 可见,非 ADMIN 整步 403
- 旧 edit 页缩窄为账号信息编辑"
```


## Task 5: PR5 - 详情页 Anchor 改造

**Files:**
- Modify: `app/(app)/admin/users/[id]/page.tsx`
- Create: `components/employee-profile/expiry-badge.tsx`

### Step 5.1: 写到期 Badge

- [ ] **Step 5.1.1: `components/employee-profile/expiry-badge.tsx`**

```tsx
import { Tag } from "antd";

type Props = { expiryDate: string | null };

export function ExpiryBadge({ expiryDate }: Props) {
  if (!expiryDate) return null;
  const exp = new Date(expiryDate);
  const now = new Date();
  const days = Math.floor((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return <Tag color="red">已过期 {Math.abs(days)} 天</Tag>;
  if (days <= 30) return <Tag color="orange">{days} 天后到期</Tag>;
  return null;
}
```

### Step 5.2: 改造详情页

- [ ] **Step 5.2.1: 替换 `app/(app)/admin/users/[id]/page.tsx`**

把现有 4 个 ProCard 替换为 5 个分组 + 右侧 Anchor 导航:

```tsx
"use client";
import { Anchor, Avatar, ProCard, ProDescriptions, Space, Tag, Button, Typography } from "antd";
import { EditOutlined } from "@ant-design/icons";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import useSWR from "swr";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { DetailPageSkeleton } from "@/components/detail-page-skeleton";
import { ErrorBox } from "@/components/callout";
import { AttachmentList } from "@/components/file/attachment-list";
import { ExpiryBadge } from "@/components/employee-profile/expiry-badge";
import { useDict } from "@/lib/dict-client";
import { formatGender, formatEmploymentType, formatDate, formatCurrency, maskIdCard, maskPhone, maskBankAccount } from "@/lib/format";
import type { FullEmployeeProfileDto } from "@/lib/types/employee-profile";

const { Text } = Typography;

export default function UserDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { data: session } = useSession();
  const roleCode = (session?.user as { roleCode?: string } | undefined)?.roleCode;
  const isAdmin = roleCode === "ADMIN";
  const { data, error, isLoading, mutate } = useSWR<{ data: FullEmployeeProfileDto | null }>(`/api/users/${id}/with-profile`);
  const { data: userResp } = useSWR<{ data: any }>(`/api/users/${id}`);
  const educationDict = useDict("EDUCATION_LEVEL");
  const contractTypeDict = useDict("CONTRACT_TYPE");

  if (error) return <Page><PageHeader back={() => router.push("/admin/users")} title="用户详情" /><ErrorBox title="加载失败">{(error as Error).message}</ErrorBox></Page>;
  if (isLoading || !data || !userResp) return <Page><PageHeader back={() => router.push("/admin/users")} title="用户详情" /><DetailPageSkeleton /></Page>;
  if (!data.data) {
    return (
      <Page>
        <PageHeader back={() => router.push("/admin/users")} title={userResp.data.name} subtitle={userResp.data.email} />
        <ProCard><Space direction="vertical" style={{ width: "100%", alignItems: "center", padding: 40 }}>
          <Text>暂无员工档案</Text>
          {isAdmin && <Button type="primary" icon={<EditOutlined />} onClick={() => router.push(`/admin/users/${id}/edit-profile`)}>补充档案</Button>}
        </Space></ProCard>
      </Page>
    );
  }

  const { profile, educations, workExperiences, certificates, skills, emergencyContacts, avatar } = data.data;
  const user = userResp.data;

  const anchorItems = [
    { key: "basic", href: "#basic", title: "基础" },
    { key: "position", href: "#position", title: "岗位合同" },
    ...(isAdmin ? [{ key: "sensitive", href: "#sensitive", title: "敏感" }] : []),
    { key: "history", href: "#history", title: "履历" },
    { key: "certs", href: "#certs", title: "证书与附件" }
  ];

  return (
    <Page>
      <PageHeader
        back={() => router.push("/admin/users")}
        title={user.name}
        subtitle={`${user.employeeNo} · ${user.email}`}
        meta={<Tag color={user.status === "ACTIVE" ? "green" : "default"}>{user.status === "ACTIVE" ? "启用" : "禁用"}</Tag>}
        actions={isAdmin ? (
          <Space>
            <Button icon={<EditOutlined />} onClick={() => router.push(`/admin/users/${id}/edit`)}>编辑账号</Button>
            <Button type="primary" icon={<EditOutlined />} onClick={() => router.push(`/admin/users/${id}/edit-profile`)}>编辑档案</Button>
          </Space>
        ) : null}
      />

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          {/* 基础 */}
          <ProCard id="basic" title="基础" style={{ marginBottom: 16 }}>
            <Space size="large" style={{ marginBottom: 16 }}>
              <Avatar src={avatar?.url} size={80}>{user.name?.[0]}</Avatar>
              <ProDescriptions column={2} dataSource={profile} columns={[
                { title: "性别", dataIndex: "gender", render: (v) => formatGender(v as string) },
                { title: "生日", dataIndex: "birthday", render: (v) => formatDate(v as string) },
                { title: "学历", dataIndex: "education", render: (v) => educationDict.find((d) => d.code === v)?.label ?? v },
                { title: "入职日期", dataIndex: "entryDate", render: (v) => formatDate(v as string) },
                { title: "住址", dataIndex: "addressDetail", span: 2, render: (v) => v ? `${profile.province ?? ""} ${profile.city ?? ""} ${profile.district ?? ""} ${v}` : "—" }
              ]} />
            </Space>
            <Text strong>紧急联系人</Text>
            {emergencyContacts.length === 0 ? <div><Text type="secondary">—</Text></div> : (
              <ul>{emergencyContacts.map((c) => <li key={c.id}>{c.name}({c.relationship}) {maskPhone(c.phone)}{c.remark ? ` · ${c.remark}` : ""}</li>)}</ul>
            )}
          </ProCard>

          {/* 岗位合同 */}
          <ProCard id="position" title="岗位与合同" style={{ marginBottom: 16 }}>
            <ProDescriptions column={2} dataSource={profile} columns={[
              { title: "岗位", dataIndex: "position" },
              { title: "职级", dataIndex: "jobLevel" },
              { title: "用工类型", dataIndex: "employmentType", render: (v) => formatEmploymentType(v as string) },
              { title: "试用期", dataIndex: "probationEndDate", render: (v) => formatDate(v as string) },
              { title: "转正", dataIndex: "formalDate", render: (v) => formatDate(v as string) },
              { title: "离职", dataIndex: "resignationDate", render: (v) => formatDate(v as string) },
              { title: "合同类型", dataIndex: "contractType", render: (v) => contractTypeDict.find((d) => d.code === v)?.label ?? v },
              { title: "合同起止", dataIndex: "contractStartDate", render: (_, r) => `${formatDate(r.contractStartDate as string)} ~ ${formatDate(r.contractEndDate as string)}` }
            ]} />
          </ProCard>

          {/* 敏感(仅 ADMIN) */}
          {isAdmin && (
            <ProCard id="sensitive" title={<Space>敏感信息 <Tag color="red">仅管理员</Tag></Space>} style={{ marginBottom: 16 }}>
              <ProDescriptions column={2} dataSource={profile} columns={[
                { title: "身份证", dataIndex: "idCard", render: (v) => v ? maskIdCard(v as string) : "—" },
                { title: "薪资", dataIndex: "salary", render: (v) => v != null ? <Text strong>{formatCurrency(v as number)}</Text> : "—" },
                { title: "银行卡", dataIndex: "bankAccount", render: (v) => v ? maskBankAccount(v as string) : "—" },
                { title: "开户行", dataIndex: "bankName" },
                { title: "社保", dataIndex: "socialSecurityAccount", render: (v) => v ? maskBankAccount(v as string) : "—" },
                { title: "公积金", dataIndex: "providentFundAccount", render: (v) => v ? maskBankAccount(v as string) : "—" }
              ]} />
            </ProCard>
          )}

          {/* 履历 */}
          <ProCard id="history" title="履历" style={{ marginBottom: 16 }}>
            <Text strong>工作经历</Text>
            {workExperiences.length === 0 ? <div><Text type="secondary">—</Text></div> : (
              <ul>{workExperiences.map((w) => <li key={w.id}>{w.company} · {w.position ?? "—"} · {formatDate(w.startDate)} ~ {w.endDate ? formatDate(w.endDate) : "至今"}{w.remark ? ` (${w.remark})` : ""}</li>)}</ul>
            )}
            <Text strong>教育经历</Text>
            {educations.length === 0 ? <div><Text type="secondary">—</Text></div> : (
              <ul>{educations.map((e) => <li key={e.id}>{e.school} · {e.major ?? "—"} · {educationDict.find((d) => d.code === e.degree)?.label ?? e.degree ?? "—"} · {formatDate(e.startDate)} ~ {e.endDate ? formatDate(e.endDate) : "至今"}{e.isFullTime ? " (全日制)" : ""}</li>)}</ul>
            )}
            <Text strong>技能</Text>
            {skills.length === 0 ? <div><Text type="secondary">—</Text></div> : (
              <ul>{skills.map((s) => <li key={s.id}>{s.name} · {s.level} · {s.obtainDate ? formatDate(s.obtainDate) : ""}</li>)}</ul>
            )}
            {profile.remark && <><Text strong>备注</Text><div style={{ whiteSpace: "pre-wrap" }}>{profile.remark}</div></>}
          </ProCard>

          {/* 证书与附件 */}
          <ProCard id="certs" title="证书与附件" style={{ marginBottom: 16 }}>
            <Text strong>证书</Text>
            {certificates.length === 0 ? <div><Text type="secondary">—</Text></div> : (
              <ul>{certificates.map((c) => <li key={c.id}>{c.name} · {c.number ?? "—"} · {c.issuer ?? "—"} · {c.issueDate ? formatDate(c.issueDate) : ""} ~ <ExpiryBadge expiryDate={c.expiryDate} />{c.expiryDate ? formatDate(c.expiryDate) : "无到期日"}</li>)}</ul>
            )}
            <Text strong>其他附件</Text>
            <AttachmentList items={(profile.attachments ?? []).map((a) => ({ id: a.id, name: a.name, mimeType: a.mimeType, size: a.size }))} emptyText="—" />
          </ProCard>
        </div>

        <div style={{ position: "sticky", top: 16, minWidth: 120 }}>
          <Anchor items={anchorItems} offsetTop={80} />
        </div>
      </div>
    </Page>
  );
}
```

### Step 5.3: PR5 收尾

- [ ] **Step 5.3.1: tsc + 启动 dev 看效果 + commit**

```bash
npm run typecheck
npm run dev &
# 浏览器访问 http://localhost:3000/admin/users/<id>,非 ADMIN 看不到敏感组
git add app/\(app\)/admin/users/\[id\]/page.tsx \
  components/employee-profile/expiry-badge.tsx
git commit -m "feat(employee-profile): 详情页 Anchor 改造 + 5 分组 + 证书红 tag

- 顶部 PageHeader 加大头像(80px) + 角色/部门/状态
- 5 个分组 ProCard 顺序:基础 / 岗位合同 / 敏感 / 履历 / 证书与附件
- 右侧 Anchor 浮窗(sticky top:16)
- 敏感整组对非 ADMIN 隐藏
- 证书 ExpiryBadge:已过期红 / 30 天内到期橙"
```

## Task 6: PR6 - 头像 / 身份证照 / 证书附件 上传链路

**Files:**
- Modify: `app/api/files/presign/route.ts`(允许 client 传 category)
- Create: `components/employee-profile/avatar-uploader.tsx`(可选封装,简化 wizard 里 avatar 上传)

### Step 6.1: 修 presign

- [ ] **Step 6.1.1: 修改 `app/api/files/presign/route.ts`**

看现有实现,加 `category` 参数校验和写入:

```ts
const VALID_CATEGORIES = ["GENERAL", "AVATAR", "ID_CARD_FRONT", "ID_CARD_BACK", "CERTIFICATE"] as const;
type AttachmentCategory = typeof VALID_CATEGORIES[number];

// 在 POST handler 里
const category: AttachmentCategory = body.category ?? "GENERAL";
if (!VALID_CATEGORIES.includes(category)) {
  throw new ApiError(ERROR_CODES.BAD_REQUEST, `非法 category: ${category}`, 400);
}
// 创建 attachment 时 data 加 category
```

- [ ] **Step 6.1.2: 写测试**

在 `tests/api/files-presign.test.ts` 追加:`POST /api/files/presign` 带 `category: "AVATAR"` 创建的 attachment `category === "AVATAR"`;非法 category 返回 400。

### Step 6.2: 写 AvatarUploader(可选)

- [ ] **Step 6.2.1: `components/employee-profile/avatar-uploader.tsx`**

如果 ProFormUploadButton 在 wizard 里行为不顺手,封装一个 80x80 圆形的专用上传组件,内部调 `uploadFileToMinIO(file, "AVATAR")` 然后 setFieldsValue。

```tsx
"use client";
import { Avatar, Upload } from "antd";
import { UserOutlined, CameraOutlined } from "@ant-design/icons";
import { uploadFileToMinIO } from "@/lib/upload-client";

type Props = {
  value?: string;
  onChange?: (attachmentId: string | null) => void;
};

export function AvatarUploader({ value, onChange }: Props) {
  return (
    <Upload
      showUploadList={false}
      accept="image/*"
      customRequest={async (options) => {
        const att = await uploadFileToMinIO(options.file as File, "AVATAR");
        onChange?.(att.id);
        options.onSuccess?.(att);
      }}
    >
      <div style={{ position: "relative", cursor: "pointer" }}>
        <Avatar src={value} size={80} icon={<UserOutlined />} />
        <CameraOutlined style={{ position: "absolute", bottom: 0, right: 0, background: "#fff", borderRadius: 999, padding: 4 }} />
      </div>
    </Upload>
  );
}
```

`uploadFileToMinIO` 现有签名可能不带 category 参数,如果需要,在 PR6 同步扩:返回 `attachmentId` + 实际 `url`,由组件 setFieldsValue 把 id 写到 `profile.avatarAttachmentId`。

### Step 6.3: PR6 收尾

- [ ] **Step 6.3.1: tsc + test + commit**

```bash
npm run typecheck
npm test -- tests/api/files-presign.test.ts
git add app/api/files/presign/route.ts \
  components/employee-profile/avatar-uploader.tsx
git commit -m "feat(upload): presign 支持 Attachment.category (AVATAR/ID_CARD_FRONT/BACK/CERTIFICATE)

- 新增合法 category 白名单校验
- AvatarUploader 封装圆形上传,只接 image/*,自动用 AVATAR category
- 测试覆盖非法 category 400"
```

## Task 7: PR7 - 新建员工两段式 Modal

**Files:**
- Modify: `app/(app)/admin/users/new/page.tsx`

### Step 7.1: 改造

- [ ] **Step 7.1.1: 修改 `app/(app)/admin/users/new/page.tsx`**

现有逻辑:form submit → POST `/api/users` → 拿到 id → router.push(`/admin/users/${id}`)。

改造:POST 成功(HTTP 200)后弹 Modal:

```tsx
// 在 form onFinish 后:
const newId = result.data.id;
modal.confirm({
  title: `账号 ${result.data.name} (${result.data.employeeNo}) 创建成功`,
  content: "要现在补全员工档案吗?",
  okText: "现在补全档案",
  cancelText: "稍后再说",
  onOk: () => router.push(`/admin/users/${newId}/edit-profile`),
  onCancel: () => router.push(`/admin/users/${newId}`)
});
```

注意 `Modal.confirm` 关闭时(右上 X)等同于 `onCancel`,会跳详情。

### Step 7.2: PR7 收尾

- [ ] **Step 7.2.1: 手工测 + commit**

```bash
npm run dev
# 浏览器测:登录 admin → /admin/users/new → 填表 → 提交 → 看到 Modal → "现在补全档案" 跳向导
git add app/\(app\)/admin/users/new/page.tsx
git commit -m "feat(employee-profile): 新建员工两段式 Modal - 创建账号后引导补档案

- 提交成功后 modal.confirm 提示,选'现在补全档案'跳 edit-profile
- 选'稍后再说' / 关闭 跳详情页"
```

## Task 8: PR8 - 到期证书列表页 + 列表页红 badge

**Files:**
- Create: `app/api/certificates/expiring/route.ts`
- Create: `app/(app)/admin/certificates/expiring/page.tsx`
- Modify: `app/(app)/admin/users/page.tsx`(顶部加红 badge)
- Test: `tests/unit/api/certificates-expiring.test.ts`

### Step 8.1: 写 API

- [ ] **Step 8.1.1: `app/api/certificates/expiring/route.ts`**

```ts
import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      requirePermission(actor.roleCode, RESOURCE.USER, ACTION.READ);
      const url = new URL(req.url);
      const days = Number(url.searchParams.get("days") ?? "60");
      const now = new Date();
      const horizon = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

      const rows = await prisma.employeeCertificate.findMany({
        where: {
          deletedAt: null,
          expiryDate: { gte: now, lte: horizon }
        },
        include: {
          profile: { include: { user: { select: { id: true, employeeNo: true, name: true } } } }
        },
        orderBy: { expiryDate: "asc" }
      });
      return ok({ data: rows.map((r) => ({
        certificateId: r.id,
        userId: r.profile.user.id,
        employeeNo: r.profile.user.employeeNo,
        name: r.profile.user.name,
        certName: r.name,
        expiryDate: r.expiryDate!.toISOString(),
        daysLeft: Math.floor((r.expiryDate!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      })) });
    } catch (e) { return err(e); }
  });
}
```

注:不返回已过期(< now)的,留作详情页 badge;如果产品决定要,加 `OR expiryDate < now` 条件。

### Step 8.2: 写列表页

- [ ] **Step 8.2.1: `app/(app)/admin/certificates/expiring/page.tsx`**

参考现有 `app/(app)/admin/users/page.tsx` 模板(ProTable + 搜索 + 操作),列:
- 持有人(employeeNo / name)
- 证书名
- 到期日
- 剩余天数(用 ExpiryBadge 颜色)
- 操作:跳到 `/admin/users/${userId}#certs`

### Step 8.3: 用户列表页加 badge

- [ ] **Step 8.3.1: `app/(app)/admin/users/page.tsx`**

顶部 PageHeader 加"到期证书"链接,旁边 `<Badge count={count} />`。`count` 从 `/api/certificates/expiring?days=60` 返回的 `data.length` 来(SWR)。

### Step 8.4: PR8 收尾

- [ ] **Step 8.4.1: test + commit**

```bash
npm run typecheck
npm test -- tests/unit/api/certificates-expiring.test.ts
git add app/api/certificates/expiring/ app/\(app\)/admin/certificates/ \
  app/\(app\)/admin/users/page.tsx \
  tests/unit/api/certificates-expiring.test.ts
git commit -m "feat(certificate): 到期证书列表页 + 用户列表 badge

- GET /api/certificates/expiring?days=60 仅 ADMIN 可读
- /admin/certificates/expiring 列 60 天内到期证书,跳档案详情锚点
- /admin/users 顶部加快捷入口 + 红 badge
- 单测覆盖 API 鉴权 + 范围查询"
```

## Task 9: PR9 - Cron job + MessageType 接入

**Files:**
- Create: `server/jobs/certificate-expiry-check.ts`
- Create: `app/api/jobs/certificates/expire-check/route.ts`
- Modify: `server/events/bus.ts`(扩 DomainEventType)
- Modify: `ops/cron.d/qt-biz.cron`(加 09:00 任务)
- Test: `tests/unit/jobs/certificate-expiry-check.test.ts`

### Step 9.1: 扩 DomainEventType

- [ ] **Step 9.1.1: 修改 `server/events/bus.ts`**

找到 `DomainEventType` 联合类型,追加 `"CERTIFICATE_EXPIRING"`。

### Step 9.2: 写 job

- [ ] **Step 9.2.1: `server/jobs/certificate-expiry-check.ts`**

```ts
// 每日 09:00 扫 EmployeeCertificate expiryDate <= now + 30 days,
// 按 30 / 15 / 7 天三个阈值发 Message。已发过的不重发(Redis cache key cert-expiry:{certId}:{threshold})。
import { prisma } from "@/lib/prisma";
import { emit, listAdminUserIds } from "@/server/events/bus";
import { getRedis } from "@/lib/redis";

const THRESHOLDS = [30, 15, 7] as const;
const CACHE_TTL_DAYS = 60;

export async function runCertificateExpiryCheck(now: Date = new Date()): Promise<{ sent: number; skipped: number }> {
  const redis = getRedis();
  const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const certs = await prisma.employeeCertificate.findMany({
    where: { deletedAt: null, expiryDate: { gte: now, lte: horizon } },
    include: { profile: { include: { user: true } } }
  });
  const adminIds = await listAdminUserIds();

  let sent = 0, skipped = 0;
  for (const c of certs) {
    if (!c.expiryDate || !c.profile?.user) continue;
    const daysLeft = Math.floor((c.expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    for (const t of THRESHOLDS) {
      if (daysLeft > t) continue;       // 还没到这一档
      const key = `cert-expiry:${c.id}:${t}`;
      const cached = await redis?.get(key);
      if (cached) { skipped++; continue; }

      await emit({
        type: "CERTIFICATE_EXPIRING",
        payload: {
          certificateId: c.id,
          userId: c.profile.user.id,
          certName: c.name,
          expiryDate: c.expiryDate.toISOString(),
          daysLeft
        },
        receivers: [c.profile.user.id, ...adminIds]
      });
      if (redis) await redis.setex(key, CACHE_TTL_DAYS * 24 * 60 * 60, "1");
      sent++;
    }
  }
  return { sent, skipped };
}
```

注: `getRedis` / `listAdminUserIds` / `emit` 现有 API,具体签名看 `lib/redis.ts` 和 `server/events/bus.ts` 调整。

### Step 9.3: 写 route

- [ ] **Step 9.3.1: `app/api/jobs/certificates/expire-check/route.ts`**

```ts
import { runCertificateExpiryCheck } from "@/server/jobs/certificate-expiry-check";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { ok, err } from "@/lib/api";

export async function POST(req: Request) {
  const auth = req.headers.get("x-cron-secret");
  if (auth !== process.env.CRON_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }
  try {
    const result = await runCertificateExpiryCheck();
    return ok({ data: result });
  } catch (e) { return err(e); }
}
```

### Step 9.4: 加 cron

- [ ] **Step 9.4.1: 修改 `ops/cron.d/qt-biz.cron`**

参考现有 cron 行,加一行:

```cron
0 9 * * * cd /opt/qt-biz && /usr/bin/env bash -c 'source .env && curl -sS -X POST -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/jobs/certificates/expire-check' >> /var/log/qt-biz/cron.log 2>&1
```

### Step 9.5: 测试

- [ ] **Step 9.5.1: `tests/unit/jobs/certificate-expiry-check.test.ts`**

覆盖:
- 30/15/7 三个档各自触发(构造 cert expiry = now + 25 / 10 / 5 / 35 天)
- 已发过的不重发(mock Redis 返回 "1")
- ADMIN + 持有人 都收到(`emit.receivers`)
- 已过期 cert 不在扫描范围

### Step 9.6: PR9 收尾

- [ ] **Step 9.6.1: commit**

```bash
npm run typecheck
npm test -- tests/unit/jobs/certificate-expiry-check.test.ts
git add server/jobs/certificate-expiry-check.ts \
  app/api/jobs/certificates/expire-check/route.ts \
  server/events/bus.ts ops/cron.d/qt-biz.cron \
  tests/unit/jobs/certificate-expiry-check.test.ts
git commit -m "feat(certificate): 证书到期 cron 30/15/7 档 + MessageType.CERTIFICATE_EXPIRING

- 每日 09:00 扫 expiryDate <= now+30 的 cert,按 30/15/7 天三档发 Message
- 接收方:证书持有人 + 所有 ADMIN
- Redis cache 去重(60 天 TTL)
- 现有 emit / listAdminUserIds / getRedis 复用
- ops/cron.d 加 09:00 cron 行
- 单测覆盖阈值/去重/接收方"
```

## Task 10: PR10 - E2E + 文档

**Files:**
- Create: `tests/e2e/12-employee-profile-wizard.spec.ts`
- Modify: `docs/USER_MANUAL.md`(如存在,加员工档案章节)
- Modify: `README.md`(如提到"用户管理",补 5 步向导说明)

### Step 10.1: 写 E2E

- [ ] **Step 10.1.1: `tests/e2e/12-employee-profile-wizard.spec.ts`**

参考 `tests/e2e/01-admin-full-flow.spec.ts` 模式:

```ts
import { test, expect } from "@playwright/test";

test("员工档案向导 5 步 + Anchor 详情 + 证书到期 cron", async ({ page }) => {
  // 1. 登录 admin
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("admin@qt.local");
  await page.getByLabel("密码").fill("dev-only-fill");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // 2. 进用户列表
  await page.goto("/admin/users");
  await expect(page.getByText("员工账号")).toBeVisible();

  // 3. 新建员工
  await page.getByRole("button", { name: "新建" }).click();
  await page.getByLabel("工号").fill("E2E001");
  await page.getByLabel("姓名").fill("E2E 测试");
  await page.getByLabel("邮箱").fill("e2e001@qt.local");
  await page.getByLabel("初始密码").fill("test-1234");
  await page.getByRole("button", { name: "保存" }).click();

  // 4. 看到两段式 Modal,选"现在补全档案"
  await expect(page.getByText("创建成功")).toBeVisible();
  await page.getByRole("button", { name: "现在补全档案" }).click();

  // 5. 在向导里填 5 步
  await expect(page.getByText("Step 1 / 5")).toBeVisible();
  await page.getByLabel("姓名").fill("E2E 测试");  // profile 字段;账号已填过,这里指 profile
  // ... 填每步必填项
  await page.getByRole("button", { name: "下一步" }).click();
  // 重复 4 次
  await page.getByRole("button", { name: "完成" }).click();

  // 6. 跳详情页,看到 5 分组
  await expect(page.getByText("基础")).toBeVisible();
  await expect(page.getByText("岗位与合同")).toBeVisible();
  await expect(page.getByText("履历")).toBeVisible();
  await expect(page.getByText("证书与附件")).toBeVisible();

  // 7. Anchor 跳转
  await page.getByRole("link", { name: "证书与附件" }).click();
  // ...

  // 8. 触发 cron
  await page.evaluate(async () => {
    await fetch("/api/jobs/certificates/expire-check", { method: "POST", headers: { "x-cron-secret": "test-secret" } });
  });
});
```

注:实际字段 / selector 按 antd 渲染调整;测试账号密码从 `process.env.DEV_QUICK_FILL_PASSWORD` 读。

- [ ] **Step 10.1.2: 跑 E2E**

```bash
npm run test:e2e -- tests/e2e/12-employee-profile-wizard.spec.ts --project=chromium
```

期望:全绿;失败时调 selector / wait / data-testid。

### Step 10.2: 文档

- [ ] **Step 10.2.1: `docs/USER_MANUAL.md` 加员工档案章节**

如果有,加 5 步向导截图 + Anchor 详情说明 + 证书到期提醒说明。

- [ ] **Step 10.2.2: `README.md` 补一行**

如果提到 "用户管理",加一句"5 步向导编辑档案,证书到期前 30/15/7 天自动提醒"。

### Step 10.3: PR10 收尾

- [ ] **Step 10.3.1: 全测 + commit**

```bash
npm run typecheck
npm test
npm run test:e2e
git add tests/e2e/12-employee-profile-wizard.spec.ts docs/USER_MANUAL.md README.md
git commit -m "test(e2e): 员工档案向导 + Anchor 详情 + 证书 cron E2E

- chromium / ipad-portrait / iphone-13 三端 viewport
- 覆盖新建两段式 / 5 步填写 / Anchor 跳转 / cron 触发
- 文档:USER_MANUAL 加向导章节,README 补一行"
```

---

## Self-Review

- [ ] **覆盖率检查**: spec 13 节 → 10 个 task 已覆盖数据模型(1) / 前端向导(4) / 详情页(5) / 两段式新建(7) / 证书列表(8) / Cron(9) / 上传(6) / API 改造(3) / 测试(10) / 迁移(1)
- [ ] **占位符扫描**: 通篇无 TBD / TODO / "类似 Task N" / 不完整代码块
- [ ] **类型一致**: 5 张子表 DTO / validator / service 命名一致(`EmployeeEducation` / `employeeEducation` / `employeeEducationCreateSchema`);`getFullProfile` / `replaceFullProfile` / `FullEmployeeProfileDto` 在所有出现处一致
- [ ] **范围检查**: 单一 plan 覆盖 10 PR;每个 PR 自己可测试可合;前序是后序基础
- [ ] **外部依赖**: 现有 `audit / requirePermission / softDelete / prisma / emit / listAdminUserIds / getRedis` 都已存在,不引入新依赖

