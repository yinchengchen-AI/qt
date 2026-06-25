# 员工档案功能彻底重做设计

| 项 | 值 |
|---|---|
| 日期 | 2026-06-25 |
| 状态 | 待 review |
| 范围 | `EmployeeProfile` 重构 + 5 张子表 + 编辑向导 + 详情 Anchor 视图 + 证书到期提醒 |
| 目标版本 | qt-biz v0.4.x |
| 落地策略 | **一次性切换**(不分灰度,理由见 §8) |

## 1. 背景与目标

### 1.1 现状速记

`EmployeeProfile` 已经存在并跑通,但有以下痛点:

- **信息架构散**: 详情页 5 个 `ProCard` 顺序堆叠,无锚点导航,长页找不到分组
- **编辑体验差**: `.../edit/page.tsx` 把 30+ 字段一次性铺在 `ProForm` 上,很难填,改一个字段要滚到表单最底部保存
- **字段粒度粗**: `workExperience / educationHistory / certificates / address` 都是 5000 字符长文本或单行字符串,无法做结构化查询、聚合、提醒
- **无证书管理**: 证书没有"到期日"概念,renewal 完全靠人脑记
- **新建到档案补全断档**: 创建账号后无引导,容易忘补档案

### 1.2 目标

1. 档案编辑走**5 步向导**,每步 ≤ 2 个多行编辑器,体感轻
2. 长文本字段**结构化**为 5 张子表(教育/工作/证书/技能/紧急联系人)
3. 详情页改**Anchor 滚动**,单页看全貌 + 浮窗锚点定位
4. 证书**30/15/7 天三档提醒** + 详情页红 tag
5. 新建员工**两段式**引导,创建账号后强引导补档案

### 1.3 非目标(明确不做)

- 档案改动**不走审批流**(无上级签批)
- **不分灰度**、不做 feature flag(理由见 §8)
- 不引入第三方 HR 系统/钉钉/企业微信**导入**(完全手动维护)
- 不重构 `User` 模型本身(只动 `EmployeeProfile` + 子表 + `Attachment.category`)
- 不做档案**版本快照/历史回放**(只走审计日志)

## 2. 数据模型

### 2.1 `EmployeeProfile` 字段调整

**保留**:
- `id / userId / createdAt / updatedAt / deletedAt`(沿用软删)
- `gender / birthday / idCard / education / entryDate`
- `position / jobLevel / employmentType / probationEndDate / formalDate / resignationDate`
- `contractType / contractStartDate / contractEndDate`
- `salary / bankAccount / bankName / socialSecurityAccount / providentFundAccount`(敏感)
- `remark`(长文本,保留)

**调整**:
- `address String?` → 拆为 `province / city / district / addressDetail`,省市区走 `lib/china-divisions.ts` 三级联动
- **删除** `workExperience / educationHistory / certificates`(迁到子表)
- **删除** `emergencyContactName / emergencyContactPhone`(迁到子表)
- **新增** `avatarAttachmentId String? @unique` → 引用 `Attachment`(一对一)
- 身份证正反面 / 证书附件 用 `Attachment.category` 区分,**不上** Profile 单字段引用

### 2.2 `Attachment` 调整

新增 `category String @default("GENERAL")`,枚举值:
- `GENERAL` — 通用档案附件
- `ID_CARD_FRONT` / `ID_CARD_BACK` — 身份证正反面
- `CERTIFICATE` — 证书扫描件

### 2.3 5 张新子表

全部 `onDelete: Cascade` 到 `EmployeeProfile`,`@@index([profileId])`,支持软删(`deletedAt`)。

