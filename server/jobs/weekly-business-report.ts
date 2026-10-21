// 经营周报定时推送 (功能 C)
//
// 职责: 每周一 09:00 给 ADMIN ∪ FINANCE 发站内信, 内容为上周 (ISO 周, 周一~周日) 的
//   业绩总览 (getOverview) + 账龄摘要 (getInvoiceAging) + 业绩排行 Top (getPerformanceRanking),
//   附 xlsx 明细附件 (MinIO + Attachment, 下载链接写进消息 content)。
//
// 幂等: entityKey = BUSINESS_WEEKLY_REPORT:{isoWeekKey(上周一)} → (entityKey, receiverUserId)
//   唯一约束 + createMany(skipDuplicates) 兜底; job 内部先 findFirst 判重, 已发直接跳过,
//   重跑 / hourly run-all 兜底都不会重复发。
//
// 执行时机: 非周一直接跳过 (created=0); 手动补跑传 { force: true } 跳过星期判断
//   (admin 手动触发 / curl ?force=1), entityKey 仍保证一周只发一次。
//
// 降级: xlsx 生成或 MinIO 上传失败只 console.warn, 站内信降级为纯文本摘要, 不阻断。
import { PutObjectCommand } from "@aws-sdk/client-s3";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { isMinioEnabled } from "@/lib/env";
import type { SessionUser } from "@/lib/session";
import type { DateRange } from "@/lib/date-range";
import { SYSTEM_USER_ID } from "@/lib/system";
import { emit } from "@/server/events/bus";
import { ensureBucketAndCors, getBucket, getS3Client } from "@/server/storage/minio";
import {
  getInvoiceAging,
  getOverview,
  getPerformanceRanking,
  type AgingResult,
  type PerformanceRankingRow
} from "@/server/services/statistics";
import { isoWeekKey } from "./contract-renewal-remind";
import type { JobResult } from "./runner";

