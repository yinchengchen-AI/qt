# Prisma Migrations — 编年史

> 本目录下的 `2026MMDD_*` 文件是已经应用到生产 DB 的迁移，**不可重命名、不可改 SQL、不可删**（详见 [AGENTS.md](../../AGENTS.md) 与 [docs/ops/db-bootstrap.md](../../docs/ops/db-bootstrap.md) 第 3 节）。改动只能通过新增迁移完成。
>
> 本 README 只做人类可读的索引，不替代 SQL；遇到疑问以 `migration.sql` 为准。

## 索引

| #  | 迁移 | 主题 | 影响表 | 摘要 |
|----|------|------|--------|------|
| 1  | `20260614_init` | 基线 | Role / User / Customer / Contract / Invoice / Payment / Message / Announcement / OperationLog / Dictionary / Department / Sequence / Attachment / WorkflowTemplate+Stage+Task+TaskInstance / Project / ProjectProgressLog / InvoiceAuditLog / ContactPerson / FollowUp / PaymentAllocation | 14 个早期迁移 squash 后的 init。建 23 张业务表 + 全部 FK + RLS（Customer/Contract/Project/Invoice/Payment 五表启用） |
| 2  | `20260615_company_assets` | 资产 | CompanyAsset(后下线) / Attachment | 建企业资产库 v1：CompanyAsset + Attachment.assetId + RLS。**已被 20260628 移除** |
| 3  | `20260615_dictionary_parent_code` | 字典 | Dictionary | Dictionary.parentCode 字段 + 唯一索引，支持树形字典（REGION 三级、SERVICE_TYPE 平铺） |
| 4  | `20260615_drop_project_milestones` | 项目清理 | Project | Project.milestones 字段移除（v0.3.1 物理清理） |
| 5  | `20260616_contract_signer` | 合同 | Contract | Contract.signerId + FK + 索引；回填 createdById 后置 NOT NULL |
| 6  | `20260621_admin_role_seed` | RBAC | Role | 预置 ADMIN 角色，确保 `20260621_user_is_system` 的 DO 块能找到 Role |
| 7  | `20260621_contract_no_partial_unique` | 合同 | Contract | partial unique index `Contract_contractNo_active_key`（按 deletedAt 过滤），修 P2002 并发撞号 |
| 8  | `20260621_customer_district` | 客户 | Customer | Customer.district nullable 字段；老数据由 `scripts/migrate/customer-district-backfill.ts` 异步回填 |
| 9  | `20260621_user_is_system` | 用户 | User | User.isSystem 标记 + 复合索引；引入 system actor 写入 OperationLog/ContractReviewLog |
| 10 | `20260622_contract_remark` | 合同 | Contract | Contract.remark（自由文本备注，与 reviewComment 审批意见区分） |
| 11 | `20260622_drop_project_budget_and_payment_allocation` | 项目/回款 | Project / PaymentAllocation | 移除 Project.budgetAmount；DROP PaymentAllocation 表 |
| 12 | `20260622_operation_log_audit_fields` | 审计 | OperationLog | 补 UA / requestId / method / path / status 字段 + 索引 |
| 13 | `20260622_project_progress_log_soft_delete` | 项目清理 | ProjectProgressLog | ProjectProgressLog.deletedAt 软删除字段 + 复合索引 |
| 14 | `20260623_add_contract_deliverables` | 合同 | Contract | Contract.deliverables JSONB（业务留痕用）。**结构在 20260625 被替换为 Attachment.isDeliverable** |
| 15 | `20260623_drop_project_and_workflow` | 项目/工作流 | Project / WorkflowTemplate+Stage+Task+TaskInstance | 5 张表硬下线 CASCADE |
| 16 | `20260624_add_employee_profile` | 员工档案 | EmployeeProfile | 建 EmployeeProfile（与 User 一对一） |
| 17 | `20260624_attachment_deliverable_id` | 合同附件 | Attachment | Attachment.deliverableId（指向 Contract.deliverables 内的某条）。**在 20260625 被下线** |
| 18 | `20260624_attachment_is_primary` | 资产附件 | Attachment | Attachment.isPrimary（主附件标记）。**随 CompanyAsset 在 20260628 一同移除** |
| 19 | `20260625_attachment_is_deliverable` | 合同附件 | Attachment / Contract | Attachment.isDeliverable（合同交付物附件标记）；下线 deliverableId + Contract.deliverables JSON，结构迁到 Attachment |
| 20 | `20260626_contract_status_simplify` | 合同 | Contract | Contract.status 7 态 → 3 态（ACTIVE / CLOSED / PAUSED）；老数据写入 `_Contract_status_simplify_bak` |
| 21 | `20260626_invoice_attachments_json` | 发票 | Invoice | Invoice.attachments JSONB 镜像字段（与 Contract 行为对齐） |
| 22 | `20260627_add_message_announcement_user_fks` | 通知 | Message / Announcement | 补 FK（receiverUserId / publishUserId） |
| 23 | `20260627_limit_message_announcement_text` | 通知 | Message / Announcement | 限制 title VARCHAR(200) / content VARCHAR(10000) 对齐前端 Zod |
| 24 | `20260627_message_type_enum_bootstrap` | 通知 | MessageType（enum） | 预创建 12 个值的 MessageType enum（superset），解开后续迁移的时序死锁 |
| 25 | `20260628_customer_auto_fields` | 客户 | Customer / MessageType | Customer.autoAppliedAt / lastAutoAppliedAt + 2 个 enum 值（CUSTOMER_STATUS_AUTO_APPLIED / AUTO_REVERTED） |
| 26 | `20260628_drop_company_assets` | 资产 | CompanyAsset / Attachment | DROP CompanyAsset CASCADE + 移除 Attachment.assetId / isPrimary + 取消 RLS |
| 27 | `20260629_attachment_employee_profile_id` | 员工附件 | Attachment | Attachment.employeeProfileId 反向 FK + 复合索引 |
| 28 | `20260629_drop_customer_status` | 客户 | Customer | DROP Customer.status / lastAutoAppliedAt / lastAutoRule（v0.5.0 BREAKING） |
| 29 | `20260630_message_type_enum_index` | 通知 | Message / MessageType | Message.type text → enum + 复合索引（type/receiverUserId/createdAt）。**fresh DB 上 CREATE TYPE 撞已有 enum 必失败**（详见文件内 CI 处理说明） |
| 30 | `20260701_employee_profile_restructure` | 员工档案 | EmployeeProfile + 5 子表 / Attachment | 拆 5 张子表（Education/WorkExperience/Certificate/Skill/EmergencyContact） + 地区/地址/avatar 字段 + Attachment.category + 加 MessageType.CERTIFICATE_EXPIRING |
| 31 | `20260702_message_type_add_overdue_events` | 通知 | MessageType | 加 2 个 enum 值（CONTRACT_AUTO_OVERDUE_TERMINATED / CONTRACT_EXPIRED_UNPAID） |
| 32 | `20260703_aging_redesign` | 发票/账龄 | Invoice / DunningNote | Invoice.dueDate + 索引；新建 DunningNote 表（催收状态/承诺日期/渠道/备注） |
| 33 | `20260704_grant_dunning_note_qt_app` | 权限 | DunningNote | 补 GRANT：qt_app 缺 DunningNote 表权限（v0.7.0 真实事故 `42501 permission denied for table DunningNote`） |
| 34 | `20260705_app_release` | 发布 | AppRelease / AppReleaseRead | 建两张表 + DO 块保护下 GRANT qt_app |
| 35 | `20260705_contract_is_legacy_zero_amount` | 合同 | Contract | Contract.isLegacyZeroAmount 标记 FineUI 时代 0.01 占位合同；业务查询默认过滤；GRANT qt_app |
| 36 | `20260706_app_release_git_source` | 发布 | AppRelease | AppRelease.source（git 源类型：MANUAL / GIT_AUTO） + 索引 |
| 37 | `20260707_report_center` | 报表 | ReportDefinition / ReportSnapshot | 建报表中心两张表 + DO 块保护下 GRANT qt_app。**两表在 20260710 被下线** |
| 38 | `20260708_report_center_status_default` | 报表 | ReportSnapshot | ReportSnapshot.status 默认值调整为 READY（同步生成后无需 PENDING） |
| 39 | `20260710_drop_report_center` | 报表 | ReportDefinition / ReportSnapshot | 报表中心下线：DROP 两表 |
| 40 | `20260711_login_security_hardening` | 认证 | User / PasswordResetToken | User 加 lockedUntil + 失败计数 + 索引；新建 PasswordResetToken 表 + GRANT qt_app |

