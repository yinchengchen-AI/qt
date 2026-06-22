// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck -- 字典/工作流模板用 JS 字面量集中维护, 暂不细化类型
// 种子: 5 角色 + 5 部门 + 字典 + 9 类服务 × 5 阶段工作流模板 (系统管理数据)
// 业务数据 (客户/合同/项目/发票/回款/跟进) 不再 seed, 生产用真实数据
// 初始账号: 跑 pnpm create-admin 自行创建
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { ROLE_PERMISSIONS } from "../lib/permissions";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! })
});



// =====================================================
// 工作流模板 seed — 9 类服务 × 5 阶段通用骨架(P0)
// =====================================================
// 数据结构说明:
// - serviceType: 对应 SERVICE_TYPE 字典码
// - stages: 2 段(DO/DELIVER), DO = PREP+REQ+CONTRACT+EXECUTE, DELIVER = FOLLOWUP
// - tasks: 阶段下挂任务, sort 决定顺序


// - DO 段: 通用 PREP/REQ/CONTRACT + 按类型的 EXECUTE; DELIVER: 通用 FOLLOWUP
type SeedTask = {
  code: string;
  name: string;
  description?: string;
  requiredRole?: string;
  requiresDeliverable?: boolean;
  requiresOnsite?: boolean;
  requiresTwoStepReview?: boolean;
  isRecurring?: boolean;
  recurrenceUnit?: string;
  recurrenceInterval?: number;
  estimateDays?: number;
};
type SeedStage = {
  phase: "DO" | "DELIVER";
  code: string;
  name: string;
  description?: string;
  isRequired?: boolean;
  tasks: SeedTask[];
};
type SeedTemplate = {
  serviceType: string;
  name: string;
  description: string;
  stages: SeedStage[];
};

// 通用 4 阶段(所有 9 类服务一致)
const COMMON_PREP_TASKS: SeedTask[] = [
  { code: "VISIT_INIT",     name: "委托单位初访",       description: "了解委托单位及项目基本概况、安全管理现状、技术要求、服务目的", requiredRole: "SALES" },
  { code: "MATCH_CHECK",    name: "服务匹配度评估",     description: "分析服务要求、自身业务能力、风险程度及法律责任", requiredRole: "SALES" },
  { code: "COST_ESTIMATE",  name: "费用测算",           description: "按工作量/人员/技术含量测算成本,分析达成目标的可行性", requiredRole: "SALES" },
  { code: "QUOTE_BID",      name: "报价/投标",          description: "通过洽谈、竞价、投标等方式确定服务费用,接受项目委托", requiredRole: "SALES" },
  { code: "INTERNAL_KICKOFF", name: "内部立项",         description: "内部立项审批", requiredRole: "SALES" }
];
const COMMON_REQ_TASKS: SeedTask[] = [
  { code: "REQ_DISCUSS",    name: "服务内容沟通",       description: "充分沟通安全生产特点、服务内容、时限、频次", requiredRole: "SALES" },
  { code: "WORK_PLAN",      name: "服务工作方案编制",   description: "任务/进度/资源规划", requiredRole: "EXPERT" },
  { code: "PLAN_REVIEW",    name: "方案内部评审",       description: "方案内部评审会", requiredRole: "ADMIN" }
];
const COMMON_CONTRACT_TASKS: SeedTask[] = [
  { code: "TERM_DISCUSS",   name: "合同条款协商",       description: "责权对等的合同条款协商", requiredRole: "SALES" },
  { code: "CONTRACT_REVIEW", name: "合同评审",          description: "合同评审(责权对等)", requiredRole: "ADMIN" },
  { code: "CONTRACT_SIGN",  name: "合同签订",           description: "书面服务合同签订", requiredRole: "SALES" },
  { code: "CONTRACT_ARCHIVE", name: "合同归档",         description: "合同正本归档", requiredRole: "OPS" }
];
const COMMON_FOLLOWUP_TASKS: SeedTask[] = [
  { code: "SATISFACTION",   name: "满意度回访",         description: "电话/网络/现场回访,记录满意度与具体意见", requiredRole: "SALES" },
  { code: "FEEDBACK_LOG",   name: "意见反馈记录",       description: "汇总反馈意见", requiredRole: "OPS" },
  { code: "IMPROVEMENT_PLAN", name: "改进措施制定",     description: "针对不足制定改进措施", requiredRole: "ADMIN" },
  { code: "IMPROVEMENT_DO", name: "改进措施落实",       description: "落实改进措施并跟踪", requiredRole: "OPS" }
];