const DAY_MS = 86_400_000;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** 本周一 00:00 (本地时区, ISO 周从周一开始; 与 contract-renewal-remind 同口径) */
function weekStart(d: Date): Date {
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  const day = t.getDay() || 7;
  t.setDate(t.getDate() - day + 1);
  return t;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** 伪 ADMIN 会话: 统计服务需要 SessionUser 做权限校验; ADMIN 不受行级隔离, 看全量 */
function systemSessionUser(): SessionUser {
  return {
    id: SYSTEM_USER_ID,
    employeeNo: "system",
    name: "系统",
    email: "",
    roleCode: "ADMIN",
    permissions: []
  };
}

type OverviewData = Awaited<ReturnType<typeof getOverview>>;

export type WeeklyReportData = {
  weekKey: string;
  range: DateRange;
  overview: OverviewData;
  aging: AgingResult;
  ranking: PerformanceRankingRow[];
};

/**
 * 生成周报 xlsx (三个 sheet: 业绩总览 / 账龄摘要 / 业绩排行)。
 * 独立导出便于单测用 exceljs 读回校验, 不依赖 MinIO。
 */
export async function buildWeeklyReportXlsx(data: WeeklyReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  // ==== Sheet 1: 业绩总览 ====
  const ws1 = wb.addWorksheet("业绩总览");
  ws1.columns = [
    { header: "指标", key: "metric", width: 20 },
    { header: "数值", key: "value", width: 24 }
  ];
  ws1.getRow(1).font = { bold: true };
  const o = data.overview;
  const overviewRows: Array<[string, string | number]> = [
    ["统计区间", `${isoDate(data.range.from!)} ~ ${isoDate(data.range.to!)}`],
    ["新签合同数", o.contractCount],
    ["新签合同额", o.contractAmount],
    ["已开票金额", o.invoiceAmount],
    ["开票张数", o.invoiceCount],
    ["已回款金额", o.paymentAmount],
    ["回款笔数", o.paymentCount],
    ["未回款金额", o.unpaidAmount],
    ["开票率(%)", o.invoiceRate],
    ["回款率(%)", o.paymentRate]
  ];
  for (const [metric, value] of overviewRows) ws1.addRow({ metric, value });

  // ==== Sheet 2: 账龄摘要 ====
  const ws2 = wb.addWorksheet("账龄摘要");
  ws2.columns = [
    { header: "账龄段", key: "bucket", width: 16 },
    { header: "剩余未收金额", key: "amount", width: 20 }
  ];
  ws2.getRow(1).font = { bold: true };
  ws2.getColumn(2).numFmt = "#,##0.00";
  const b = data.aging.buckets;
  ws2.addRow({ bucket: "0-30 天", amount: b["0-30"] });
  ws2.addRow({ bucket: "31-60 天", amount: b["31-60"] });
  ws2.addRow({ bucket: "61-90 天", amount: b["61-90"] });
  ws2.addRow({ bucket: "90+ 天", amount: b["90+"] });
  ws2.addRow({ bucket: "合计应收", amount: data.aging.summary.totalReceivable });
  ws2.addRow({ bucket: "90+ 占比(%)", amount: data.aging.summary.over90Ratio });

  // ==== Sheet 3: 业绩排行 (负责人维度) ====
  const ws3 = wb.addWorksheet("业绩排行");
  ws3.columns = [
    { header: "名次", key: "rank", width: 8 },
    { header: "姓名", key: "name", width: 20 },
    { header: "工号", key: "employeeNo", width: 14 },
    { header: "合同数", key: "contractCount", width: 10 },
    { header: "合同额", key: "contractAmount", width: 18 },
    { header: "已开票额", key: "invoiceAmount", width: 18 },
    { header: "已回款额", key: "paymentAmount", width: 18 },
    { header: "未回款额", key: "unpaidAmount", width: 18 }
  ];
  ws3.getRow(1).font = { bold: true };
  for (const k of [5, 6, 7, 8]) ws3.getColumn(k).numFmt = "#,##0.00";
  for (const r of data.ranking) {
    ws3.addRow({
      rank: r.rank,
      name: r.name,
      employeeNo: r.employeeNo ?? "",
      contractCount: r.contractCount,
      contractAmount: r.contractAmount,
      invoiceAmount: r.invoiceAmount,
      paymentAmount: r.paymentAmount,
      unpaidAmount: r.unpaidAmount
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/**
 * 生成 xlsx 并上传 MinIO + 建 Attachment 记录, 返回站内下载路径 (/api/files/raw/<id>)。
 * 任何一步失败抛给调用方降级 (站内信降级为纯文本)。
 */
async function uploadReportAttachment(data: WeeklyReportData, now: Date): Promise<string> {
  const buf = await buildWeeklyReportXlsx(data);
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const originalName = `经营周报_${data.weekKey}.xlsx`;
  // 与 presign 同模式: 先建记录拿 cuid, 再回填 objectKey, 最后传 MinIO
  const att = await prisma.attachment.create({
    data: {
      objectKey: "placeholder",
      bucket: getBucket(),
      originalName,
      mimeType: XLSX_MIME,
      size: buf.length,
      uploadedById: SYSTEM_USER_ID
    },
    select: { id: true }
  });
  const objectKey = `reports/${yyyy}/${mm}/${att.id}-weekly-business-report.xlsx`;
  await prisma.attachment.update({ where: { id: att.id }, data: { objectKey } });

  await ensureBucketAndCors();
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: objectKey,
      Body: buf,
      ContentType: XLSX_MIME,
      ContentLength: buf.length
    })
  );
  // canReadAttachment: ADMIN / FINANCE 角色对非档案附件无条件放行, 与接收人范围一致
  return `/api/files/raw/${att.id}`;
}

export async function runWeeklyBusinessReport(
  now = new Date(),
  opts: { force?: boolean } = {}
): Promise<JobResult> {
  const t0 = Date.now();
  const job = "weekly-business-report";

  // 只在周一执行 (cron 周一 09:00 准点 + hourly run-all 兜底); 手动补跑用 force 跳过
  if (!opts.force && now.getDay() !== 1) {
    return { job, created: 0, scanned: 0, durationMs: Date.now() - t0 };
  }

  // 上周区间: 上周一 00:00 ~ 本周一 00:00 - 1ms (本地时区, ISO 周口径)
  const thisMonday = weekStart(now);
  const lastWeekFrom = new Date(thisMonday.getTime() - 7 * DAY_MS);
  const lastWeekTo = new Date(thisMonday.getTime() - 1);
  const range: DateRange = { from: lastWeekFrom, to: lastWeekTo };
  const weekKey = isoWeekKey(lastWeekFrom);
  const entityKey = `BUSINESS_WEEKLY_REPORT:${weekKey}`;

  // 周幂等: 本周已发过直接跳过 (entityKey 唯一约束 + skipDuplicates 是第二道兜底)
  const existing = await prisma.message.findFirst({
    where: { type: "BUSINESS_WEEKLY_REPORT", entityKey },
    select: { id: true }
  });
  if (existing) {
    return { job, created: 0, scanned: 0, durationMs: Date.now() - t0 };
  }

  const user = systemSessionUser();
  const [overview, aging, ranking] = await Promise.all([
    getOverview(user, range),
    getInvoiceAging(user, { basis: "due", pageSize: 200, sort: "daysOverdue:desc" }),
    getPerformanceRanking(user, "owner", range, 10)
  ]);

  // 报表附件: 失败 (含 MinIO 未配置) 降级为纯文本摘要, 不阻断站内信
  let downloadUrl: string | null = null;
  if (isMinioEnabled()) {
    try {
      downloadUrl = await uploadReportAttachment({ weekKey, range, overview, aging, ranking }, now);
    } catch (e) {
      console.warn("[weekly-business-report] xlsx 附件生成/上传失败, 降级为纯文本:", (e as Error).message);
    }
  }

  // 接收人: ADMIN ∪ FINANCE 真人用户 (排除禁用/软删/系统占位)
  const roleWhere = (code: "ADMIN" | "FINANCE") => ({
    role: { code },
    deletedAt: null,
    status: "ACTIVE" as const,
    isSystem: false
  });
  const [admins, finances] = await Promise.all([
    prisma.user.findMany({ where: roleWhere("ADMIN"), select: { id: true } }),
    prisma.user.findMany({ where: roleWhere("FINANCE"), select: { id: true } })
  ]);
  const receivers = Array.from(new Set([...admins.map((u) => u.id), ...finances.map((u) => u.id)]));
  const scanned = receivers.length;
  if (receivers.length === 0) {
    return { job, created: 0, scanned, durationMs: Date.now() - t0 };
  }

  const topRanking = ranking.slice(0, 5).map((r) => ({
    rank: r.rank,
    name: r.name,
    contractAmount: r.contractAmount
  }));

  // 退订用户 (MessagePreference enabled=false) 由 bus.emit 内部 getDisabledMap 自动过滤
  const created = await emit(prisma, {
    type: "BUSINESS_WEEKLY_REPORT",
    payload: {
      weekKey,
      rangeFrom: isoDate(lastWeekFrom),
      rangeTo: isoDate(lastWeekTo),
      contractCount: overview.contractCount,
      contractAmount: overview.contractAmount,
      invoiceAmount: overview.invoiceAmount,
      invoiceCount: overview.invoiceCount,
      paymentAmount: overview.paymentAmount,
      unpaidAmount: overview.unpaidAmount,
      aging0_30: aging.buckets["0-30"],
      aging31_60: aging.buckets["31-60"],
      aging61_90: aging.buckets["61-90"],
      aging90: aging.buckets["90+"],
      over90Ratio: aging.summary.over90Ratio,
      topRanking,
      downloadUrl
    },
    entityKey,
    receivers
  });

  return { job, created, scanned, durationMs: Date.now() - t0 };
}
