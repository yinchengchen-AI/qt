// server/storage 单元测试 - 纯函数 + 边界条件
// 不接真 MinIO,Mock 掉 S3Client/Prisma
import { describe, it, expect } from "vitest";

// 这些是纯函数,直接从模块导入
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  isAllowedMimeType,
  extFromMime,
  slugFilename
} from "../server/storage/minio";

describe("isAllowedMimeType", () => {
  it("accepts whitelisted MIME types", () => {
    // 当前 14 种;新增时同步更新下方 size 断言
    const ok = [
      // 文档
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // 图片
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/bmp",
      "image/tiff",
      // 文本
      "text/plain",
      "text/csv",
      // 压缩包
      "application/zip"
    ];
    for (const m of ok) {
      expect(isAllowedMimeType(m), `should accept ${m}`).toBe(true);
    }
  });

  it("rejects non-whitelisted MIME types", () => {
    // svg / html / js 等可内嵌脚本的类型(等同任意 XSS)永远不放行
    const bad = [
      "text/html",
      "image/svg+xml",
      "application/javascript",
      "text/markdown", // 当前没放进白名单
      "application/x-msdownload",
      "video/mp4",
      "audio/mpeg",
      ""
    ];
    for (const m of bad) {
      expect(isAllowedMimeType(m), `should reject ${m}`).toBe(false);
    }
  });
});

describe("extFromMime", () => {
  it("maps known MIMEs to extensions", () => {
    expect(extFromMime("application/pdf")).toBe("pdf");
    expect(extFromMime("application/msword")).toBe("doc");
    expect(extFromMime("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("docx");
    expect(extFromMime("application/vnd.ms-excel")).toBe("xls");
    expect(extFromMime("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("xlsx");
    expect(extFromMime("image/jpeg")).toBe("jpg");
    expect(extFromMime("image/png")).toBe("png");
    expect(extFromMime("image/webp")).toBe("webp");
    expect(extFromMime("image/gif")).toBe("gif");
    expect(extFromMime("image/bmp")).toBe("bmp");
    expect(extFromMime("image/tiff")).toBe("tiff");
    expect(extFromMime("text/plain")).toBe("txt");
    expect(extFromMime("text/csv")).toBe("csv");
    expect(extFromMime("application/zip")).toBe("zip");
  });
  it("falls back to 'bin' for unknown", () => {
    expect(extFromMime("application/octet-stream")).toBe("bin");
    expect(extFromMime("garbage")).toBe("bin");
  });
});

describe("slugFilename", () => {
  it("lowercases and strips non-alnum except hyphens", () => {
    expect(slugFilename("My Contract 2026 (FINAL).PDF")).toBe("my-contract-2026-final.pdf");
  });
  it("collapses runs of non-alnum into single hyphen, trims edges", () => {
    expect(slugFilename("___hello world___.docx")).toBe("hello-world.docx");
  });
  it("handles no extension", () => {
    expect(slugFilename("README")).toBe("readme");
  });
  it("handles hidden/dotfiles", () => {
    // .gitignore -> base='', ext='gitignore' -> safeBase=file, safeExt=gitignore
    expect(slugFilename(".gitignore")).toBe("gitignore");
  });
  it("truncates very long base to 64 chars", () => {
    const long = "a".repeat(200) + ".pdf";
    const out = slugFilename(long);
    // base part <= 64 chars
    const base = out.split(".")[0] ?? "";
    expect(base.length).toBeLessThanOrEqual(64);
    expect(out.endsWith(".pdf")).toBe(true);
  });
  it("returns 'file' for empty/all-punctuation", () => {
    expect(slugFilename("")).toBe("file");
    expect(slugFilename("!!!")).toBe("file");
  });
});

describe("Constants", () => {
  it("MAX_FILE_SIZE is 20MB", () => {
    expect(MAX_FILE_SIZE).toBe(20 * 1024 * 1024);
  });
  it("ALLOWED_MIME_TYPES is a Set", () => {
    expect(ALLOWED_MIME_TYPES).toBeInstanceOf(Set);
    expect(ALLOWED_MIME_TYPES.size).toBe(14);
  });
});
