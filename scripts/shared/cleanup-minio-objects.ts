// 清空 MinIO bucket 里的所有对象（仅清理业务附件文件）
// 用法：
//   npx tsx scripts/shared/cleanup-minio-objects.ts         执行删除
//   npx tsx scripts/shared/cleanup-minio-objects.ts --dry-run  仅统计
import "dotenv/config";
import {
  ListObjectsV2Command,
  DeleteObjectsCommand
} from "@aws-sdk/client-s3";
import { getS3Client, getBucket } from "@/server/storage/minio";
import { isMinioEnabled } from "@/lib/env";

const dryRun = process.argv.includes("--dry-run");

async function listAllKeys(): Promise<string[]> {
  const client = getS3Client();
  const bucket = getBucket();
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken
      })
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);

  return keys;
}

async function deleteKeys(keys: string[]): Promise<void> {
  const client = getS3Client();
  const bucket = getBucket();
  const batchSize = 1000; // S3 DeleteObjects 单次上限
  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);
    const res = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: batch.map((Key) => ({ Key })),
          Quiet: true
        }
      })
    );
    if (res.Errors && res.Errors.length > 0) {
      throw new Error(
        `MinIO 批量删除出错: ${res.Errors.map((e) => `${e.Key}: ${e.Code}`).join(", ")}`
      );
    }
  }
}

async function main() {
  if (!isMinioEnabled()) {
    console.log("MinIO 未配置，无需清理。");
    return;
  }

  console.log("正在列出 MinIO 对象...");
  const keys = await listAllKeys();
  console.log(`共发现 ${keys.length} 个对象。`);

  if (keys.length === 0) {
    console.log("Bucket 为空，无需清理。");
    return;
  }

  if (dryRun) {
    console.log("\n【预览模式】将删除以下对象（前 20 个）：");
    for (const key of keys.slice(0, 20)) {
      console.log(`  ${key}`);
    }
    if (keys.length > 20) {
      console.log(`  ... 还有 ${keys.length - 20} 个`);
    }
    console.log("\n预览结束，未执行删除。去掉 --dry-run 后正式执行。");
    return;
  }

  const answer = await ask(`\n确认删除 MinIO 中 ${keys.length} 个对象？输入 yes 继续: `);
  if (answer.trim().toLowerCase() !== "yes") {
    console.log("已取消。");
    return;
  }

  await deleteKeys(keys);
  console.log(`\n已删除 ${keys.length} 个 MinIO 对象。`);
}

function ask(question: string): Promise<string> {
  const { stdin, stdout } = process;
  stdout.write(question);
  return new Promise((resolve) => {
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.once("data", (data) => {
      stdin.pause();
      resolve(String(data));
    });
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