| Model | 字段 |
|---|---|
| `EmployeeEducation` | `profileId` / `school` / `major?` / `degree String`(dict) / `startDate` / `endDate?` / `isFullTime Boolean` / `remark?` |
| `EmployeeWorkExperience` | `profileId` / `company` / `position?` / `startDate` / `endDate?` / `leaveReason?` / `referrer?` / `remark?` |
| `EmployeeCertificate` | `profileId` / `name` / `number?` / `issuer?` / `issueDate?` / `expiryDate?` / `attachmentId String?` → `Attachment` / `remark?` ; `@@index([expiryDate])` 给 cron 用 |
| `EmployeeSkill` | `profileId` / `name` / `level String`(BEGINNER/INTERMEDIATE/ADVANCED) / `obtainDate?` / `remark?` |
| `EmployeeEmergencyContact` | `profileId` / `name` / `relationship String`(dict: 父母/配偶/兄弟姐妹/子女/其他) / `phone` / `remark?` |

### 2.4 已有默认值决策

- **EmployeeSkill ≠ EmployeeCertificate**——前者是软技能/能力(可无证书),后者是带编号/有效期的正式证书
- **头像**用 `EmployeeProfile.avatarAttachmentId` 单字段引用(热路径,读头像最频繁)
- **身份证正反 / 证书附件**用 `category` 区分的通用附件,不上 Profile 单字段引用
- **`education` 字段(最高学历)和 `EmployeeEducation[]` 并存**: `education` 是详情页基础信息展示用(HR 录入时手动指定),`EmployeeEducation[]` 是完整教育履历,二者可不一致

### 2.5 `MessageType` 扩展

新增 `CERTIFICATE_EXPIRING` 枚举值,同步更新 `server/events/bus.ts` 的 `DomainEventType` 联合类型。

## 3. 前端

### 3.1 5 步向导(编辑档案)

新文件 `app/(app)/admin/users/[id]/edit-profile/page.tsx` 替代现有 `.../edit/page.tsx`。

**架构**:
- 通用组件 `components/employee-profile/profile-wizard.tsx`,内部维护当前步骤 state
- 顶部 `<Steps>` 5 步 indicator(账号字段仍由旧 `.../edit/page.tsx` 处理,新向导不重复)
- 每步一个 ProCard,中间是字段
- 底部"上一步 / 下一步 / 保存草稿"按钮;最后一步"完成"触发一次性 PATCH
- 步骤切换不调接口;**只有"完成"才一次性 PATCH `/api/users/[id]/with-profile`**
- 离开未保存时弹确认 Modal

**步骤字段**:
1. **基础**: 头像(`ProFormUpload Button`)/ 性别 / 生日 / 身份证号 / 身份证正面照(attachments category=ID_CARD_FRONT)/ 反面照 / 最高学历(dict) / 省市区联动 / 详细地址 / 紧急联系人(`ProFormList` 多行)
2. **岗位合同**: 岗位 / 职级 / 用工类型(dict) / 入职日期 / 试用期结束 / 转正日期 / 离职日期 / 合同类型(dict) / 合同开始 / 合同结束
3. **敏感**(ADMIN 专属页,非 ADMIN 整步 403): 薪资 / 银行卡 / 开户行 / 社保账号 / 公积金账号
4. **履历**: 工作经历(`ProFormList`)/ 教育经历(`ProFormList`)/ 技能(`ProFormList`)/ 备注(长文本)
5. **证书与附件**: 证书(`ProFormList`,含到期日 + 单附件 category=CERTIFICATE)/ 其他附件(`ProFormUpload Dragger` category=GENERAL)

**旧 `.../edit/page.tsx`**: 重命名为账号信息编辑(只处理账号字段),不重复档案向导。`.../edit-profile/page.tsx` 新页只处理档案。

### 3.2 详情页(只读)

`app/(app)/admin/users/[id]/page.tsx` 改造:

- 顶部 `PageHeader`: 头像(80px 圆形) + 姓名 + 工号 + 角色 + 部门 + 状态 Tag + 右上"编辑档案 / 编辑账号 / 重置密码 / 启用禁用"
- 5 个分组按 ProCard 顺序排(基础 → 岗位合同 → 敏感 → 履历 → 证书与附件)
- 右侧 `<Anchor>` 浮窗导航,滚动到对应分组
- 敏感分组整块对非 ADMIN 隐藏
- 证书列表"已过期"红色 Tag,"30 天内到期"橙色 Tag
- 子表用 ProDescriptions + 列表渲染
- 附件走现有 `components/file/attachment-list.tsx`