function commonPrepStage(): SeedStage { return { phase: "PREP", code: "PREP", name: "前期准备", description: "项目前期准备: 评估、测算、报价、立项", isRequired: true, tasks: COMMON_PREP_TASKS }; }
function commonReqStage(): SeedStage  { return { phase: "REQUIREMENT", code: "REQUIREMENT", name: "需求识别", description: "项目需求识别: 沟通、方案、评审", isRequired: true, tasks: COMMON_REQ_TASKS }; }
function commonContractStage(): SeedStage { return { phase: "CONTRACT", code: "CONTRACT", name: "合同签订", description: "签订服务合同", isRequired: true, tasks: COMMON_CONTRACT_TASKS }; }
function commonFollowupStage(): SeedStage { return { phase: "FOLLOWUP", code: "FOLLOWUP", name: "回访与改进", description: "服务回访与改进", isRequired: true, tasks: COMMON_FOLLOWUP_TASKS }; }

// DO 段差异化任务按 9 类服务(原 EXECUTE 段,已去废弃字段)
const EXECUTE_BY_TYPE: Record<string, SeedTask[]> = {
  HAZARD_ANA: [
    { code: "ANA_PLAN",          name: "排查方案制定",       description: "依据法规标准,结合区域/行业风险特点制定方案", requiredRole: "EXPERT" },
    { code: "TEAM_BUILD",        name: "专家组建 + 资料收集", description: "组建专家组,收集法规/标准/技术/类比资料", requiredRole: "EXPERT" },
    { code: "ONSITE_SURVEY",     name: "现场勘查",           description: "现场管理与基础管理双线勘查", requiredRole: "EXPERT" },
    { code: "HAZARD_RECORD",     name: "隐患拍照/记录/访谈", description: "隐患现场记录、拍照、人员访谈", requiredRole: "EXPERT" },
    { code: "HAZARD_REPORT",     name: "隐患清单 + 整改对策", description: "汇总隐患清单,提出整改对策措施", requiredRole: "EXPERT" },
    { code: "RECT_CONFIRM",      name: "整改确认",           description: "按委托单位要求的时间/方式实施整改确认", requiredRole: "EXPERT" },
    { code: "RECT_FOLLOWUP",     name: "整改回访",           description: "整改情况回访", requiredRole: "EXPERT" }
  ],
  SYS_BUILDING: [
    { code: "DIAGNOSIS",         name: "现状诊断 / 差距分析", description: "诊断现状,识别差距", requiredRole: "EXPERT" },
    { code: "SYS_DOCS",          name: "体系文件编制",       description: "文化/标准化/风险分级/应急救援四大子体系文件编制", requiredRole: "EXPERT" },
    { code: "TRIAL_RUN",         name: "试运行",             description: "体系试运行", requiredRole: "EXPERT" },
    { code: "TRAINING_GUIDE",    name: "培训指导",           description: "配套培训与现场指导", requiredRole: "EXPERT" },
    { code: "INTERNAL_REVIEW",   name: "内部评审",           description: "体系内部评审", requiredRole: "EXPERT" },
    { code: "EXTERNAL_REVIEW",   name: "外部评审",           description: "外部专家评审", requiredRole: "EXPERT" },
    { code: "CONTINUOUS_IMPROVE", name: "持续改进跟踪",     description: "持续改进跟踪", requiredRole: "EXPERT" }
  ],
  EVALUATION: [
    { code: "OBJ_IDENTIFY",      name: "评价对象识别",       description: "识别危化品使用/工程/系统/区域/作业过程", requiredRole: "EXPERT" },
    { code: "EVAL_PLAN",         name: "评估方案",           description: "安全评估方案", requiredRole: "EXPERT" },
    { code: "DATA_COLLECT",      name: "现场数据采集",       description: "现场数据采集 + 类比工程调研 + 检测检验", requiredRole: "EXPERT" },
    { code: "RISK_ANALYSIS",     name: "风险分析",           description: "利用安全系统工程原理进行风险分析", requiredRole: "EXPERT" },
    { code: "COUNTERMEASURE",    name: "安全对策措施",       description: "按事故风险大小提出对策措施", requiredRole: "EXPERT" },
    { code: "REPORT_DRAFT",      name: "报告初稿",           description: "风险评估报告/专家意见书初稿", requiredRole: "EXPERT" },
    { code: "REPORT_PUBLISH",    name: "报告发布",           description: "校核→审核→发布", requiredRole: "EXPERT" },
    { code: "FILING_RECEIPT",    name: "备案回执",           description: "备案回执(可选)", requiredRole: "OPS" }
  ],
  RESIDENT: [
    { code: "RES_PLAN",          name: "派驻方案",           description: "派驻人数/周期/频次方案", requiredRole: "SALES" },
    { code: "RES_PERSONNEL",     name: "派驻人员确定",       description: "派驻人员确定", requiredRole: "ADMIN" },
    { code: "PRE_TRAINING",      name: "岗前培训",           description: "派驻人员岗前培训", requiredRole: "EXPERT" },
    { code: "MONTHLY_REPORT",    name: "月度报告",           description: "派驻期间月度报告(循环 1 MONTH)", requiredRole: "EXPERT" },
    { code: "FINAL_EVAL",        name: "末期评估报告",       description: "派驻末期评估报告", requiredRole: "EXPERT" },
    { code: "HANDOVER",          name: "撤场交接 + 档案归档", description: "撤场交接,服务档案归档(3 年保管)", requiredRole: "OPS" }
  ],
  SAFETY_CONSULT: [
    { code: "REQ_RESEARCH",      name: "需求调研",           description: "政策/战略/规划/方案方向调研", requiredRole: "EXPERT" },
    { code: "STRATEGY_DOCS",     name: "战略/规划/方案编制", description: "战略/规划/方案编制", requiredRole: "EXPERT" },
    { code: "DOC_INTERNAL_REVIEW", name: "内部评审",         description: "方案内部评审", requiredRole: "EXPERT" },
    { code: "CLIENT_CONFIRM",    name: "客户对接确认",       description: "与客户对接确认方案", requiredRole: "SALES" },
    { code: "POLICY_BRIEF",      name: "政策解读/方案审核意见", description: "政策解读报告或方案审核意见", requiredRole: "EXPERT" },
    { code: "TECH_PROMOTE",      name: "新技术推广",         description: "应急领域新技术/产品/材料/设备推广(可选)", requiredRole: "EXPERT" },
    { code: "SEMINAR_ORG",       name: "研讨交流组织",       description: "先进安全管理和技术交流研讨(可选)", requiredRole: "SALES" }
  ],
  SURVEY: [
    { code: "SURVEY_PLAN",       name: "普查方案",           description: "普查指标/范围/时间表", requiredRole: "EXPERT" },
    { code: "FORM_TRAINING",     name: "表格设计 + 填报培训", description: "普查表格设计 + 填报培训", requiredRole: "EXPERT" },
    { code: "DATA_COLLECT_S",    name: "数据采集",           description: "普查数据采集", requiredRole: "EXPERT" },
    { code: "DATA_AUDIT",        name: "数据初审 + 复核",    description: "数据初审与复核", requiredRole: "EXPERT" },
    { code: "DATA_CLEAN",        name: "数据清洗 + 统计分析", description: "数据清洗与统计分析", requiredRole: "EXPERT" },
    { code: "SURVEY_REPORT",     name: "普查/核验报告",      description: "普查/核验报告", requiredRole: "EXPERT" },
    { code: "CLIENT_ACCEPT",     name: "客户验收",           description: "政府部门/集团/平台客户验收", requiredRole: "ADMIN" },
    { code: "PLATFORM_FEEDBACK", name: "平台数据回填",       description: "工业企业安全在线等平台数据常普常新回填(可选)", requiredRole: "OPS" }
  ],
  SAFETY_TRAIN: [
    { code: "TRAIN_REQ",         name: "培训需求调研",       description: "培训需求调研", requiredRole: "EXPERT" },
    { code: "COURSE_DESIGN",     name: "课程设计",           description: "安全知识/法规/评估方法课程设计", requiredRole: "EXPERT" },
    { code: "LECTURER_MATCH",    name: "讲师对接",           description: "讲师对接", requiredRole: "OPS" },
    { code: "TRAIN_PREP",        name: "培训通知 + 场地物料", description: "培训通知 + 场地物料准备", requiredRole: "OPS" },
    { code: "TRAIN_EXEC",        name: "培训实施",           description: "培训实施", requiredRole: "EXPERT" },
    { code: "ATTENDANCE",        name: "签到记录",           description: "培训签到记录", requiredRole: "OPS" },
    { code: "TRAIN_EVAL",        name: "培训考核 + 效果评估", description: "培训考核与效果评估", requiredRole: "EXPERT" },
    { code: "TRAIN_ARCHIVE",     name: "资料归档",           description: "培训资料归档", requiredRole: "OPS" },
    { code: "CERT_ISSUE",        name: "证书发放",           description: "培训证书发放(可选)", requiredRole: "OPS" }
  ],
  STANDARDIZATION: [
    { code: "STD_SELF_EVAL",     name: "标准化自评",         description: "安全生产标准化自评", requiredRole: "EXPERT" },
    { code: "STD_DOCS",          name: "体系文件编制",       description: "安全生产标准化体系文件编制", requiredRole: "EXPERT" },
    { code: "STD_TRIAL",         name: "试运行",             description: "标准化体系试运行", requiredRole: "EXPERT" },
    { code: "STD_INT_REVIEW",    name: "内部评审",           description: "标准化内部评审", requiredRole: "EXPERT" },
    { code: "STD_EXT_REVIEW",    name: "外部评审",           description: "标准化外部评审", requiredRole: "EXPERT" },
    { code: "ANNUAL_SELF_EVAL",  name: "年度自评报告",       description: "每年完成企业年度自评报告(循环 1 YEAR)", requiredRole: "EXPERT" },
    { code: "STD_RENEWAL",       name: "期满换证",           description: "安全生产标准化期满换证", requiredRole: "EXPERT" },
    { code: "STD_CONTINUOUS",    name: "持续改进",           description: "标准化体系持续改进", requiredRole: "EXPERT" }
  ],
  EMERGENCY_PLAN: [
    { code: "EP_COLLECT",        name: "资料收集 + 风险分析", description: "收集资料,识别风险", requiredRole: "EXPERT" },
    { code: "EP_DRAFT",          name: "预案初稿",           description: "应急预案初稿编制", requiredRole: "EXPERT" },
    { code: "EP_INT_REVIEW",     name: "预案内部评审",       description: "预案内部评审", requiredRole: "EXPERT" },
    { code: "EP_EXT_REVIEW",     name: "预案专家评审",       description: "预案专家评审", requiredRole: "EXPERT" },
    { code: "EP_CLIENT_CONFIRM", name: "客户确认",           description: "委托单位确认预案", requiredRole: "SALES" },
    { code: "DRILL_PLAN",        name: "演练方案",           description: "应急预案演练方案", requiredRole: "EXPERT" },
    { code: "DRILL_EXEC",        name: "演练实施 + 评估",    description: "演练实施与评估", requiredRole: "EXPERT" },
    { code: "EP_FILING",         name: "备案提交",           description: "应急预案备案提交", requiredRole: "OPS" },
    { code: "EP_FILING_RECEIPT", name: "备案回执",           description: "备案回执归档", requiredRole: "OPS" },
    { code: "EP_TRAINING",       name: "应急预案培训",       description: "应急预案培训", requiredRole: "EXPERT" }
  ]
};

