// 企业资产库 种子数据
// - 12 条覆盖 8 种 type
// - 1 条 validTo=15 天后(EXPIRING_SOON),1 条去年(EXPIRED)
// - 幂等(按 code 判重)
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! })
});

const SEEDS = [
  {
    code: "QT-ASSET-2024-0001",
    type: "LICENSE",
    name: "杭州企泰安全科技有限公司营业执照",
    description: "公司主体营业执照",
    validFrom: "2020-01-01T00:00:00Z",
    validTo: "2030-12-31T00:00:00Z",
    tags: ["主体", "公司"],
    attributes: {
      unifiedSocialCreditCode: "91330100MA0000000C",
      legalRepresentative: "张三",
      registeredCapital: "1000万",
      establishDate: "2020-01-01T00:00:00Z",
      businessScope: "安全咨询服务;安全培训;检测服务",
      address: "浙江省杭州市西湖区文三路 1 号"
    }
  },
  {
    code: "QT-ASSET-2024-0002",
    type: "CERTIFICATE",
    name: "安全评价机构资质证书(甲级)",
    description: "应急管理部颁发",
    validFrom: "2022-06-01T00:00:00Z",
    validTo: "2026-12-01T00:00:00Z",
    tags: ["资质", "甲级"],
    attributes: {
      certificateNo: "AP-2022-0001",
      issuingAuthority: "应急管理部",
      gradeLevel: "甲级",
      category: "安全评价"
    }
  },
  {
    code: "QT-ASSET-2024-0003",
    type: "CERTIFICATE",
    name: "即将到期的检测检验资质(用于测试提醒)",
    description: "30 天内到期,触发 EXPIRING_SOON 提醒",
    validFrom: "2020-06-01T00:00:00Z",
    validTo: new Date(Date.now() + 15 * 86_400_000).toISOString(),
    tags: ["资质", "即将到期"],
    attributes: {
      certificateNo: "TC-2020-0002",
      issuingAuthority: "国家市场监督管理总局",
      gradeLevel: "乙级",
      category: "检测检验"
    }
  },
  {
    code: "QT-ASSET-2024-0004",
    type: "QUALIFICATION",
    name: "ISO 9001 质量管理体系认证",
    description: "覆盖范围:安全咨询服务",
    validFrom: "2023-01-15T00:00:00Z",
    validTo: "2026-01-14T00:00:00Z",
    tags: ["ISO", "9001"],
    attributes: {
      standard: "ISO9001",
      certificateNo: "Q-2023-0001",
      issuingAuthority: "中国质量认证中心",
      scope: "安全咨询服务"
    }
  },
  {
    code: "QT-ASSET-2025-0005",
    type: "QUALIFICATION",
    name: "ISO 45001 职业健康安全管理体系",
    tags: ["ISO", "45001"],
    validFrom: "2023-03-01T00:00:00Z",
    validTo: "2026-02-28T00:00:00Z",
    attributes: {
      standard: "ISO45001",
      certificateNo: "S-2023-0002",
      issuingAuthority: "中国质量认证中心"
    }
  },
  {
    code: "QT-ASSET-2024-0006",
    type: "QUALIFICATION",
    name: "ISO 14001 环境管理体系",
    tags: ["ISO", "14001"],
    validFrom: "2023-01-15T00:00:00Z",
    validTo: "2026-01-14T00:00:00Z",
    attributes: {
      standard: "ISO14001",
      certificateNo: "E-2023-0003",
      issuingAuthority: "中国质量认证中心"
    }
  },
  {
    code: "QT-ASSET-2024-0007",
    type: "PERFORMANCE",
    name: "某大型化工企业安全评估项目",
    description: "客户为某央企",
    validFrom: "2023-05-01T00:00:00Z",
    validTo: "2024-04-30T00:00:00Z",
    tags: ["业绩", "安全评估"],
    attributes: {
      projectName: "某大型化工企业 2023 年度安全评估",
      customerName: "某大型化工集团",
      customerContact: "李经理 / 13800001111",
      serviceType: "EVALUATION",
      contractAmount: 480000,
      signDate: "2023-05-01T00:00:00Z",
      completedDate: "2024-04-30T00:00:00Z"
    }
  },
  {
    code: "QT-ASSET-2024-0008",
    type: "PERFORMANCE",
    name: "某市安委会安全隐患排查项目",
    tags: ["业绩", "隐患排查"],
    validFrom: "2023-09-01T00:00:00Z",
    validTo: "2024-08-31T00:00:00Z",
    attributes: {
      projectName: "某市 2023 年度安全隐患排查治理",
      customerName: "某市安全生产委员会",
      serviceType: "HAZARD_ANA",
      contractAmount: 280000,
      signDate: "2023-09-01T00:00:00Z",
      completedDate: "2024-08-31T00:00:00Z"
    }
  },
  {
    code: "QT-ASSET-2024-0009",
    type: "TEAM_MEMBER",
    name: "技术负责人示例",
    description: "注册安全工程师,15 年从业经验",
    tags: ["核心人员", "技术"],
    attributes: {
      externalName: "示例专家(无内部 userId)",
      externalPhone: "13800000000",
      title: "高级工程师 / 注册安全工程师",
      specialty: "化工安全 / 危险化学品",
      yearsOfExperience: 15,
      certificates: [
        { name: "注册安全工程师", no: "RS-2010-XXXXX", validTo: "2027-12-31T00:00:00Z" },
        { name: "一级建造师(机电)", no: "JB-2015-XXXXX" }
      ],
      resumeMarkdown: "2009 年毕业于某 985 高校安全工程专业\n2010-2015:某化工集团安全部\n2015-至今:本公司技术负责人"
    }
  },
  {
    code: "QT-ASSET-2024-0010",
    type: "CASE",
    name: "案例:化工园区安全评估示范",
    description: "典型案例,可作投标业绩展示",
    tags: ["案例", "示范"],
    attributes: {
      title: "某化工园区 2023 年度安全评估",
      customerName: "某化工园区管委会",
      serviceType: "EVALUATION",
      year: 2023,
      scope: "对园区内 28 家危险化学品企业开展全面安全评估",
      highlights: "发现重大隐患 12 项,推动整改完成率 100%\n为园区获得省级安全示范园区称号提供技术支撑",
      result: "客户高度认可,后续签订 3 年期跟踪服务合同"
    }
  },
  {
    code: "QT-ASSET-2024-0011",
    type: "PATENT",
    name: "一种安全风险评估方法及系统(发明专利)",
    tags: ["专利", "核心"],
    validFrom: "2021-08-10T00:00:00Z",
    attributes: {
      patentType: "PATENT",
      patentNo: "ZL202110000000.X",
      name: "一种基于多源数据融合的安全风险评估方法及系统",
      applicants: ["张三", "本公司"],
      applicationDate: "2021-03-15T00:00:00Z",
      grantDate: "2021-08-10T00:00:00Z"
    }
  },
  {
    code: "QT-ASSET-2023-0012",
    type: "CERTIFICATE",
    name: "已过期的某资质(用于测试 EXPIRED)",
    description: "已过期,UI 显示红色",
    validFrom: "2018-01-01T00:00:00Z",
    validTo: "2023-12-31T00:00:00Z",
    tags: ["资质", "已过期"],
    attributes: {
      certificateNo: "OLD-2018-0001",
      issuingAuthority: "某局",
      gradeLevel: "乙级",
      category: "检测检验"
    }
  }
];

