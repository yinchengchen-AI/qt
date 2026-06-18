#!/usr/bin/env node
/**
 * 老 FineUI 系统 → qt-biz 的合同附件迁移
 *
 * 把 /tmp/legacy-upload/<filename> 上传到 MinIO, 在 Attachment 表插真实记录,
 * 把 Contract.attachments JSON 里的 legacy-xxx 替换成新 cuid.
 * 跑完这些附件走新系统 presign-download 流程, 能下载/预览.
 *
 * 幂等: 同一合同跑第二次, attachments 已无 legacy- 前缀则跳过
 * 容错: 文件缺失 / S3 失败 / DB 失败 -> 写 /tmp/legacy-migrate-errors.log 继续
 *
 * 用法:
 *   node scripts/migrate/legacy-attachments.mjs --dry-run
 *   node scripts/migrate/legacy-attachments.mjs            # 真跑
 *   node scripts/migrate/legacy-attachments.mjs --limit=10  # 只跑前 10 个
 *   node scripts/migrate/legacy-attachments.mjs --contract=<id>  # 单个合同
 *
 * 环境变量 (从 .env 读):
 *   LEGACY_UPLOAD_DIR  默认 /tmp/legacy-upload
 *   MINIO_*             走 server/storage/minio.ts 的同样配置
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const UPLOAD_DIR = process.env.LEGACY_UPLOAD_DIR || "/tmp/legacy-upload";
const BUCKET = process.env.MINIO_BUCKET || "qt-biz-attachments";
const ERR_LOG = "/tmp/legacy-migrate-errors.log";
const dryRun = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const contractArg = process.argv.find((a) => a.startsWith("--contract="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : Infinity;
const ONLY_CONTRACT = contractArg ? contractArg.split("=")[1] : null;

// legacy 数据的 mimeType 全是 application/octet-stream, 不可信; 按扩展名重判
const EXT_MIME = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".zip": "application/zip"
};
const mimeOf = (name) => EXT_MIME[path.extname(name).toLowerCase()] || "application/octet-stream";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL 未设置 (需要 .env)");
  process.exit(1);
}
if (!process.env.MINIO_ENDPOINT || !process.env.MINIO_ACCESS_KEY) {
  console.error("MinIO 配置缺失 (MINIO_ENDPOINT / MINIO_ACCESS_KEY / MINIO_SECRET_KEY / MINIO_PORT)");
  process.exit(1);
}
if (!existsSync(UPLOAD_DIR)) {
  console.error(`源目录不存在: ${UPLOAD_DIR}`);
  console.error("先 rsync / scp 把 /upload 拉过来, 或设 LEGACY_UPLOAD_DIR=其它路径");
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL),
  log: ["error"]
});
const s3 = new S3Client({
  endpoint: `${process.env.MINIO_USE_SSL === "true" ? "https" : "http"}://${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT}`,
  region: "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY,
    secretAccessKey: process.env.MINIO_SECRET_KEY
  }
});

const log = (...a) => console.log(...a);
const stats = { contracts: 0, legacy: 0, migrated: 0, noFile: 0, failed: 0, alreadyDone: 0 };

// === 1) 找有 legacy 附件的合同 ===
log(`[scan] 源目录: ${UPLOAD_DIR}, bucket: ${BUCKET}, dryRun: ${dryRun}`);
const t0 = Date.now();
const contracts = ONLY_CONTRACT
  ? await prisma.$queryRaw`
      SELECT id, attachments, "ownerUserId"
      FROM "Contract"
      WHERE "deletedAt" IS NULL
        AND id = ${ONLY_CONTRACT}
        AND jsonb_array_length(attachments) > 0
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(attachments) elem
          WHERE elem->>'id' LIKE 'legacy-%'
        )
      ORDER BY "createdAt" ASC
    `
  : await prisma.$queryRaw`
      SELECT id, attachments, "ownerUserId"
      FROM "Contract"
      WHERE "deletedAt" IS NULL
        AND jsonb_array_length(attachments) > 0
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(attachments) elem
          WHERE elem->>'id' LIKE 'legacy-%'
        )
      ORDER BY "createdAt" ASC
    `;
log(`[scan] 找到 ${contracts.length} 个含 legacy 附件的合同, 耗时 ${Date.now() - t0}ms`);

if (contracts.length === 0) {
  log("[done] 无 legacy 附件, 退出");
  await prisma.$disconnect();
  process.exit(0);
}

await writeFile(ERR_LOG, "", "utf-8"); // 清空错误日志

// === 2) 逐合同处理 ===
let processed = 0;
for (const c of contracts) {
  if (processed >= LIMIT) {
    log(`[limit] 达到 --limit=${LIMIT}, 停止`);
    break;
  }
  processed++;
  stats.contracts++;
  const atts = Array.isArray(c.attachments) ? c.attachments : [];
  const newAtts = [];
  let changed = false;

  for (const a of atts) {
    if (!a || !a.id || !a.id.startsWith("legacy-")) {
      newAtts.push(a);
      continue;
    }
    stats.legacy++;
    const name = a.name;
    const filePath = path.join(UPLOAD_DIR, name);

    if (!existsSync(filePath)) {
      stats.noFile++;
      await appendFile(ERR_LOG, `NO_FILE\t${c.id}\t${name}\n`);
      newAtts.push(a); // 保留 legacy, 等补文件后重跑
      continue;
    }

    try {
      const buffer = await readFile(filePath);
      const objectKey = `legacy/${c.id}/${name}`;
      const mime = mimeOf(name);

      if (!dryRun) {
        // 幂等检查: 同一个 objectKey 已存在就跳过 S3
        let exists = false;
        try {
          await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: objectKey }));
          exists = true;
        } catch (e) {
          if (e?.$metadata?.httpStatusCode !== 404 && e?.name !== "NotFound") {
            throw e; // 其它错误(网络/权限)往上抛
          }
        }
        if (!exists) {
          await s3.send(new PutObjectCommand({
            Bucket: BUCKET,
            Key: objectKey,
            Body: buffer,
            ContentType: mime,
            ContentLength: buffer.length
          }));
        }
        // 找已绑这个 objectKey 的 Attachment (避免重跑时重复插)
        const existing = await prisma.attachment.findUnique({ where: { objectKey } });
        let att;
        if (existing) {
          att = existing;
          // 修正可能缺失的 contractId 绑定
          if (!att.contractId || att.contractId !== c.id) {
            await prisma.attachment.update({
              where: { id: att.id },
              data: { contractId: c.id }
            });
            att = { ...att, contractId: c.id };
          }
        } else {
          att = await prisma.attachment.create({
            data: {
              objectKey,
              bucket: BUCKET,
              originalName: name,
              mimeType: mime,
              size: buffer.length,
              uploadedById: c.ownerUserId,
              contractId: c.id
            }
          });
        }
        newAtts.push({
          id: att.id,
          name: att.originalName,
          mimeType: att.mimeType,
          size: att.size,
          uploadedBy: att.uploadedById,
          uploadedAt: att.uploadedAt.toISOString()
        });
        changed = true;
        stats.migrated++;
      } else {
        log(`  [dry] ${c.id} -> ${objectKey} (${buffer.length}B, ${mime})`);
        stats.migrated++;
      }
    } catch (e) {
      stats.failed++;
      const msg = e?.message || String(e);
      await appendFile(ERR_LOG, `FAILED\t${c.id}\t${name}\t${msg}\n`);
      log(`  X ${c.id}/${name}: ${msg.slice(0, 200)}`);
      newAtts.push(a); // 失败保留 legacy
    }
  }

  if (changed && !dryRun) {
    await prisma.contract.update({
      where: { id: c.id },
      data: { attachments: newAtts }
    });
  }

  if (processed % 25 === 0 || processed === contracts.length) {
    log(`[progress] ${processed}/${contracts.length} contracts | migrated=${stats.migrated} noFile=${stats.noFile} failed=${stats.failed}`);
  }
}

// === 3) 收尾 ===
log(`\n[done] 总计`);
log(`  合同:      ${stats.contracts}`);
log(`  legacy:    ${stats.legacy}`);
log(`  迁移成功:  ${stats.migrated}`);
log(`  缺文件:    ${stats.noFile}  (详情: ${ERR_LOG})`);
log(`  失败:      ${stats.failed}  (详情: ${ERR_LOG})`);
if (stats.noFile + stats.failed > 0) {
  log(`\n  提示: 缺文件 / 失败的项保留 legacy 标记, 修好后重跑本脚本即可 (幂等)`);
}
log(`\n验证 SQL:`);
log(`  SELECT count(*) FROM "Contract" WHERE attachments::text LIKE '%legacy-%';  -- 期望 0 (或只剩缺文件/失败的合同)`);

await prisma.$disconnect();
process.exit(stats.failed > 0 ? 1 : 0);