const TEMPLATE_META: Record<string, { name: string; description: string }> = {
  HAZARD_ANA:      { name: "安全隐患排查标准流程",       description: "现场管理与基础管理双线隐患排查,出具整改清单并跟踪整改" },
  SYS_BUILDING:    { name: "安全体系建设标准流程",       description: "文化/标准化/风险分级/应急救援四大子体系建设与试运行" },
  EVALUATION:      { name: "安全评估标准流程",           description: "危化品/工程/系统/区域/作业过程风险评估,出具评估报告或专家意见书" },
  RESIDENT:        { name: "派驻托管服务标准流程",       description: "派驻人员进驻蹲点,定期辅助安全生产主体责任落实" },
  SAFETY_CONSULT:  { name: "管理咨询服务标准流程",       description: "政策/战略/规划/方案编制审核及新技术推广与研讨交流" },
  SURVEY:          { name: "普查核验服务标准流程",       description: "信息统计/分析/审核/验收,如平台数据常普常新、标准化评审" },
  SAFETY_TRAIN:    { name: "宣传教育培训标准流程",       description: "安全知识/法规/评估方法培训,策划宣传教育活动" },
  STANDARDIZATION: { name: "标准化体系创建/换证标准流程", description: "标准化体系创建、试运行、年度自评、期满换证" },
  EMERGENCY_PLAN:  { name: "应急预案编制/评审/演练标准流程", description: "应急预案编制、评审、备案、培训与演练" }
};

