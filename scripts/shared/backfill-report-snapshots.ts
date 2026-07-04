#!/usr/bin/env tsx
/**
 * 报表中心历史快照补全脚本
 *
 * 用途: 把某一年份(默认 2026)的所有非 CUSTOM 周期的报表快照补全到数据库。
 * 设计动机: 报表中心 2026-07 上线后, 之前的月份没有快照, 打开报表中心
 * 会看到大量"未生成"的占位卡。这个脚本走与 /api/reports/snapshots POST
 * 同一份聚合逻辑 (aggregatePayload), 唯一区别是把"上一个周期"替换成
 * "指定年份的所有周期"。
 *
 * 用法 (在 /opt/qt 下, 加载 .env):
 *   pnpm tsx scripts/shared/backfill-report-snapshots.ts --year 2026
 *   pnpm tsx scripts/shared/backfill-report-snapshots.ts --year 2026 --dry-run
 *   pnpm tsx scripts/shared/backfill-report-snapshots.ts --year 2025 --code FINANCIAL
 *
 * 选项:
 *   --year <yyyy>      必填; 补哪一年的快照
 *   --code <CODE>      可选; 只补某一个报表 (FINANCIAL/BUSINESS/PERFORMANCE), 默认全部
 *   --dry-run          只打印要补的周期, 不写库
 *
 * 行为:
 *   - MONTH:  1~12 月
 *   - QUARTER: Q1~Q4
 *   - YEAR:   整年
 *   - CUSTOM:  跳过 (实时聚合, 不存快照)
 *   - 已存在的快照: 跳过, 不覆盖 (避免破坏手动重新生成过的快照)
 *   - 失败不中断; 错误带 definition code + periodLabel
 */
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  toDefItem,
  type ReportPeriodType,
  resolvePeriod,
  aggregatePayload,
  computeSourceHash,
} from "@/server/services/report";
import { type SessionUser } from "@/lib/session";

const args = z
  .object({
    year: z.coerce.number().int().min(2000).max(2100),
    code: z.string().optional(),
    dryRun: z.boolean().default(false),
  })
  .parse({
    year: getArg("--year"),
    code: getArg("--code"),
    dryRun: hasFlag("--dry-run"),
  });

function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

// 复用 report.ts 内部 buildPayloadForActor 的 system actor 约定
const SYSTEM_ACTOR: SessionUser = {
  id: "system",
  employeeNo: "SYSTEM",
  name: "System",
  email: "system@internal.local",
  roleCode: "ADMIN",
  permissions: [],
};

type Plan = {
  definitionCode: string;
  definitionName: string;
  periodType: Exclude<ReportPeriodType, "CUSTOM">;
  periodLabel: string;
  from: Date;
  to: Date;
};

async function realBuildPlans(year: number, codeFilter: string | undefined): Promise<Plan[]> {
  const defs = await prisma.reportDefinition.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      periodType: { not: "CUSTOM" },
      ...(codeFilter ? { code: codeFilter } : {}),
    },
    orderBy: { sortOrder: "asc" },
  });
  const plans: Plan[] = [];
  for (const def of defs) {
    const periodType = def.periodType as Exclude<ReportPeriodType, "CUSTOM">;
    if (periodType === "MONTH") {
      for (let m = 0; m < 12; m++) {
        const r = resolvePeriod("MONTH", new Date(year, m, 15));
        plans.push({ definitionCode: def.code, definitionName: def.name, periodType, ...r });
      }
    } else if (periodType === "QUARTER") {
      for (let q = 0; q < 4; q++) {
        const r = resolvePeriod("QUARTER", new Date(year, q * 3 + 1, 15));
        plans.push({ definitionCode: def.code, definitionName: def.name, periodType, ...r });
      }
    } else if (periodType === "YEAR") {
      const r = resolvePeriod("YEAR", new Date(year, 5, 15));
      plans.push({ definitionCode: def.code, definitionName: def.name, periodType, ...r });
    }
  }
  return plans;
}

async function main() {
  console.log(
    `==> 报表快照补全 year=${args.year}${args.code ? ` code=${args.code}` : ""}${args.dryRun ? " (dry-run)" : ""}`
  );

  const plans = await realBuildPlans(args.year, args.code);
  console.log(`==> 共 ${plans.length} 个 (definition, period) 组合`);

  if (args.dryRun) {
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    for (const p of plans) {
      console.log(
        `  - [${p.definitionCode}] ${p.periodType} ${p.periodLabel}  (${fmt(p.from)} ~ ${fmt(p.to)})`
      );
    }
    console.log("==> dry-run 完成, 没有写库");
    return;
  }

  // 一次性查所有 definition 缓存
  const defs = await prisma.reportDefinition.findMany({
    where: { isActive: true, deletedAt: null, periodType: { not: "CUSTOM" } },
  });
  const defByCode = new Map(defs.map((d) => [d.code, d]));

  // 一次性查已存在快照, 用于 skip
  const existing = await prisma.reportSnapshot.findMany({
    where: {
      deletedAt: null,
      definition: { code: { in: args.code ? [args.code] : undefined } },
    },
    select: { id: true, periodType: true, periodLabel: true, definition: { select: { code: true } } },
  });
  const existingSet = new Set(
    existing.map((e) => `${e.definition.code}|${e.periodType}|${e.periodLabel}`)
  );

  let created = 0;
  // updated 占位: 脚本跳过已存在快照, 不覆盖; 如需覆盖场景后续可放开
  const updated = 0; // 占位: 脚本跳过已存在快照
  let skipped = 0;
  let failed = 0;

  for (const plan of plans) {
    const defRow = defByCode.get(plan.definitionCode);
    if (!defRow) {
      console.warn(`  ! definition ${plan.definitionCode} 不存在, 跳过`);
      skipped++;
      continue;
    }
    const key = `${plan.definitionCode}|${plan.periodType}|${plan.periodLabel}`;
    if (existingSet.has(key)) {
      skipped++;
      continue;
    }
    const definition = toDefItem(defRow);
    try {
      const payload = await aggregatePayload(SYSTEM_ACTOR, definition, {
        from: plan.from,
        to: plan.to,
      });
      const hash = await computeSourceHash({ from: plan.from, to: plan.to });
      await prisma.reportSnapshot.create({
        data: {
          definitionId: defRow.id,
          periodType: plan.periodType,
          periodLabel: plan.periodLabel,
          from: plan.from,
          to: plan.to,
          status: "READY",
          payload: payload as object,
          hash,
          generatedById: SYSTEM_ACTOR.id,
          generatedAt: new Date(),
        },
      });
      created++;
      console.log(`  ✓ ${plan.definitionCode} ${plan.periodLabel}`);
    } catch (e) {
      failed++;
      console.error(
        `  ✗ ${plan.definitionCode} ${plan.periodLabel}:`,
        e instanceof Error ? e.message : e
      );
    }
  }

  console.log(
    `\n==> 完成: created=${created} updated=${updated} skipped=${skipped} failed=${failed} (共 ${plans.length})`
  );
  if (failed > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error("backfill failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
