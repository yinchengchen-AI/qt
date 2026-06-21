#!/usr/bin/env node
/**
 * 客户所在地 4 级回填 (district):
 *   老 schema 只有 province / city / town, 列表渲染只看前 2 级, 结果历史脏数据下出现
 *   "xx区xx街道". 新加 district 字段后, 此脚本按以下规则尝试恢复 district:
 *
 *   1) 数据完整: province/city/district 都在 DIVISIONS 树里能匹配 → noop
 *   2) town 在 (从 address 拆出来可能可见) 但 district 为空: 尝试用 address 字符串前缀
 *      对齐 DIVISIONS 树, 反查 district
 *   3) 拆不出: 标记 unfixable, 报告里附 province/city/town, 由人工或后续脚本处理
 *
 * 全部 idempotent, 支持 --dry-run (只看不写). 修复记录写到 ops/legacy/reports/.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DIVISIONS, ZHEJIANG_DIVISIONS, type DivisionNode } from "../../lib/china-divisions";

config();

const REPORT_DIR = path.resolve("ops/legacy/reports");
mkdirSync(REPORT_DIR, { recursive: true });

const DRY_RUN = process.argv.includes("--dry-run");

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter, log: ["error"] });

/** 在 DIVISIONS 树里按 label 路径取节点, 找不到返回 null */
function findNode(labels: string[]): DivisionNode | null {
  let current: DivisionNode[] | undefined = DIVISIONS;
  let node: DivisionNode | null = null;
  for (const label of labels) {
    if (!label) break;
    node = current?.find((n) => n.label === label) ?? null;
    if (!node) return null;
    current = node.children;
    if (!current) break;
  }
  return node;
}

// 在浙江省子树里按 label 找一个节点, 返回其祖先链 (省/市/区/街).
// 之前走全 DIVISIONS (全国 4 级) 一次 O(M), 实际本脚本只处理浙江省客户,
// 改走 ZHEJIANG_DIVISIONS 把搜索空间砍到浙江的 1 个省节点, 兜底也只搜浙江.
// 同 label 跨多客户重复查询 → memo 一次性 DFS 缓存.
const _pathCache = new Map<string, string[] | null>();
function findPathByLabel(label: string): string[] | null {
  if (!label) return null;
  const cached = _pathCache.get(label);
  if (cached !== undefined) return cached;
  const walk = (nodes: DivisionNode[], path: string[]): string[] | null => {
    for (const n of nodes) {
      if (n.label === label) return [...path, n.label];
      if (n.children) {
        const r = walk(n.children, [...path, n.label]);
        if (r) return r;
      }
    }
    return null;
  };
  const r = walk(ZHEJIANG_DIVISIONS, []);
  _pathCache.set(label, r);
  return r;
}

async function main() {
  const customers = await prisma.customer.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, province: true, city: true, district: true, town: true, address: true }
  });
  console.log(`[BACKFILL] candidates=${customers.length} dryRun=${DRY_RUN}`);

  type BackfillReport = {
    startedAt: string;
    finishedAt?: string;
    dryRun: boolean;
    totals: { noop: number; fixed: number; unfixable: number; ambiguous: number };
  };
  const report: BackfillReport = {
    startedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    totals: { noop: 0, fixed: 0, unfixable: 0, ambiguous: 0 }
  };
  const samples: { fixed: unknown[]; unfixable: unknown[] } = { fixed: [], unfixable: [] };

  for (const c of customers) {
    // 路径 1: 4 级都在 (district 已有值) -> noop
    if (c.district) {
      const ok = findNode([c.province, c.city, c.district, c.town ?? ""]);
      if (ok) {
        report.totals.noop++;
        continue;
      }
    }

    // 路径 2: 用 address 前缀反查 district
    // 旧 form 的 onChange 把 4 级 labels 拼到 address, 因此 address 形如 "<省><市><区><镇街>..."
    // 拆的办法: 从 DIVISIONS 树里找 address 字符串里"能匹配"的最长路径
    let recovered: { province: string; city: string; district: string | null; town: string | null } | null = null;
    if (c.address) {
      // 先尝试按 province 节点往下走
      const provNode = DIVISIONS.find((n) => n.label === c.province);
      if (provNode?.children) {
        // 在 province 的子节点里找 city
        const cityNode = provNode.children.find((n) => n.label === c.city);
        if (cityNode?.children) {
          // 找 district: 它要么是 cityNode 的直接子节点, 要么在 address 里
          for (const d of cityNode.children) {
            if (c.address.startsWith(`${c.province}${c.city}${d.label}`)) {
              let town: string | null = null;
              let remainingAddr = c.address.slice(`${c.province}${c.city}${d.label}`.length);
              if (d.children) {
                for (const t of d.children) {
                  if (remainingAddr.startsWith(t.label)) {
                    town = t.label;
                    remainingAddr = remainingAddr.slice(t.label.length);
                    break;
                  }
                }
              }
              recovered = {
                province: c.province,
                city: c.city,
                district: d.label,
                town
              };
              // address 还原为剩余部分 (门牌号等用户后填内容)
              if (!DRY_RUN) {
                await prisma.customer.update({
                  where: { id: c.id },
                  data: {
                    district: d.label,
                    town: town,
                    address: remainingAddr || null
                  }
                });
              }
              report.totals.fixed++;
              (samples.fixed as unknown[]).push({ id: c.id, name: c.name, before: c, after: { ...recovered, address: remainingAddr || null } });
              break;
            }
          }
        }
      }
    }

    if (recovered) continue;

    // 路径 3: 整树按 province label 找路径 (兜底, 旧数据 province 实际是区名的情况)
    const alt = findPathByLabel(c.province);
    if (alt && alt.length >= 3) {
      // alt 形如 ["浙江省", "杭州市", "西湖区"]; town 也许还在老 town 字段里
      const newProvince = alt[0]!;
      const newCity = alt[1]!;
      const newDistrict = alt[2]!;
      report.totals.ambiguous++;
      if (!DRY_RUN) {
        await prisma.customer.update({
          where: { id: c.id },
          data: { province: newProvince, city: newCity, district: newDistrict }
        });
      }
      (samples.fixed as unknown[]).push({ id: c.id, name: c.name, ambiguous: { from: c.province, to: { newProvince, newCity, newDistrict } } });
      continue;
    }

    report.totals.unfixable++;
    (samples.unfixable as unknown[]).push({ id: c.id, name: c.name, data: c });
  }

  report.finishedAt = new Date().toISOString();
  const reportFile = path.join(
    REPORT_DIR,
    `customer-district-backfill_${new Date().toISOString().replace(/[:.]/g, "-")}${DRY_RUN ? ".dryrun" : ""}.json`
  );
  const out = { ...report, samples } as unknown as object;
  writeFileSync(reportFile, JSON.stringify(out, null, 2));
  console.log(`[BACKFILL] done: noop=${report.totals.noop} fixed=${report.totals.fixed} ambiguous=${report.totals.ambiguous} unfixable=${report.totals.unfixable}`);
  console.log(`[BACKFILL] report: ${reportFile}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("[BACKFILL] failed:", e);
  await prisma.$disconnect();
  process.exit(1);
});