### 3.3 新建员工流程

`app/(app)/admin/users/new/page.tsx` 维持账号创建表单(工号/姓名/邮箱/手机/角色/部门/初始密码)**不动**。

保存成功(HTTP 200)后弹 Modal:
> "账号 **张三 (QT099)** 创建成功。要现在补全员工档案吗?"
> [现在补全档案] [稍后再说] [关闭]

- "现在补全档案" → `router.push(/admin/users/${id}/edit-profile)`
- "稍后再说" / "关闭" → `router.push(/admin/users/${id})`

### 3.4 列表页

`app/(app)/admin/users/page.tsx` 列表本身**不改**,顶部加快捷入口"到期证书(N)"红点 badge。

新页 `app/(app)/admin/certificates/expiring/page.tsx`: 列出 60 天内到期 / 已过期证书(含持有人、证书名、到期日、剩余天数),可一键跳到对应档案的证书子表。ADMIN 专属。

### 3.5 组件新增

- `components/employee-profile/profile-wizard.tsx`(5 步向导)
- `components/employee-profile/avatar-uploader.tsx`
- `components/employee-profile/province-city-district.tsx`
- `components/employee-profile/subtable-editor.tsx`(通用多行编辑器,给 5 张子表复用)
- `components/employee-profile/certificate-row.tsx`(含到期日 + 附件 + 红 tag)

## 4. API

### 4.1 主接口

```
GET /api/users/[id]/with-profile
  → { user, profile, avatar, educations, workExperiences, certificates, skills, emergencyContacts, attachments }

PATCH /api/users/[id]/with-profile
  body: { user?: {...}, profile?: {...}, avatarAttachmentId?: string|null,
          educations: [...], workExperiences: [...], certificates: [...],
          skills: [...], emergencyContacts: [...] }
  → 整批替换:子表"全删全插",走 Prisma 事务
  → 并发防护: body 带 expectedUpdatedAt,不一致返回 409
```

**为什么全删全插**: 5 步向导完成时一次性提交,行数少(人均 < 10 行),写入开销可接受;省去行级 diff 的复杂度。

### 4.2 附件

- 上传走现有 `POST /api/files/presign` + MinIO
- 前端在向导完成时把 attachment.id 写进 `avatarAttachmentId` / 子表 attachmentId / 通用 attachments 关联
- `Attachment.category` 在上传时由前端按场景传

### 4.3 新增接口

```
GET /api/certificates/expiring?days=60
  → [{ certificateId, userId, employeeNo, name, certName, expiryDate, daysLeft }]
  权限: ADMIN
```

## 5. Cron + 提醒

### 5.1 新增 `server/jobs/certificate-expiry-check.ts`

- 每日 09:00(沿用 `ops/cron.d/*.cron` 模式)
- 扫 `EmployeeCertificate` 满足 `expiryDate <= now + 30 days AND expiryDate >= now - 365 days`
- 对每条记录按 30 / 15 / 7 天三个阈值各发一次 `Message`(`MessageType = CERTIFICATE_EXPIRING`)
- 接收方:`User` 本人 + 所有 ADMIN
- 去重:Redis cache key `cert-expiry:{certId}:{threshold}`,30 天内已发过该档的不重发
- 触发:`POST /api/jobs/certificates/expire-check`(CRON_SECRET 鉴权,沿用现有 job 路由模式)

### 5.2 详情页红 Tag

证书列表里:
- `expiryDate < now` → 红色 Tag "已过期 N 天"
- `now <= expiryDate <= now + 30 days` → 橙色 Tag "N 天后到期"
- 其余 → 普通展示

## 6. 权限

