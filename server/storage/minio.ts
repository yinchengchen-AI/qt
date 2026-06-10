// MinIO / S3-compatible 客户端单例
// - 通过 @aws-sdk/client-s3 v3 与 MinIO 通信(forcePathStyle: true)
// - 启动时 ensureBucket(不存在则创建),并按需同步 CORS
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  type CORSRule
} from "@aws-sdk/client-s3";
// 注意:MinIO RELEASE.2025-09-07+ 把 S3 PutBucketCors API 标为 NotImplemented (501)。
// 但 MinIO 2025+ 默认开启 CORS(响应 Access-Control-Allow-Origin 反射 Origin),
// 浏览器预检/上传/下载都正常,所以下面这行只是 best-effort 兜底,失败就 log。
import { env, isMinioEnabled } from "@/lib/env";

// 单例(避免每次请求都新建 client)
let _client: S3Client | null = null;
let _bucketEnsured: string | null = null;
let _corsEnsured: string | null = null;

export function getS3Client(): S3Client {
  if (_client) return _client;
  if (!isMinioEnabled()) {
    throw new Error("MinIO 未配置:请在 .env 设置 MINIO_ENDPOINT/PORT/ACCESS_KEY/SECRET_KEY/BUCKET");
  }
  _client = new S3Client({
    endpoint: `${env.MINIO_USE_SSL ? "https" : "http"}://${env.MINIO_ENDPOINT}:${env.MINIO_PORT}`,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.MINIO_ACCESS_KEY!,
      secretAccessKey: env.MINIO_SECRET_KEY!
    }
  });
  return _client;
}

export function getBucket(): string {
  if (!env.MINIO_BUCKET) throw new Error("MINIO_BUCKET 未配置");
  return env.MINIO_BUCKET;
}

// 启动时调用一次:确保桶存在 + CORS 正确
// 幂等;失败仅 log,不阻断应用启动
export async function ensureBucketAndCors(): Promise<void> {
  if (!isMinioEnabled()) return;
  const bucket = getBucket();
  if (_bucketEnsured === bucket) return;
  const client = getS3Client();
  // 1) 确保桶存在
  try {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    }
    _bucketEnsured = bucket;
  } catch (e) {
    console.warn("[minio] ensureBucket 失败(下次请求会重试):", (e as Error).message);
  }
  // 2) 尝试同步 CORS(best-effort;MinIO 2025+ 默认就支持,失败仅 log 不阻断)
  try {
    const rules: CORSRule[] = [
      {
        AllowedHeaders: ["*"],
        AllowedMethods: ["GET", "PUT"],
        AllowedOrigins: buildAllowedOrigins(),
        ExposeHeaders: ["ETag"],
        MaxAgeSeconds: 3000
      }
    ];
    await client.send(
      new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: rules } })
    );
  } catch (e) {
    console.warn(
      "[minio] PutBucketCors 失败(可忽略,MinIO 2025+ 默认 CORS):",
      (e as Error).message
    );
  }
}

function buildAllowedOrigins(): string[] {
  const origins = new Set<string>();
  for (const u of [env.NEXTAUTH_URL, env.APP_PUBLIC_URL, env.MINIO_PUBLIC_BASE_URL]) {
    if (!u) continue;
    try {
      origins.add(new URL(u).origin);
    } catch {
      // ignore
    }
  }
  origins.add("http://localhost:3000");
  origins.add("http://127.0.0.1:3000");
  return [...origins];
}

// =====================================================
// 业务规则:MIME 白名单 + 大小限制
// =====================================================
export const ALLOWED_MIME_TYPES = new Set<string>([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/png",
  "image/webp"
]);

export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

export function isAllowedMimeType(mime: string): boolean {
  return ALLOWED_MIME_TYPES.has(mime);
}

// 原始文件名转安全后缀(用于 objectKey 命名)
export function slugFilename(name: string): string {
  const lastDot = name.lastIndexOf(".");
  const base = lastDot > 0 ? name.slice(0, lastDot) : name;
  const ext = lastDot > 0 ? name.slice(lastDot + 1) : "";
  const safeBase =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "file";
  const safeExt = ext.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  return safeExt ? `${safeBase}.${safeExt}` : safeBase;
}

const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};
export function extFromMime(mime: string): string {
  return MIME_TO_EXT[mime] ?? "bin";
}