function buildTemplate(serviceType: string): SeedTemplate {
  return {
    serviceType,
    name: TEMPLATE_META[serviceType].name,
    description: TEMPLATE_META[serviceType].description,
    stages: [
doStage([...COMMON_PREP_TASKS, ...COMMON_REQ_TASKS, ...COMMON_CONTRACT_TASKS, ...(EXECUTE_BY_TYPE[serviceType] || [])]),
      deliverStage(COMMON_FOLLOWUP_TASKS)
    ]
  };
}

const WORKFLOW_TEMPLATE_TYPES = Object.keys(TEMPLATE_META);

async function seedWorkflowTemplates() {
  // 兜底: 找库内任意一个 ADMIN 用户, 作为 WorkflowTemplate.createdById 引用.
  // 生产首次部署: 先 pnpm create-admin 创管理员, 再跑 pnpm seed 才能落地模板;
  // 之前如果跑过 seed-roles + 没建管理员, 这里会优雅跳过并提示.
  const admin = await prisma.user.findFirst({
    where: { role: { code: "ADMIN" }, deletedAt: null },
    orderBy: { createdAt: "asc" }
  });
  if (!admin) {
    console.log("⏭️  Workflow 模板 seed 跳过: 库内无 ADMIN 用户. 跑 pnpm create-admin 创建管理员后再 pnpm seed.");
    return;
  }

  // 护栏: 如果已有任何 WorkflowTaskInstance (非软删) 在跑, 模板就不要再覆盖重建了 —
  // 重建会 deleteMany(stage) 级联删 task, 进而把指向这些 task 的 instance 全部干掉,
  // 正在执行的工作流会丢历史.  此时只更新模板的 name/description 元数据, 跳过 stage/task.
  const inUseInstanceCount = await prisma.workflowTaskInstance.count({
    where: { deletedAt: null }
  });
  const locked = inUseInstanceCount > 0;
  if (locked) {
    console.log(`⚠️  已有 ${inUseInstanceCount} 条 WorkflowTaskInstance 在跑, 模板 stage/task 不覆盖 (只更新元数据)`);
  }

  for (const serviceType of WORKFLOW_TEMPLATE_TYPES) {
    const def = buildTemplate(serviceType);
    // 用 serviceType + isActive 组合作为唯一 key, 找到就 update 覆盖, 找不到就 create
    const existing = await prisma.workflowTemplate.findFirst({
      where: { serviceType, isActive: true, deletedAt: null }
    });
    const tpl = existing
      ? await prisma.workflowTemplate.update({
          where: { id: existing.id },
          data: {
            name: def.name,
            description: def.description
          }
        })
      : await prisma.workflowTemplate.create({
          data: {
            serviceType,
            name: def.name,
            description: def.description,
            isActive: true,
            createdById: admin.id
          }
        });

    // 清理旧 stage(级联删 task),重新灌入 — 但有 in-use instance 时跳过 (见上方护栏)
    if (locked) continue;
    await prisma.workflowStage.deleteMany({ where: { templateId: tpl.id } });
    for (let si = 0; si < def.stages.length; si++) {
      const s = def.stages[si];
      const stage = await prisma.workflowStage.create({
        data: {
          templateId: tpl.id,
          phase: s.phase,
          code: s.code,
          name: s.name,
          sort: si,
          description: s.description ?? null,
          isRequired: s.isRequired ?? true
        }
      });
      for (let ti = 0; ti < s.tasks.length; ti++) {
        const t = s.tasks[ti];
        await prisma.workflowTask.create({
          data: {
            stageId: stage.id,
            code: t.code,
            name: t.name,
            sort: ti,
            description: t.description ?? null,
            requiredRole: t.requiredRole ?? null,
            requiresDeliverable: t.requiresDeliverable ?? false,
            requiresOnsite: t.requiresOnsite ?? false,
            requiresTwoStepReview: t.requiresTwoStepReview ?? false,
            isRecurring: t.isRecurring ?? false,
            recurrenceUnit: t.recurrenceUnit ?? null,
            recurrenceInterval: t.recurrenceInterval ?? null,
            estimateDays: t.estimateDays ?? null
          }
        });
      }
    }
  }
  if (locked) {
    console.log(`⏭️  Workflow 模板 seed 跳过重建: ${WORKFLOW_TEMPLATE_TYPES.length} 份已存在, 元数据已更新`);
    return;
  }
  const totalTasks = WORKFLOW_TEMPLATE_TYPES.reduce(
    (sum, t) => sum + (EXECUTE_BY_TYPE[t]?.length || 0) + COMMON_PREP_TASKS.length + COMMON_REQ_TASKS.length + COMMON_CONTRACT_TASKS.length + COMMON_FOLLOWUP_TASKS.length,
    0
  );
  console.log(`✅ Workflow 模板 seed 完成: ${WORKFLOW_TEMPLATE_TYPES.length} 份激活模板 / ${totalTasks} 任务`);
}