| 操作 | 权限 |
|---|---|
| 读档案(非敏感字段) | 任何登录用户 |
| 读敏感字段(薪资/银行/社保/公积金) | ADMIN |
| 写档案 | ADMIN |
| 自己改自己档案 | **不允许**(admin 才能改所有人,包括自己) |
| `GET /api/certificates/expiring` | ADMIN |
| Cron job | 内部鉴权 |
| 非 ADMIN 访问第 3 步敏感向导 | 整步 403 |

## 7. 数据迁移

### 7.1 前置

- 部署前先 `pg_dump` 全量导出(脚本 `scripts/prod/backup-pre-profile-migration.sh`,沿用现有 backup 模式)

### 7.2 迁移脚本

`prisma/migrations/2026XXXX_employee_profile_restructure/migration.sql`:

```sql
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

-- 2. 创建 5 张子表 + 索引
CREATE TABLE "EmployeeEducation" (...);
CREATE TABLE "EmployeeWorkExperience" (...);
CREATE TABLE "EmployeeCertificate" (...);
CREATE TABLE "EmployeeSkill" (...);
CREATE TABLE "EmployeeEmergencyContact" (...);

-- 3. 迁移数据(每个旧字段作为子表第 1 行的 remark)
INSERT INTO "EmployeeWorkExperience" ("id", "profileId", "company", "position", "remark", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", '(历史文本)', NULL, "workExperience", now(), now()
FROM "EmployeeProfile" WHERE "workExperience" IS NOT NULL AND "workExperience" != '';
-- 同理 education / certificate / emergency contact

-- 4. 拆 address → addressDetail(省市区无法解析,留 NULL)
ALTER TABLE "EmployeeProfile" ADD COLUMN "province" TEXT;
ALTER TABLE "EmployeeProfile" ADD COLUMN "city" TEXT;
ALTER TABLE "EmployeeProfile" ADD COLUMN "district" TEXT;
ALTER TABLE "EmployeeProfile" ADD COLUMN "addressDetail" TEXT;
UPDATE "EmployeeProfile" SET "addressDetail" = "address" WHERE "address" IS NOT NULL;

-- 5. 加头像字段
ALTER TABLE "EmployeeProfile" ADD COLUMN "avatarAttachmentId" TEXT UNIQUE;

-- 6. Attachment 加 category
ALTER TABLE "Attachment" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'GENERAL';

-- 7. MessageType 加枚举值
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

### 7.3 回滚

- 备份 SQL 保留 30 天
- Prisma 7 对复杂 SQL 的 `--rolled-back` 支持有限,提供手动 rollback 脚本:
  ```sql
  ALTER TABLE "EmployeeProfile"
    ADD COLUMN "workExperience" TEXT,
    ADD COLUMN "educationHistory" TEXT,
    ADD COLUMN "certificates" TEXT,
    ADD COLUMN "address" TEXT,
    ADD COLUMN "emergencyContactName" TEXT,
    ADD COLUMN "emergencyContactPhone" TEXT;
  UPDATE "EmployeeProfile" SET "workExperience" = "_legacy_work_experience", ...;
  ```

## 8. 灰度

**不分灰度,一次性切换**。理由:
- 业务上是 admin 内勤操作,无外部用户影响
- 数据迁移一次性执行,旧数据要保留就得用"全删全插",无法平滑切换
- 编辑体验大改,"半新半旧"反而混乱

回滚预案: 备份 SQL 保留 30 天;如新代码上线后发现严重问题,恢复 schema + 旧代码版本(通过 git revert)。

## 9. 错误处理

- **向导中途上传附件失败**: 不阻塞步骤切换;失败的 attachment 在前端"待上传"列表里标红,提交前必须清空或重传
- **PATCH with-profile 部分成功**: 整批在一个 Prisma 事务里;任一子表插入失败 → 整批回滚,前端按 `ApiError` 显示
- **并发编辑**: 后端 PATCH 时校验 `expectedUpdatedAt`,不一致返回 409 "档案已被他人修改,请刷新"。前端弹确认 Modal 让用户选择覆盖 / 取消
- **Cron 失败**: 单条证书失败不阻塞其他;job 末尾写日志,全失败的 job 通过现有健康检查告警
- **附件删除后被档案引用**: 删除时校验引用数,> 0 拒绝(沿用现有 `assertCanDeleteAttachment` 模式)

## 10. 风险

| 风险 | 概率 | 缓解 |
|---|---|---|
| 旧长文本迁移到 remark 后语义丢失 | 高(已知) | UI 上明确"历史备注"标记;提示"如有结构化需要请重新录入" |
| 身份证省市区无法从单行解析 | 高(已知) | 留 NULL,详情页标"—",让用户重填 |
| `MessageType` 加枚举值在已有事务中失败 | 中 | Prisma migrate 用 `ALTER TYPE ... ADD VALUE`,PG 14+ 支持;先 COMMIT 再加值 |
| 全删全插 5 张子表 事务体积大 | 低 | 单档案子表行数 < 50,单事务 < 200 条 SQL,可接受 |
| 新向导在移动端体验差 | 中 | ProFormList 移动端样式需手动调;E2E 覆盖 `iphone-13` viewport |
| 头像 + ID 照导致附件激增 | 低 | MinIO 已配置,backup 脚本覆盖附件桶;成本增加可接受 |

## 11. 测试

### 11.1 Vitest

- `tests/services/employee-profile.test.ts` — upsert / 加密 / 字段过滤 / 子表替换 / 409 并发
- `tests/validators/employee-profile.test.ts` — 身份证校验 / 长度限制
- `tests/jobs/certificate-expiry-check.test.ts` — 30/15/7 档触发 / 去重 / ADMIN 通知
- `tests/api/certificates-expiring.test.ts` — 列表 API / 权限

### 11.2 Playwright E2E

新增 `tests/e2e/12-employee-profile-wizard.spec.ts`:
- 登录 admin → 列表 → 新建员工 → 两段式补档案向导 → 详情页验证 5 个分组 → 编辑档案 → 改证书到期日 → 触发 cron → 收消息
- 覆盖 chromium / ipad-portrait / iphone-13

### 11.3 手工 QA

- 详情页 Anchor 锚点跳转
- 头像 / 身份证照 / 证书附件 真实上传
- 非 ADMIN 登录看不到敏感组
- 到期证书列表红 tag
- 移动端向导布局

## 12. 实现顺序(PR 拆分)

| PR | 范围 | 估时 |
|---|---|---|
| 1 | schema 迁移:5 张子表 + EmployeeProfile 字段调整 + Attachment.category + MessageType 扩展;迁移 SQL + 回滚 SQL | 1-2 天 |
| 2 | 5 张子表的 zod validator + service + API(单端点 + 全删全插) | 1-2 天 |
| 3 | `with-profile` GET/PATCH 改造:支持新 payload;敏感字段过滤;并发 409 | 1 天 |
| 4 | 5 步向导组件 + 编辑页改造 | 2-3 天 |
| 5 | 详情页改造:PageHeader + Anchor + 5 分组 + 证书红 tag | 1-2 天 |
| 6 | 头像 / 身份证照 / 证书附件 上传链路 | 1 天 |
| 7 | 新建员工两段式 Modal | 0.5 天 |
| 8 | `certificates/expiring` 列表页 + 列表页红 badge | 0.5 天 |
| 9 | Cron job + MessageType 接入 | 1 天 |
| 10 | 测试(Vitest + Playwright)+ 文档更新 + E2E 移动端 viewport | 1-2 天 |

合计 ~10-15 天,**不并行**(前序是后序基础)。

## 13. 不在本次范围 / 后续可做

- 档案**版本快照**: 每次修改存一份 JSONB 快照,可回放
- 档案改动**审批流**: HR 经理 / 财务双签
- **HR 系统 / 钉钉 / 企业微信导入**: 外部数据源
- 档案 **PDF 导出 / 打印**: HR 入职材料打包
- 头像**裁剪 / 缩略图**: 现 MinIO 已有缩略图能力,可后续接入