async function main() {
  console.log("Seeding company assets...");
  let created = 0;
  let updated = 0;
  for (const seed of SEEDS) {
    // 状态由 validFrom/validTo 推导(daily job 也会做,这里显式算)
    const validTo = seed.validTo ? new Date(seed.validTo) : null;
    const now = new Date();
    let status: string = "VALID";
    if (validTo) {
      const days = (validTo.getTime() - now.getTime()) / 86_400_000;
      if (days < 0) status = "EXPIRED";
      else if (days <= 60) status = "EXPIRING_SOON";
    }
    const existing = await prisma.companyAsset.findUnique({ where: { code: seed.code } });
    if (existing) {
      await prisma.companyAsset.update({
        where: { id: existing.id },
        data: {
          type: seed.type,
          name: seed.name,
          description: seed.description ?? null,
          attributes: seed.attributes,
          tags: seed.tags,
          validFrom: seed.validFrom ? new Date(seed.validFrom) : null,
          validTo: seed.validTo ? new Date(seed.validTo) : null,
          status
        }
      });
      updated++;
    } else {
      // 取一个现有 user 当 owner;若库内无 user,跳过(留给手工录入)
      const owner = await prisma.user.findFirst({ where: { deletedAt: null, status: "ACTIVE" } });
      if (!owner) {
        console.error("No active user; abort seed. Run `npm run create-admin` first.");
        process.exit(1);
      }
      await prisma.companyAsset.create({
        data: {
          code: seed.code,
          type: seed.type,
          name: seed.name,
          description: seed.description ?? null,
          attributes: seed.attributes,
          tags: seed.tags,
          validFrom: seed.validFrom ? new Date(seed.validFrom) : null,
          validTo: seed.validTo ? new Date(seed.validTo) : null,
          status,
          ownerUserId: owner.id
        }
      });
      created++;
    }
  }
  console.log(`Done: ${created} created, ${updated} updated.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
