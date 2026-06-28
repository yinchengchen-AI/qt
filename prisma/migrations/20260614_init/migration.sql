-- =====================================================
-- 合并后的 init 迁移 (2026-06-14 squashed from 14 migrations)
--
-- 由以下迁移合并而来(逐个应用后,DB 终态与本文件等价):
--   20260609_init
--   20260609_rls              (RLS 启用 + 业务表行级策略)
--   20260610_departments      (User.department 字符串 -> Department FK,数据迁移已折进当前 schema)
--   20260610_drop_invoice_project_id
--   20260611_add_customer_town
--   20260611_attachments
--   20260611_invoice_attachments
--   20260611_remove_credit_add_contact
--   20260611_remove_customer_level
--   20260612_workflow_engine
--   20260612_workflow_unique_fix    (unique 索引已在当前 schema 体现)
--   20260613_drop_progress_log_percent
--   20260613_drop_project_milestones
--   20260614_align_workflow_role    (FK + EXPERT 占位,EXPERT 占位由 seed 写入最终权限)
--
-- 注:应用此 init 到全新 DB 后,需要运行 `pnpm seed` 写入 admin/角色/字典/工作流模板等业务数据
-- =====================================================

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" JSONB NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "employeeNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "departmentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMPTZ(6),
    "wechatWorkId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "unifiedSocialCreditCode" TEXT,
    "customerType" TEXT NOT NULL,
    "industry" TEXT,
    "scale" TEXT,
    "province" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT,
    "town" TEXT,
    "contactName" TEXT,
    "contactTitle" TEXT,
    "contactPhone" TEXT NOT NULL,
    "sourceChannel" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'LEAD',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactPerson" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "remark" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "ContactPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "followAt" TIMESTAMPTZ(6) NOT NULL,
    "method" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "nextFollowAt" TIMESTAMPTZ(6),
    "result" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "contractNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "signDate" TIMESTAMPTZ(6) NOT NULL,
    "startDate" TIMESTAMPTZ(6) NOT NULL,
    "endDate" TIMESTAMPTZ(6) NOT NULL,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "taxRate" DECIMAL(6,4) NOT NULL DEFAULT 0.06,
    "taxAmount" DECIMAL(18,2) NOT NULL,
    "amountExcludingTax" DECIMAL(18,2) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "installmentPlan" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "ownerUserId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "reviewAt" TIMESTAMPTZ(6),
    "reviewComment" TEXT,
    "attachments" JSONB NOT NULL,
    "completionInvoiceRatio" DECIMAL(4,2) NOT NULL DEFAULT 0.95,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractReviewLog" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "comment" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractReviewLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "projectNo" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serviceScope" TEXT NOT NULL,
    "managerUserId" TEXT NOT NULL,
    "startDate" TIMESTAMPTZ(6) NOT NULL,
    "endDate" TIMESTAMPTZ(6) NOT NULL,
    "budgetAmount" DECIMAL(18,2),
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectProgressLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "remark" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectProgressLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowTemplate" (
    "id" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "WorkflowTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowStage" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL,
    "description" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "WorkflowStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowTask" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL,
    "description" TEXT,
    "requiredRole" TEXT,
    "requiresDeliverable" BOOLEAN NOT NULL DEFAULT false,
    "requiresOnsite" BOOLEAN NOT NULL DEFAULT false,
    "requiresTwoStepReview" BOOLEAN NOT NULL DEFAULT false,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "recurrenceUnit" TEXT,
    "recurrenceInterval" INTEGER,
    "estimateDays" INTEGER,

    CONSTRAINT "WorkflowTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowTaskInstance" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "assigneeId" TEXT,
    "parentInstanceId" TEXT,
    "reviewStatus" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "completedById" TEXT,
    "remark" TEXT,
    "attachments" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "WorkflowTaskInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "invoiceCode" TEXT,
    "contractId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "invoiceType" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "taxRate" DECIMAL(6,4) NOT NULL,
    "taxAmount" DECIMAL(18,2) NOT NULL,
    "amountExcludingTax" DECIMAL(18,2) NOT NULL,
    "applyDate" TIMESTAMPTZ(6) NOT NULL,
    "expectedIssueDate" TIMESTAMPTZ(6),
    "actualIssueDate" TIMESTAMPTZ(6),
    "titleType" TEXT NOT NULL,
    "titleName" TEXT NOT NULL,
    "taxNo" TEXT,
    "bankName" TEXT,
    "bankAccount" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "remark" TEXT,
    "attachments" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "applicantUserId" TEXT NOT NULL,
    "financeUserId" TEXT,
    "reviewedAt" TIMESTAMPTZ(6),
    "reviewComment" TEXT,
    "linkedInvoiceId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceAuditLog" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "comment" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "paymentNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL,
    "method" TEXT NOT NULL,
    "bankRefNo" TEXT,
    "bankName" TEXT,
    "remark" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "recorderUserId" TEXT NOT NULL,
    "reconcileUserId" TEXT,
    "reconciledAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "projectId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "remark" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "receiverUserId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "link" JSONB,
    "readAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "publishUserId" TEXT NOT NULL,
    "publishAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveFrom" TIMESTAMPTZ(6),
    "effectiveTo" TIMESTAMPTZ(6),
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "targetRoles" TEXT[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "diff" JSONB,
    "ip" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dictionary" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Dictionary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "contractId" TEXT,
    "invoiceId" TEXT,
    "uploadedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE INDEX "Role_code_idx" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeNo_key" ON "User"("employeeNo");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_unifiedSocialCreditCode_key" ON "Customer"("unifiedSocialCreditCode");

-- CreateIndex
CREATE INDEX "Customer_ownerUserId_idx" ON "Customer"("ownerUserId");

-- CreateIndex
CREATE INDEX "Customer_status_idx" ON "Customer"("status");

-- CreateIndex
CREATE INDEX "Customer_customerType_idx" ON "Customer"("customerType");

-- CreateIndex
CREATE INDEX "ContactPerson_customerId_idx" ON "ContactPerson"("customerId");

-- CreateIndex
CREATE INDEX "FollowUp_customerId_idx" ON "FollowUp"("customerId");

-- CreateIndex
CREATE INDEX "FollowUp_userId_idx" ON "FollowUp"("userId");

-- CreateIndex
CREATE INDEX "FollowUp_followAt_idx" ON "FollowUp"("followAt");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_contractNo_key" ON "Contract"("contractNo");

-- CreateIndex
CREATE INDEX "Contract_customerId_idx" ON "Contract"("customerId");

-- CreateIndex
CREATE INDEX "Contract_status_idx" ON "Contract"("status");

-- CreateIndex
CREATE INDEX "Contract_ownerUserId_idx" ON "Contract"("ownerUserId");

-- CreateIndex
CREATE INDEX "Contract_signDate_idx" ON "Contract"("signDate");

-- CreateIndex
CREATE INDEX "ContractReviewLog_contractId_idx" ON "ContractReviewLog"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_projectNo_key" ON "Project"("projectNo");

-- CreateIndex
CREATE INDEX "Project_contractId_idx" ON "Project"("contractId");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE INDEX "Project_managerUserId_idx" ON "Project"("managerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_contractId_name_key" ON "Project"("contractId", "name");

-- CreateIndex
CREATE INDEX "WorkflowTemplate_serviceType_idx" ON "WorkflowTemplate"("serviceType");

-- CreateIndex
CREATE INDEX "WorkflowTemplate_isActive_idx" ON "WorkflowTemplate"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowTemplate_serviceType_isActive_key" ON "WorkflowTemplate"("serviceType", "isActive");

-- CreateIndex
CREATE INDEX "WorkflowStage_templateId_phase_idx" ON "WorkflowStage"("templateId", "phase");

-- CreateIndex
CREATE INDEX "WorkflowTask_stageId_sort_idx" ON "WorkflowTask"("stageId", "sort");

-- CreateIndex
CREATE INDEX "WorkflowTask_requiredRole_idx" ON "WorkflowTask"("requiredRole");

-- CreateIndex
CREATE INDEX "WorkflowTaskInstance_projectId_status_idx" ON "WorkflowTaskInstance"("projectId", "status");

-- CreateIndex
CREATE INDEX "WorkflowTaskInstance_assigneeId_status_idx" ON "WorkflowTaskInstance"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "WorkflowTaskInstance_parentInstanceId_idx" ON "WorkflowTaskInstance"("parentInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowTaskInstance_projectId_taskId_parentInstanceId_key" ON "WorkflowTaskInstance"("projectId", "taskId", "parentInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNo_key" ON "Invoice"("invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_linkedInvoiceId_key" ON "Invoice"("linkedInvoiceId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_actualIssueDate_idx" ON "Invoice"("actualIssueDate");

-- CreateIndex
CREATE INDEX "Invoice_contractId_idx" ON "Invoice"("contractId");

-- CreateIndex
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");

-- CreateIndex
CREATE INDEX "InvoiceAuditLog_invoiceId_idx" ON "InvoiceAuditLog"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentNo_key" ON "Payment"("paymentNo");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_contractId_idx" ON "Payment"("contractId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Payment_receivedAt_idx" ON "Payment"("receivedAt");

-- CreateIndex
CREATE INDEX "Payment_customerId_idx" ON "Payment"("customerId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_invoiceId_idx" ON "PaymentAllocation"("invoiceId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_projectId_idx" ON "PaymentAllocation"("projectId");

-- CreateIndex
CREATE INDEX "Message_receiverUserId_readAt_idx" ON "Message"("receiverUserId", "readAt");

-- CreateIndex
CREATE INDEX "Message_type_idx" ON "Message"("type");

-- CreateIndex
CREATE INDEX "Announcement_publishAt_idx" ON "Announcement"("publishAt");

-- CreateIndex
CREATE INDEX "OperationLog_actorId_idx" ON "OperationLog"("actorId");

-- CreateIndex
CREATE INDEX "OperationLog_entity_entityId_idx" ON "OperationLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "OperationLog_at_idx" ON "OperationLog"("at");

-- CreateIndex
CREATE INDEX "Dictionary_category_isActive_sort_idx" ON "Dictionary"("category", "isActive", "sort");

-- CreateIndex
CREATE UNIQUE INDEX "Dictionary_category_code_key" ON "Dictionary"("category", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- CreateIndex
CREATE INDEX "Department_parentId_isActive_sort_idx" ON "Department"("parentId", "isActive", "sort");

-- CreateIndex
CREATE UNIQUE INDEX "Sequence_prefix_year_key" ON "Sequence"("prefix", "year");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_objectKey_key" ON "Attachment"("objectKey");

-- CreateIndex
CREATE INDEX "Attachment_contractId_deletedAt_idx" ON "Attachment"("contractId", "deletedAt");

-- CreateIndex
CREATE INDEX "Attachment_invoiceId_deletedAt_idx" ON "Attachment"("invoiceId", "deletedAt");

-- CreateIndex
CREATE INDEX "Attachment_uploadedById_idx" ON "Attachment"("uploadedById");

-- CreateIndex
CREATE INDEX "Attachment_deletedAt_idx" ON "Attachment"("deletedAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactPerson" ADD CONSTRAINT "ContactPerson_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractReviewLog" ADD CONSTRAINT "ContractReviewLog_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectProgressLog" ADD CONSTRAINT "ProjectProgressLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStage" ADD CONSTRAINT "WorkflowStage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkflowTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "WorkflowStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_requiredRole_fkey" FOREIGN KEY ("requiredRole") REFERENCES "Role"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTaskInstance" ADD CONSTRAINT "WorkflowTaskInstance_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTaskInstance" ADD CONSTRAINT "WorkflowTaskInstance_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkflowTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_linkedInvoiceId_fkey" FOREIGN KEY ("linkedInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceAuditLog" ADD CONSTRAINT "InvoiceAuditLog_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- =====================================================
-- Row-Level Security (RLS) — 业务表行级隔离
-- 配合应用层事务内 SET LOCAL app.user_id / app.user_role
-- =====================================================

-- 启用 RLS
ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contract" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;

-- Customer: SALES 只能看 ownerUserId = current_setting('app.user_id') 的客户
CREATE POLICY customer_sales_isolation ON "Customer"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR
    (
      current_setting('app.user_role', true) = 'SALES'
      AND "ownerUserId" = current_setting('app.user_id', true)
    )
    OR
    (
      current_setting('app.user_role', true) IN ('ADMIN', 'FINANCE', 'OPS')
    )
  );

-- Contract: SALES 通过 ownerUserId 过滤
CREATE POLICY contract_sales_isolation ON "Contract"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR
    (
      current_setting('app.user_role', true) = 'SALES'
      AND "ownerUserId" = current_setting('app.user_id', true)
    )
    OR
    (
      current_setting('app.user_role', true) IN ('ADMIN', 'FINANCE', 'OPS')
    )
  );

-- Project: RLS 仅做"非 SALES 也能看到"的兜底,SALES 行级过滤由应用层
-- (Project 表无 ownerUserId,跨表 JOIN 不适合放进 PG RLS 的 USING)
CREATE POLICY project_sales_isolation ON "Project"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR
    current_setting('app.user_role', true) IN ('ADMIN', 'FINANCE', 'OPS', 'SALES')
  );

-- Invoice: SALES 通过 contract.ownerUserId 过滤(开票仅关联合同,不再绑项目)
CREATE POLICY invoice_sales_isolation ON "Invoice"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR
    current_setting('app.user_role', true) IN ('ADMIN', 'FINANCE', 'OPS')
    OR
    (
      current_setting('app.user_role', true) = 'SALES'
      AND EXISTS (
        SELECT 1 FROM "Contract" c
        WHERE c.id = "Invoice"."contractId"
          AND c."ownerUserId" = current_setting('app.user_id', true)
      )
    )
  );

-- Payment: 通过 contract.ownerUserId
CREATE POLICY payment_sales_isolation ON "Payment"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR
    current_setting('app.user_role', true) IN ('ADMIN', 'FINANCE', 'OPS')
    OR
    (
      current_setting('app.user_role', true) = 'SALES'
      AND EXISTS (
        SELECT 1 FROM "Contract" c
        WHERE c.id = "Payment"."contractId"
          AND c."ownerUserId" = current_setting('app.user_id', true)
      )
    )
  );

-- 注释:app.bypass_rls 用于 cron jobs / 内部调用时绕过 RLS
-- 应用层 Service 应在事务开始时设置:
--   SET LOCAL app.user_id = 'xxx';
--   SET LOCAL app.user_role = 'SALES';