## 主题快速跳转

- **基线**：1
- **客户模块**：3 / 8 / 25 / 28
- **合同模块**：5 / 7 / 10 / 14 / 19 / 20 / 35
- **发票 / 回款 / 账龄**：21 / 32 / 33
- **通知 / 消息 / 公告**：22 / 23 / 24 / 29 / 31
- **员工档案**：16 / 27 / 30
- **用户 / 认证**：6 / 9 / 40
- **附件**：2 / 17 / 18 / 19 / 26 / 27
- **发布管理**：34 / 36
- **报表中心（已下线）**：37 / 38 / 39
- **项目 / 工作流（已下线）**：4 / 11 / 13 / 15
- **审计**：12

## 已知坑位（迁移内已注释，提醒未来读者）

- **`20260630_message_type_enum_index`**（#29）：fresh DB 上 `CREATE TYPE "MessageType"` 必撞 `20260627_message_type_enum_bootstrap`（#24）预建的 enum。文件内注释给出 CI 处理路径：`prisma migrate resolve --applied 20260630_message_type_enum_index`，需手动补 `ALTER TABLE "Message" ALTER COLUMN "type" TYPE "MessageType" USING "type"::"MessageType"`。
- **`20260704_grant_dunning_note_qt_app`**（#33）与 **`20260711_login_security_hardening`**（#40）：直接 `GRANT ... TO qt_app;`，**无 DO 块保护**。dev 环境（无 qt_app 角色）跑迁移会因 `42704 role "qt_app" does not exist` 挂掉。dev 临时解决：`CREATE ROLE qt_app BYPASSRLS NOLOGIN;`；后续迁移请沿用 #34 / #37 的 DO 块模式。
- **`20260626_contract_status_simplify`**（#20）：老 Contract.status 物理值写入 `_Contract_status_simplify_bak`（30 行表，生产环境保留作审计，可定期 DROP）。

## 新增迁移的约定（重述 AGENTS.md）

1. **新表必须在迁移末尾 `GRANT ALL ON TABLE "<X>" TO qt_app;`**（用 #34 / #37 的 `DO $$ ... IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qt_app') THEN ... END $$;` 模板，保护 dev 环境）。
2. **删字段/删表通过新增迁移做**（`ALTER TABLE ... DROP COLUMN` / `DROP TABLE ... CASCADE`），不要回滚历史迁移。
3. **同一发布周期的若干 ALTER 应该在 PR 合并前 squash 成一条语义命名的迁移**（如 `v0_11_0_consolidated`），**不要回头合并已发布的历史迁移**。
4. **新环境拉代码后跑 `npm run prisma:deploy`**（不要用 `prisma migrate dev`，会建 shadow DB 与历史迁移不兼容）。