async function main() {
  const roleDefs = [
    { code: "ADMIN",   name: "管理员",   description: "系统管理员" },
    { code: "SALES",   name: "业务人员", description: "负责客户/合同/项目推进" },
    { code: "FINANCE", name: "财务人员", description: "负责开票/回款/对账" },
    { code: "OPS",     name: "行政人员", description: "基础信息维护" },
    { code: "EXPERT",  name: "技术专家", description: "承担现场勘查、报告撰写等专业工作" }
  ] as const;

  for (const r of roleDefs) {
    await prisma.role.upsert({
      where: { code: r.code },
      update: { name: r.name, description: r.description, permissions: ROLE_PERMISSIONS[r.code] as unknown as object, isSystem: true },
      create: {
        code: r.code,
        name: r.name,
        description: r.description,
        permissions: ROLE_PERMISSIONS[r.code] as unknown as object,
        isSystem: true
      }
    });
  }

  // ----- 用户不在 seed 中创建 -----
  // 初始管理员用 scripts/create-admin.ts 创建: pnpm create-admin --employeeNo admin --name "..." --email ... --password ...
  // WorkflowTemplate.createdById 由 seedWorkflowTemplates 兜底 (取库内第一个 ADMIN 用户; 没有则跳过模板写入并提示)

  const dictDefs: Array<{ category: string; code: string; label: string; sort: number }> = [
    { category: "SERVICE_TYPE", code: "SAFETY_CONSULT", label: "管理咨询", sort: 1 },
    { category: "SERVICE_TYPE", code: "SAFETY_TRAIN", label: "宣传教育培训", sort: 2 },
    { category: "SERVICE_TYPE", code: "HAZARD_ANA", label: "安全隐患排查", sort: 3 },
    { category: "SERVICE_TYPE", code: "EMERGENCY_PLAN", label: "应急预案/演练", sort: 4 },
    { category: "SERVICE_TYPE", code: "EVALUATION", label: "安全评估", sort: 5 },
    { category: "SERVICE_TYPE", code: "SYS_BUILDING", label: "安全体系建设", sort: 6 },
    { category: "SERVICE_TYPE", code: "RESIDENT", label: "派驻托管服务", sort: 7 },
    { category: "SERVICE_TYPE", code: "SURVEY", label: "普查核验服务", sort: 8 },
    { category: "SERVICE_TYPE", code: "STANDARDIZATION", label: "标准化体系创建/换证", sort: 9 },
    { category: "SERVICE_TYPE", code: "OTHER", label: "其他", sort: 99 },
    { category: "CUSTOMER_TYPE", code: "ENTERPRISE", label: "企业", sort: 1 },
    { category: "CUSTOMER_TYPE", code: "GOV", label: "政府", sort: 2 },
    { category: "CUSTOMER_TYPE", code: "OTHER", label: "其他", sort: 3 },



    // 客户规模 - LARGE 大型 | MEDIUM 中型 | SMALL 小型 | MICRO 微型
    { category: "CUSTOMER_SCALE", code: "LARGE",  label: "大型", sort: 1 },
    { category: "CUSTOMER_SCALE", code: "MEDIUM", label: "中型", sort: 2 },
    { category: "CUSTOMER_SCALE", code: "SMALL",  label: "小型", sort: 3 },
    { category: "CUSTOMER_SCALE", code: "MICRO",  label: "微型", sort: 4 },
    { category: "CUSTOMER_INDUSTRY", code: "MANUFACTURING", label: "制造业", sort: 1 },
    { category: "CUSTOMER_INDUSTRY", code: "CHEMICAL", label: "化工", sort: 2 },
    { category: "CUSTOMER_INDUSTRY", code: "CONSTRUCTION", label: "建筑/房地产", sort: 3 },
    { category: "CUSTOMER_INDUSTRY", code: "ENERGY", label: "能源/电力", sort: 4 },
    { category: "CUSTOMER_INDUSTRY", code: "MINING", label: "矿山", sort: 5 },
    { category: "CUSTOMER_INDUSTRY", code: "TRANSPORTATION", label: "交通运输", sort: 6 },
    { category: "CUSTOMER_INDUSTRY", code: "WAREHOUSING", label: "仓储物流", sort: 7 },
    { category: "CUSTOMER_INDUSTRY", code: "COMMERCE", label: "商业贸易", sort: 8 },
    { category: "CUSTOMER_INDUSTRY", code: "FINANCE", label: "金融", sort: 9 },
    { category: "CUSTOMER_INDUSTRY", code: "HEALTHCARE", label: "医疗医药", sort: 10 },
    { category: "CUSTOMER_INDUSTRY", code: "EDUCATION", label: "教育", sort: 11 },
    { category: "CUSTOMER_INDUSTRY", code: "IT", label: "信息技术", sort: 12 },
    { category: "CUSTOMER_INDUSTRY", code: "GOVERNMENT", label: "政府/事业单位", sort: 13 },
    { category: "CUSTOMER_INDUSTRY", code: "SERVICES", label: "服务业", sort: 14 },
    { category: "CUSTOMER_INDUSTRY", code: "AGRICULTURE", label: "农林牧渔", sort: 15 },
    { category: "CUSTOMER_INDUSTRY", code: "F_AND_B", label: "餐饮酒店", sort: 16 },
    { category: "CUSTOMER_INDUSTRY", code: "OTHER", label: "其他", sort: 99 },
    { category: "CUSTOMER_SOURCE", code: "EXHIBITION", label: "展会", sort: 1 },
    { category: "CUSTOMER_SOURCE", code: "REFERRAL", label: "客户介绍/转介绍", sort: 2 },
    { category: "CUSTOMER_SOURCE", code: "WEBSITE", label: "官网咨询", sort: 3 },
    { category: "CUSTOMER_SOURCE", code: "PHONE", label: "电话来访", sort: 4 },
    { category: "CUSTOMER_SOURCE", code: "COLD_VISIT", label: "主动拜访", sort: 5 },
    { category: "CUSTOMER_SOURCE", code: "BIDDING", label: "招投标", sort: 6 },
    { category: "CUSTOMER_SOURCE", code: "PARTNER", label: "合作伙伴", sort: 7 },
    { category: "CUSTOMER_SOURCE", code: "MEDIA", label: "媒体广告", sort: 8 },
    { category: "CUSTOMER_SOURCE", code: "SOCIAL_MEDIA", label: "社交媒体", sort: 9 },
    { category: "CUSTOMER_SOURCE", code: "GOV_REFERRAL", label: "政府推荐", sort: 10 },
    { category: "CUSTOMER_SOURCE", code: "REPEAT", label: "老客户", sort: 11 },
    { category: "CUSTOMER_SOURCE", code: "OTHER", label: "其他", sort: 99 },
    // 收款方式 - 列表 / 详情 / Drawer 都要
    { category: "PAYMENT_RECEIVE_METHOD", code: "BANK_TRANSFER", label: "银行转账", sort: 1 },
    { category: "PAYMENT_RECEIVE_METHOD", code: "CHECK", label: "支票", sort: 2 },
    { category: "PAYMENT_RECEIVE_METHOD", code: "CASH", label: "现金", sort: 3 },
    { category: "PAYMENT_RECEIVE_METHOD", code: "WECHAT", label: "微信", sort: 4 },
    { category: "PAYMENT_RECEIVE_METHOD", code: "ALIPAY", label: "支付宝", sort: 5 },
    { category: "PAYMENT_RECEIVE_METHOD", code: "OTHER", label: "其他", sort: 99 },
    // 跟进方式 / 结果 - 客户详情页的"新增跟进"要用
    { category: "FOLLOW_METHOD", code: "VISIT", label: "上门拜访", sort: 1 },
    { category: "FOLLOW_METHOD", code: "CALL", label: "电话", sort: 2 },
    { category: "FOLLOW_METHOD", code: "WECHAT", label: "微信", sort: 3 },
    { category: "FOLLOW_METHOD", code: "EMAIL", label: "邮件", sort: 4 },
    { category: "FOLLOW_METHOD", code: "OTHER", label: "其他", sort: 99 },
    { category: "FOLLOW_RESULT", code: "INTENT", label: "有意向", sort: 1 },
    { category: "FOLLOW_RESULT", code: "NO_INTENT", label: "无意向", sort: 2 },
    { category: "FOLLOW_RESULT", code: "PENDING", label: "待定", sort: 3 },
    { category: "FOLLOW_RESULT", code: "SIGNED", label: "已签约", sort: 4 },
    // 人员证书类型 - 标书素材库 v1
    { category: "PERSONNEL_CERT_TYPE", code: "REGISTERED_SAFETY_ENGINEER", label: "注册安全工程师", sort: 10 },
    { category: "PERSONNEL_CERT_TYPE", code: "SAFETY_EVALUATOR",          label: "安全评价师",       sort: 20 },
    { category: "PERSONNEL_CERT_TYPE", code: "EMERGENCY_RESCUER",         label: "应急救援员",       sort: 30 },
    { category: "PERSONNEL_CERT_TYPE", code: "TRAINING_INSTRUCTOR",       label: "培训师资",         sort: 40 },
    { category: "PERSONNEL_CERT_TYPE", code: "SPECIAL_OPERATION",         label: "特种作业操作证",   sort: 50 },
    { category: "PERSONNEL_CERT_TYPE", code: "OTHER",                     label: "其他",             sort: 999 },
    // === 以下 8 类状态机字典, 以 prisma/schema.prisma 注释为权威 (schema 允许的 code) ===
    // === 同步 lib/enum-maps.ts 现有 label, 方便后续 useDict 取代 hardcode ===
    // 客户状态机
    { category: "CUSTOMER_STATUS", code: "LEAD",        label: "线索",     sort: 1 },
    { category: "CUSTOMER_STATUS", code: "NEGOTIATING", label: "洽谈中",   sort: 2 },
    { category: "CUSTOMER_STATUS", code: "SIGNED",      label: "已签约",   sort: 3 },
    { category: "CUSTOMER_STATUS", code: "LOST",        label: "已流失",   sort: 4 },
    { category: "CUSTOMER_STATUS", code: "FROZEN",      label: "已冻结",   sort: 5 },
    // 合同状态机
    { category: "CONTRACT_STATUS", code: "DRAFT",          label: "草稿",     sort: 1 },
    { category: "CONTRACT_STATUS", code: "PENDING_REVIEW", label: "待审批",   sort: 2 },
    { category: "CONTRACT_STATUS", code: "EFFECTIVE",      label: "已生效",   sort: 3 },
    { category: "CONTRACT_STATUS", code: "EXECUTING",      label: "执行中",   sort: 4 },
    { category: "CONTRACT_STATUS", code: "COMPLETED",      label: "已完成",   sort: 5 },
    { category: "CONTRACT_STATUS", code: "TERMINATED",     label: "已终止",   sort: 6 },
    { category: "CONTRACT_STATUS", code: "EXPIRED",        label: "已过期",   sort: 7 },
    // 项目状态机
    { category: "PROJECT_STATUS", code: "PLANNED",     label: "计划中",   sort: 1 },
    { category: "PROJECT_STATUS", code: "IN_PROGRESS", label: "进行中",   sort: 2 },
    { category: "PROJECT_STATUS", code: "SUSPENDED",   label: "已暂停",   sort: 3 },
    { category: "PROJECT_STATUS", code: "DELIVERED",   label: "已交付",   sort: 4 },
    { category: "PROJECT_STATUS", code: "ACCEPTED",    label: "已验收",   sort: 5 },
    { category: "PROJECT_STATUS", code: "CLOSED",      label: "已关闭",   sort: 6 },
    { category: "PROJECT_STATUS", code: "CANCELLED",   label: "已取消",   sort: 7 },
    // 发票类型
    { category: "INVOICE_TYPE", code: "VAT_SPECIAL",    label: "增值税专用发票", sort: 1 },
    { category: "INVOICE_TYPE", code: "VAT_GENERAL",    label: "增值税普通发票", sort: 2 },
    { category: "INVOICE_TYPE", code: "VAT_ELECTRONIC", label: "增值税电子专票", sort: 3 },
    { category: "INVOICE_TYPE", code: "ELEC_NORMAL",    label: "电子普通发票",     sort: 4 },
    // 开票状态机
    { category: "INVOICE_STATUS", code: "DRAFT",           label: "草稿",       sort: 1 },
    { category: "INVOICE_STATUS", code: "PENDING_FINANCE", label: "待财务审核", sort: 2 },
    { category: "INVOICE_STATUS", code: "ISSUED",          label: "已开票",     sort: 3 },
    { category: "INVOICE_STATUS", code: "REJECTED",        label: "已驳回",     sort: 4 },
    { category: "INVOICE_STATUS", code: "VOIDED",          label: "已作废",     sort: 5 },
    { category: "INVOICE_STATUS", code: "RED_FLUSHED",     label: "已红冲",     sort: 6 },
    // 回款状态机
    { category: "PAYMENT_STATUS", code: "PLANNED",    label: "计划中",   sort: 1 },
    { category: "PAYMENT_STATUS", code: "CONFIRMED",  label: "已确认",   sort: 2 },
    { category: "PAYMENT_STATUS", code: "RECONCILED", label: "已对账",   sort: 3 },
    { category: "PAYMENT_STATUS", code: "REFUNDED",   label: "已退款",   sort: 4 },
    { category: "PAYMENT_STATUS", code: "CANCELLED",  label: "已取消",   sort: 5 },
    // 合同付款方式
    { category: "CONTRACT_PAYMENT_METHOD", code: "LUMP_SUM",   label: "一次性", sort: 1 },
    { category: "CONTRACT_PAYMENT_METHOD", code: "BY_PHASE",   label: "按阶段", sort: 2 },
    { category: "CONTRACT_PAYMENT_METHOD", code: "BY_MONTH",   label: "按月",   sort: 3 },
    { category: "CONTRACT_PAYMENT_METHOD", code: "BY_QUARTER", label: "按季",   sort: 4 },
    // 审批动作
    { category: "REVIEW_ACTION", code: "SUBMIT",   label: "提交审批", sort: 1 },
    { category: "REVIEW_ACTION", code: "APPROVE",  label: "批准",     sort: 2 },
    { category: "REVIEW_ACTION", code: "REJECT",   label: "驳回",     sort: 3 },
    { category: "REVIEW_ACTION", code: "WITHDRAW", label: "撤回",     sort: 4 },
    { category: "REVIEW_ACTION", code: "EXECUTE",  label: "开始执行", sort: 5 },
    { category: "REVIEW_ACTION", code: "SUSPEND",  label: "暂停",     sort: 6 },
    { category: "REVIEW_ACTION", code: "RESUME",   label: "恢复",     sort: 7 },
    { category: "REVIEW_ACTION", code: "COMPLETE", label: "结清",     sort: 8 },
  ];
  for (const d of dictDefs) {
    await prisma.dictionary.upsert({
      where: { category_code: { category: d.category, code: d.code } },
      update: { label: d.label, sort: d.sort },
      create: d
    });
  }


  // ----- 部门 seed -----
  // 3 个顶级部门(业务/技术/财务)+ 2 个技术部下子部门
  const techDept = await prisma.department.upsert({
    where: { code: "tech" },
    update: { name: "技术部", sort: 2, isActive: true },
    create: { id: "dept_seed_tech", code: "tech", name: "技术部", sort: 2, isActive: true }
  });
  const _bizDept = await prisma.department.upsert({
    where: { code: "biz" },
    update: { name: "业务部", sort: 1, isActive: true },
    create: { id: "dept_seed_biz", code: "biz", name: "业务部", sort: 1, isActive: true }
  });
  const _finDept = await prisma.department.upsert({
    where: { code: "fin" },
    update: { name: "财务部", sort: 3, isActive: true },
    create: { id: "dept_seed_fin", code: "fin", name: "财务部", sort: 3, isActive: true }
  });
  const _techOps = await prisma.department.upsert({
    where: { code: "tech_ops" },
    update: { name: "技术运维组", parentId: techDept.id, sort: 1, isActive: true },
    create: { id: "dept_seed_tech_ops", code: "tech_ops", name: "技术运维组", parentId: techDept.id, sort: 1, isActive: true }
  });
  const _techWeb = await prisma.department.upsert({
    where: { code: "tech_web" },
    update: { name: "前端组", parentId: techDept.id, sort: 2, isActive: true },
    create: { id: "dept_seed_tech_web", code: "tech_web", name: "前端组", parentId: techDept.id, sort: 2, isActive: true }
  });

  await seedWorkflowTemplates();
  console.log(`✅ 系统管理 seed 完成: 5 角色 + 5 部门 + ${dictDefs.length} 字典`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
