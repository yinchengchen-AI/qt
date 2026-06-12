
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
CREATE INDEX "WorkflowTaskInstance_projectId_status_idx" ON "WorkflowTaskInstance"("projectId", "status");

-- CreateIndex
CREATE INDEX "WorkflowTaskInstance_assigneeId_status_idx" ON "WorkflowTaskInstance"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "WorkflowTaskInstance_parentInstanceId_idx" ON "WorkflowTaskInstance"("parentInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowTaskInstance_projectId_taskId_key" ON "WorkflowTaskInstance"("projectId", "taskId");

-- AddForeignKey
ALTER TABLE "WorkflowStage" ADD CONSTRAINT "WorkflowStage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkflowTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "WorkflowStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTaskInstance" ADD CONSTRAINT "WorkflowTaskInstance_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTaskInstance" ADD CONSTRAINT "WorkflowTaskInstance_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkflowTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

