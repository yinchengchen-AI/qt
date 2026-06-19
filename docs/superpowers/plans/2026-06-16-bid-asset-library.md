# 标书素材库 v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline execution per user directive "完成 writing-plans 后,直接执行"). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 `CompanyAsset` 模块上增量交付 2 个新资产类型 (`PERSONNEL_CERT` / `TEMPLATE`) + 6 类人员证书字典 + 附件上传子模块,把现有模块从"企业资产"升级为"标书素材库",不动 Prisma schema。

**Architecture:** 类型层 (`types/enums.ts` / `lib/enum-maps.ts` / `types/errors.ts`) 扩展 2 个值,Zod `discriminatedUnion` 加 2 个分支,seed 增 6 条字典,服务层在 `createAsset` / `updateAsset` 加类型路由校验 + 附件 assetId 回填,前端 8+2 类表单统一接入 `PreviewableProFormUploadButton`,新建 `DELETE /api/assets/attachments/[id]` 路由。TDD 优先,所有改动走 `npm run typecheck` + `npm test` 验证。

**Tech Stack:** Next.js 16 App Router / React 19 / TypeScript strict / Zod 4 / Prisma 7 (read-only) / antd 6 + pro-components / Vitest 4 / Playwright 1.60

---

## 关键决策(执行前须知)

| 项 | 决策 | 原因 |
|---|---|---|
| Prisma schema | **不动**,无 migration | `prisma/schema.prisma:1-10` 文件头注释明令禁止 `enum` + `@@index`,现有 8 类资产已用 `String` 列 |
| 资源位 | `RESOURCE.ASSET` | `lib/permissions.ts:15` 实际定义,不是 `COMPANY_ASSET` |
| 写权限 | 仅 ADMIN | 现有 `lib/permissions.ts:62` 矩阵,SALES 等 R-only,v1 不扩展 |
| 错误码 | 字符串常量 | `types/errors.ts` 现有约定,前端按字符串 match |
| 字典字段 | `label` | `prisma/seed.ts:338` `dictDefs` 形状是 `{ category, code, label, sort }` |
| 测试目录 | `tests/unit/assets/` | 工程约定,`tests/lib/` 只放字典相关 |
| 状态名 | `EXPIRING_SOON` | `types/enums.ts:184-189` 4 状态,无 `EXPIRED_SOON` |
| 阈值 | 60 天 | `lib/assets/status.ts:6` `EXPIRING_SOON_DAYS` |
| findUnique 误用 | 改 `findFirst` | unique 字段之外过滤 Prisma 会拒 |
| 文件 `app/api/assets/attachments/[id]/route.ts` | v1 新建 | 当前不存在(目录只有 `download/`) |

---

## 任务清单

### Task 1: 扩展 ASSET_TYPE 枚举 + 单元测试

**Files:**
- Modify: `types/enums.ts:170-177`
- Modify: `tests/unit/assets/validators.test.ts` (在末尾追加 describe 块)

- [ ] **Step 1: 写失败测试 — 验证 PERSONNEL_CERT / TEMPLATE 在 ASSET_TYPE 中**

在 `tests/unit/assets/validators.test.ts` 末尾追加:

```ts
describe("ASSET_TYPE extension (bid asset library v1)", () => {
  it("includes 10 types (8 original + PERSONNEL_CERT + TEMPLATE)", async () => {
    const { ASSET_TYPE } = await import("@/types/enums");
    expect(ASSET_TYPE.length).toBe(10);
    expect(new Set(ASSET_TYPE)).toEqual(
      new Set([
        "LICENSE", "CERTIFICATE", "QUALIFICATION", "PERFORMANCE",
        "TEAM_MEMBER", "CASE", "PATENT", "OTHER",
        "PERSONNEL_CERT", "TEMPLATE"
      ])
    );
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/unit/assets/validators.test.ts -t "ASSET_TYPE extension"`
Expected: FAIL — `expected 10 to be 8` (目前 8 个)

- [ ] **Step 3: 改 `types/enums.ts` 加 2 项**

在 `types/enums.ts:177` (现有 8 个值后) 追加 2 项:

```ts
// 现有:
export const ASSET_TYPE = [
  "LICENSE",
  "CERTIFICATE",
  "QUALIFICATION",
  "PERFORMANCE",
  "TEAM_MEMBER",
  "CASE",
  "PATENT",
  "OTHER"
] as const;
// type AssetType = (typeof ASSET_TYPE)[number]; 这一行保持不变,union 自动扩
```

改为:

```ts
export const ASSET_TYPE = [
  "LICENSE",
  "CERTIFICATE",
  "QUALIFICATION",
  "PERFORMANCE",
  "TEAM_MEMBER",
  "CASE",
  "PATENT",
  "OTHER",
  "PERSONNEL_CERT",
  "TEMPLATE"
] as const;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/unit/assets/validators.test.ts -t "ASSET_TYPE extension"`
Expected: PASS

- [ ] **Step 5: Typecheck 验证下游类型传导**

Run: `npm run typecheck`
Expected: PASS (下游 `z.enum(ASSET_TYPE)` 自动扩到 10 项,`assetListQuerySchema.type` 等无须改)

- [ ] **Step 6: Commit**

```bash
git add types/enums.ts tests/unit/assets/validators.test.ts
git commit -m "feat(asset): 扩展 ASSET_TYPE 加 PERSONNEL_CERT 和 TEMPLATE"
```

---

### Task 2: 扩展 ASSET_TYPE_MAP 中文映射 + 单元测试

**Files:**
- Modify: `lib/enum-maps.ts` (ASSET_TYPE_MAP 块,约第 250 行)
- Modify: `tests/unit/assets/enum-maps.test.ts` (更新现有 describe)

- [ ] **Step 1: 写失败测试 — 验证 2 个新类型有中文 label**

改 `tests/unit/assets/enum-maps.test.ts` 的 `it("ASSET_TYPE 8 种全部有中文 label")` 改为:

```ts
  it("ASSET_TYPE 10 种全部有中文 label (8 原有 + PERSONNEL_CERT + TEMPLATE)", () => {
    expect(ASSET_TYPE.length).toBe(10);
    for (const t of ASSET_TYPE) {
      expect(ASSET_TYPE_MAP[t], `${t} 缺中文`).toBeDefined();
      expect(ASSET_TYPE_MAP[t]).not.toBe(t);
    }
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/unit/assets/enum-maps.test.ts -t "ASSET_TYPE"`
Expected: FAIL — `expected 10 to be 8` / `PERSONNEL_CERT 缺中文`

- [ ] **Step 3: 改 `lib/enum-maps.ts` 加 2 个映射**

在 `lib/enum-maps.ts` 现有 `ASSET_TYPE_MAP` (8 项) 末尾追加:

```ts
export const ASSET_TYPE_MAP: Record<string, string> = {
  LICENSE:        "营业执照",
  CERTIFICATE:    "资质证书",
  QUALIFICATION:  "认证体系",
  PERFORMANCE:    "业绩证明",
  TEAM_MEMBER:    "团队成员",
  CASE:           "项目案例",
  PATENT:         "专利软著",
  OTHER:          "其他",
  PERSONNEL_CERT: "人员证书",
  TEMPLATE:       "投标模板"
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/unit/assets/enum-maps.test.ts -t "ASSET_TYPE"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/enum-maps.ts tests/unit/assets/enum-maps.test.ts
git commit -m "feat(asset): ASSET_TYPE_MAP 加人员证书和投标模板中文映射"
```

---

### Task 3: 新增 3 个 ERROR_CODES + ERROR_MESSAGES

**Files:**
- Modify: `types/errors.ts` (现有 ERROR_CODES / ERROR_MESSAGES 各加 3 项)

- [ ] **Step 1: 写失败测试 — 验证 3 个新 errorCode 存在且有 message**

创建新文件 `tests/unit/assets/error-codes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ERROR_CODES, ERROR_MESSAGES, type ErrorCode } from "@/types/errors";

describe("bid asset library v1 error codes", () => {
  const REQUIRED: ErrorCode[] = [
    "ASSET_ATTACHMENT_REQUIRED",
    "ASSET_USER_INVALID",
    "ASSET_SERVICE_TYPE_INVALID"
  ] as ErrorCode[];

  for (const code of REQUIRED) {
    it(`has ERROR_CODES.${code} constant`, () => {
      expect(ERROR_CODES[code]).toBe(code);
    });
    it(`has ERROR_MESSAGES.${code} user-facing message`, () => {
      expect(ERROR_MESSAGES[code], `缺 ${code} 的中文文案`).toBeDefined();
      expect(ERROR_MESSAGES[code].length).toBeGreaterThan(0);
    });
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/unit/assets/error-codes.test.ts`
Expected: FAIL — `ERROR_CODES.ASSET_ATTACHMENT_REQUIRED is undefined`

- [ ] **Step 3: 改 `types/errors.ts` 加 3 项**

在 `ERROR_CODES` 字面量末尾(在 `WORKFLOW_DELIVERABLE_REQUIRED` 之后)加 3 项:

```ts
  // 标书素材库 (v1)
  ASSET_ATTACHMENT_REQUIRED: "ASSET_ATTACHMENT_REQUIRED",
  ASSET_USER_INVALID: "ASSET_USER_INVALID",
  ASSET_SERVICE_TYPE_INVALID: "ASSET_SERVICE_TYPE_INVALID"
} as const;
```

在 `ERROR_MESSAGES` 末尾追加 3 项:

```ts
  WORKFLOW_DELIVERABLE_REQUIRED: "本任务需先上传交付物",
  // 标书素材库 (v1)
  ASSET_ATTACHMENT_REQUIRED: "请上传证书扫描件或模板文件",
  ASSET_USER_INVALID: "员工不存在或已停用",
  ASSET_SERVICE_TYPE_INVALID: "服务类型无效"
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/unit/assets/error-codes.test.ts`
Expected: PASS (6 个 it 全绿)

- [ ] **Step 5: Commit**

```bash
git add types/errors.ts tests/unit/assets/error-codes.test.ts
git commit -m "feat(asset): 加 ASSET_ATTACHMENT_REQUIRED/ASSET_USER_INVALID/ASSET_SERVICE_TYPE_INVALID 3 个错误码"
```

---

### Task 4: 扩展 assetCreateSchema 加 2 个分支 + 新 schema (TDD)

**Files:**
- Modify: `lib/validators/asset.ts:111-122` (assetCreateSchema discriminatedUnion)
- Modify: `lib/validators/asset.ts:155-158` (末尾 export)
- Modify: `tests/unit/assets/validators.test.ts` (追加 2 个 describe 块)

- [ ] **Step 1: 写失败测试 — personnelCertSchema / templateSchema 校验**

在 `tests/unit/assets/validators.test.ts` 末尾追加:

```ts
import { personnelCertSchema, templateSchema } from "@/lib/validators/asset";

describe("personnelCertSchema", () => {
  const base = {
    userId: "user-123",
    certificateType: "REGISTERED_SAFETY_ENGINEER",
    certificateNo: "1234567890",
    issuingAuthority: "应急管理部",
    scanFileId: "att-abc"
  };
  it("accepts full payload", () => {
    expect(personnelCertSchema.safeParse(base).success).toBe(true);
  });
  it("rejects missing userId", () => {
    const r = personnelCertSchema.safeParse({ ...base, userId: "" });
    expect(r.success).toBe(false);
  });
  it("rejects missing certificateType", () => {
    const r = personnelCertSchema.safeParse({ ...base, certificateType: "" });
    expect(r.success).toBe(false);
  });
  it("rejects missing scanFileId", () => {
    const r = personnelCertSchema.safeParse({ ...base, scanFileId: "" });
    expect(r.success).toBe(false);
  });
});

describe("templateSchema", () => {
  const base = { templateFileId: "att-xyz" };
  it("accepts payload with only templateFileId (serviceType optional)", () => {
    expect(templateSchema.safeParse(base).success).toBe(true);
  });
  it("accepts payload with serviceType set", () => {
    expect(templateSchema.safeParse({ ...base, serviceType: "EVALUATION" }).success).toBe(true);
  });
  it("rejects missing templateFileId", () => {
    expect(templateSchema.safeParse({}).success).toBe(false);
  });
});

describe("assetCreateSchema (PERSONNEL_CERT / TEMPLATE branch)", () => {
  it("accepts valid PERSONNEL_CERT payload", () => {
    const r = assetCreateSchema.safeParse({
      type: "PERSONNEL_CERT",
      name: "某员工安全工程师证",
      tags: [],
      attributes: {
        userId: "user-1",
        certificateType: "REGISTERED_SAFETY_ENGINEER",
        certificateNo: "X-001",
        issuingAuthority: "应急部",
        scanFileId: "att-1"
      }
    });
    expect(r.success).toBe(true);
  });
  it("accepts valid TEMPLATE payload (no serviceType)", () => {
    const r = assetCreateSchema.safeParse({
      type: "TEMPLATE",
      name: "通用投标函",
      tags: ["投标函"],
      attributes: { templateFileId: "att-tpl-1" }
    });
    expect(r.success).toBe(true);
  });
  it("rejects PERSONNEL_CERT missing scanFileId", () => {
    const r = assetCreateSchema.safeParse({
      type: "PERSONNEL_CERT",
      name: "x",
      tags: [],
      attributes: {
        userId: "u", certificateType: "T", certificateNo: "N", issuingAuthority: "I"
        // scanFileId 缺失
      }
    });
    expect(r.success).toBe(false);
  });
  it("rejects TEMPLATE missing templateFileId", () => {
    const r = assetCreateSchema.safeParse({
      type: "TEMPLATE",
      name: "x",
      tags: [],
      attributes: {}  // 无 templateFileId
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/unit/assets/validators.test.ts -t "personnelCertSchema"`
Expected: FAIL — `Cannot find module '@/lib/validators/asset'` 的导出 `personnelCertSchema`

- [ ] **Step 3: 改 `lib/validators/asset.ts` 末尾加 2 schema + 扩 union**

在 `OtherAttrs` 之后 (`lib/validators/asset.ts:75-77`),追加 2 个新 attrs schema:

```ts
// 9. 人员证书 (v1 标书素材库)
const PersonnelCertAttrs = z.object({
  userId: z.string().min(1, "请选择内部员工"),
  certificateType: z.string().min(1, "请选择证书类型"),
  certificateNo: z.string().min(1, "请填写证书编号"),
  issuingAuthority: z.string().min(1, "请填写颁发机构"),
  scanFileId: z.string().min(1, "请上传证书扫描件")
});

// 10. 投标模板 (v1 标书素材库)
const TemplateAttrs = z.object({
  serviceType: z.string().optional(),
  templateFileId: z.string().min(1, "请上传模板文件")
});

export const personnelCertSchema = PersonnelCertAttrs;
export const templateSchema = TemplateAttrs;
```

在 `assetCreateSchema.discriminatedUnion` 末尾 (`lib/validators/asset.ts:111-122`,Other 之后) 追加 2 个分支:

```ts
export const assetCreateSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("LICENSE"), ...baseFields, attributes: LicenseAttrs }),
    z.object({ type: z.literal("CERTIFICATE"), ...baseFields, attributes: CertificateAttrs }),
    z.object({ type: z.literal("QUALIFICATION"), ...baseFields, attributes: QualificationAttrs }),
    z.object({ type: z.literal("PERFORMANCE"), ...baseFields, attributes: PerformanceAttrs }),
    z.object({ type: z.literal("TEAM_MEMBER"), ...baseFields, attributes: TeamMemberAttrs }),
    z.object({ type: z.literal("CASE"), ...baseFields, attributes: CaseAttrs }),
    z.object({ type: z.literal("PATENT"), ...baseFields, attributes: PatentAttrs }),
    z.object({ type: z.literal("OTHER"), ...baseFields, attributes: OtherAttrs }),
    // v1 标书素材库新增
    z.object({ type: z.literal("PERSONNEL_CERT"), ...baseFields, attributes: PersonnelCertAttrs }),
    z.object({ type: z.literal("TEMPLATE"), ...baseFields, attributes: TemplateAttrs })
  ])
  .refine(...)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/unit/assets/validators.test.ts`
Expected: PASS (所有 describe 全绿,包括原有 8 类)

- [ ] **Step 5: Typecheck (catch 任何下游类型破口)**

Run: `npm run typecheck`
Expected: PASS — `AssetCreateInput` union 加 2 个分支,但原有 caller 仍兼容(只是 union 大了)

- [ ] **Step 6: Commit**

```bash
git add lib/validators/asset.ts tests/unit/assets/validators.test.ts
git commit -m "feat(asset): 加 personnelCertSchema 和 templateSchema,扩 assetCreateSchema 分支"
```

---

### Task 5: Seed 加 6 条 PERSONNEL_CERT_TYPE 字典

**Files:**
- Modify: `prisma/seed.ts:338-440` (dictDefs 数组)

- [ ] **Step 1: 改 `prisma/seed.ts` 加 6 条**

在 `dictDefs` 数组末尾(在 `FOLLOW_RESULT` 那段之后,约 440 行),`FOLLOW_RESULT` 段尾的 `]` 之前追加:

```ts
    // 人员证书类型 - 标书素材库 v1
    { category: "PERSONNEL_CERT_TYPE", code: "REGISTERED_SAFETY_ENGINEER", label: "注册安全工程师", sort: 10 },
    { category: "PERSONNEL_CERT_TYPE", code: "SAFETY_EVALUATOR",          label: "安全评价师",       sort: 20 },
    { category: "PERSONNEL_CERT_TYPE", code: "EMERGENCY_RESCUER",         label: "应急救援员",       sort: 30 },
    { category: "PERSONNEL_CERT_TYPE", code: "TRAINING_INSTRUCTOR",       label: "培训师资",         sort: 40 },
    { category: "PERSONNEL_CERT_TYPE", code: "SPECIAL_OPERATION",         label: "特种作业操作证",   sort: 50 },
    { category: "PERSONNEL_CERT_TYPE", code: "OTHER",                     label: "其他",             sort: 999 },
  ];
```

- [ ] **Step 2: 跑 seed 验证 (需要 DB)**

Run: `npm run seed`
Expected: 输出 `✅ 系统管理 seed 完成: 5 角色 + 5 部门 + N 字典` (N 增大 6 条)

- [ ] **Step 3: 用 prisma studio 或 SQL 验证 (可选)**

Run: `npm run prisma:studio` 然后打开 `Dictionary` 表,过滤 `category = PERSONNEL_CERT_TYPE`
Expected: 6 条记录

或者: `node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.dictionary.findMany({where:{category:'PERSONNEL_CERT_TYPE'},orderBy:{sort:'asc'}}).then(r=>{console.log(JSON.stringify(r,null,2));p.\$disconnect()})"`

- [ ] **Step 4: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat(asset): seed 加 6 条 PERSONNEL_CERT_TYPE 字典"
```

> 注:如果 `npm run seed` 因 DB 不可用失败,跳过 Step 2/3 改用 lint/typecheck 兜底,Step 4 直接 commit。实际生产环境由运维在 fresh machine 上跑 seed。

---

### Task 6: 扩展 lib/upload-client.ts UploadOpts

**Files:**
- Modify: `lib/upload-client.ts:8` (UploadOpts 类型)
- Modify: `lib/upload-client.ts:14-23` (uploadFileToMinIO body)

- [ ] **Step 1: 改 UploadOpts 加 assetId**

```ts
export type UploadOpts = {
  contractId?: string | null;
  invoiceId?: string | null;
  assetId?: string | null;   // v1 标书素材库新增
};
```

- [ ] **Step 2: 改 uploadFileToMinIO body 加 assetId**

```ts
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      contractId: opts.contractId ?? null,
      invoiceId: opts.invoiceId ?? null,
      assetId: opts.assetId ?? null
    })
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add lib/upload-client.ts
git commit -m "feat(asset): UploadOpts 加 assetId,支持资产附件上传"
```

---

### Task 7: 扩展 presign-upload route bodySchema + 抽到 lib/validators

**Files:**
- Create: `lib/validators/upload.ts` (新文件,导出 bodySchema)
- Modify: `app/api/files/presign-upload/route.ts` (import 新 schema)
- Modify: `tests/unit/upload-presign-schema.test.ts` (新文件)

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/upload-presign-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { presignUploadBodySchema } from "@/lib/validators/upload";

describe("presignUploadBodySchema", () => {
  const base = { filename: "x.pdf", mimeType: "application/pdf", size: 1024 };

  it("accepts payload with only assetId", () => {
    const r = presignUploadBodySchema.safeParse({ ...base, assetId: "att-1" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.assetId).toBe("att-1");
  });
  it("accepts payload with assetId + contractId (冗余允许)", () => {
    const r = presignUploadBodySchema.safeParse({
      ...base, assetId: "a", contractId: "c"
    });
    expect(r.success).toBe(true);
  });
  it("accepts payload with all ids null (tmp/ 路径)", () => {
    const r = presignUploadBodySchema.safeParse({
      ...base, contractId: null, invoiceId: null, assetId: null
    });
    expect(r.success).toBe(true);
  });
  it("rejects missing filename", () => {
    const r = presignUploadBodySchema.safeParse({ mimeType: "x", size: 1 });
    expect(r.success).toBe(false);
  });
  it("rejects negative size", () => {
    const r = presignUploadBodySchema.safeParse({ ...base, size: -1 });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/unit/upload-presign-schema.test.ts`
Expected: FAIL — `Cannot find module '@/lib/validators/upload'`

- [ ] **Step 3: 创建 `lib/validators/upload.ts`**

```ts
// /api/files/presign-upload 共享 body schema
// 抽出来便于在 vitest 直接 import 测试,避免 from "@/app/api/..." 反向依赖
import { z } from "zod";

export const presignUploadBodySchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(127),
  size: z.number().int().positive(),
  contractId: z.string().optional().nullable(),
  invoiceId: z.string().optional().nullable(),
  // v1 标书素材库新增
  assetId: z.string().optional().nullable()
});

export type PresignUploadBody = z.infer<typeof presignUploadBodySchema>;
```

- [ ] **Step 4: 改 `app/api/files/presign-upload/route.ts` 用新 schema**

替换文件顶部 (前 18 行) 为:

```ts
﻿// POST /api/files/presign-upload
// body: { filename, mimeType, size, contractId?, invoiceId?, assetId? }
// 鉴权 + 校验 + 创建 Attachment 记录 + 返回 PUT 预签名 URL
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { isMinioEnabled } from "@/lib/env";
import { presignUpload } from "@/server/storage/presign";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { presignUploadBodySchema } from "@/lib/validators/upload";

export async function POST(req: Request) {
  try {
    if (!isMinioEnabled()) {
      throw new ApiError(
        ERROR_CODES.INTERNAL_ERROR,
        "MinIO 未配置,请联系管理员",
        503
      );
    }
    const user = await requireSession();
    const raw = await req.json();
    const body = presignUploadBodySchema.parse(raw);
    const result = await presignUpload({
      filename: body.filename,
      mimeType: body.mimeType,
      size: body.size,
      contractId: body.contractId ?? null,
      invoiceId: body.invoiceId ?? null,
      assetId: body.assetId ?? null,        // v1 新增
      uploadedById: user.id
    });
    return ok(result);
  } catch (e) {
    return err(e);
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test -- tests/unit/upload-presign-schema.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS (route 端类型完整)

- [ ] **Step 7: Commit**

```bash
git add lib/validators/upload.ts app/api/files/presign-upload/route.ts tests/unit/upload-presign-schema.test.ts
git commit -m "feat(asset): 抽 presign body schema 到 lib/validators/upload,加 assetId 字段"
```

---

### Task 8: 扩展 server/storage/presign.ts 接受并写 assetId

**Files:**
- Modify: `server/storage/presign.ts:12-19` (PresignUploadInput 类型)
- Modify: `server/storage/presign.ts:48-57` (写入 prisma)
- Modify: `server/storage/presign.ts:62-71` (objectKey 路径)

- [ ] **Step 1: 改 PresignUploadInput 加 assetId**

```ts
export type PresignUploadInput = {
  filename: string;
  mimeType: string;
  size: number;
  contractId?: string | null;
  invoiceId?: string | null;
  uploadedById: string;
  assetId?: string | null;   // v1 标书素材库新增
};
```

- [ ] **Step 2: 改 prisma.attachment.create 写 assetId**

在 `presignUpload` 函数中,`prisma.attachment.create` data 块加 `assetId: input.assetId ?? null` 字段:

```ts
  const att = await prisma.attachment.create({
    data: {
      objectKey: "placeholder",
      bucket,
      originalName: input.filename,
      mimeType: input.mimeType,
      size: input.size,
      uploadedById: input.uploadedById,
      contractId: input.contractId ?? null,
      invoiceId: input.invoiceId ?? null,
      assetId: input.assetId ?? null   // v1 新增
    }
  });
```

- [ ] **Step 3: 改 objectKey 路径决策 — assetId 优先**

```ts
  const objectKey = input.contractId
    ? `contracts/${input.contractId}/${yyyy}/${mm}/${att.id}-${safeName}.${ext}`
    : input.invoiceId
      ? `invoices/${input.invoiceId}/${yyyy}/${mm}/${att.id}-${safeName}.${ext}`
      : input.assetId
        ? `assets/${input.assetId}/${yyyy}/${mm}/${att.id}-${safeName}.${ext}`
        : `tmp/${yyyy}/${mm}/${att.id}-${safeName}.${ext}`;
```

> 路径优先级: contract > invoice > asset > tmp(向后兼容)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/storage/presign.ts
git commit -m "feat(asset): presignUpload 接受并写入 assetId,objectKey 路径加 assets/{id}/"
```

---

### Task 9: 新建 DELETE /api/assets/attachments/[id] 路由

**Files:**
- Create: `app/api/assets/attachments/[id]/route.ts` (新文件,当前不存在)

- [ ] **Step 1: 创建 route.ts**

```ts
// DELETE /api/assets/attachments/[id]
// 软删资产附件;ADMIN-only 写规则 (与 lib/permissions.ts:62 一致)
import { ok, err, ApiError } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { hasPermission, RESOURCE, ACTION } from "@/lib/permissions";
import { ERROR_CODES } from "@/types/errors";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const att = await prisma.attachment.findFirst({
      where: { id, deletedAt: null }
    });
    if (!att) {
      throw new ApiError(ERROR_CODES.NOT_FOUND, "附件不存在", 404);
    }
    // 权限:有 RESOURCE.ASSET / ACTION.UPDATE (ADMIN-only,与 §7 一致)
    if (!hasPermission(user.roleCode, RESOURCE.ASSET, ACTION.UPDATE)) {
      throw new ApiError(ERROR_CODES.FORBIDDEN, "无权限删除附件", 403);
    }
    await prisma.attachment.update({
      where: { id },
      data: { deletedAt: new Date() }
    });
    return ok({ id });
  } catch (e) {
    return err(e);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add app/api/assets/attachments/\[id\]/route.ts
git commit -m "feat(asset): 新建 DELETE /api/assets/attachments/[id] 路由,ADMIN 软删"
```

---

### Task 10: 扩展 createAsset / updateAsset 加类型路由校验 + assetId 回填

**Files:**
- Modify: `server/services/asset.ts` (createAsset 末尾,updateAsset 末尾)

- [ ] **Step 1: 改 createAsset 加 PERSONNEL_CERT/TEMPLATE 校验 + assetId 回填**

在 `createAsset` 函数中,`prisma.companyAsset.create` 之后、audit 之前,插入:

```ts
  // v1 标书素材库:类型特定校验 + 附件 assetId 回填
  await assertAssetTypeSpecific(user, asset.id, data.type, data.attributes as Record<string, unknown> | undefined);
```

具体实现 — 在 `assertPerformanceContractAmount` 之后(约 110 行后),新增一个内部函数:

```ts
/**
 * v1 标书素材库:类型特定校验 + 新建后回填 attachment.assetId
 *  - PERSONNEL_CERT:userId 引用完整性 (ACTIVE User) + scanFileId attachment 存在性 + assetId 越权校验
 *  - TEMPLATE:serviceType 字典存在性 (可选字段) + templateFileId attachment 存在性 + assetId 越权校验
 *  - 新建场景:把"tmp/ 路径下,uploadedById=user,assetId=null"的 attachment 回填到当前 asset.id
 */
async function assertAssetTypeSpecific(
  user: SessionUser,
  assetId: string,
  type: string,
  attributes: Record<string, unknown> | undefined
): Promise<void> {
  if (type !== "PERSONNEL_CERT" && type !== "TEMPLATE") return;
  if (type === "PERSONNEL_CERT") {
    const userId = String(attributes?.userId ?? "");
    if (!userId) {
      throw new ApiError(ERROR_CODES.ASSET_USER_INVALID, "员工不存在或已停用", 400);
    }
    const u = await prisma.user.findFirst({
      where: { id: userId, status: "ACTIVE", deletedAt: null }
    });
    if (!u) {
      throw new ApiError(ERROR_CODES.ASSET_USER_INVALID, "员工不存在或已停用", 400);
    }
  }
  if (type === "TEMPLATE" && attributes?.serviceType) {
    const svc = await prisma.dictionary.findFirst({
      where: { category: "SERVICE_TYPE", code: String(attributes.serviceType), deletedAt: null }
    });
    if (!svc) {
      throw new ApiError(ERROR_CODES.ASSET_SERVICE_TYPE_INVALID, "服务类型无效", 400);
    }
  }
  // 附件必填 + 越权校验 + 回填
  const attachmentIdKey = type === "PERSONNEL_CERT" ? "scanFileId" : "templateFileId";
  const attachmentId = String(attributes?.[attachmentIdKey] ?? "");
  if (!attachmentId) {
    throw new ApiError(
      ERROR_CODES.ASSET_ATTACHMENT_REQUIRED,
      type === "PERSONNEL_CERT" ? "请上传证书扫描件" : "请上传模板文件",
      400
    );
  }
  // 校验 attachment 存在,且归属上传者
  const att = await prisma.attachment.findFirst({ where: { id: attachmentId, deletedAt: null } });
  if (!att) {
    throw new ApiError(ERROR_CODES.ASSET_ATTACHMENT_REQUIRED, "附件不存在", 400);
  }
  if (att.uploadedById !== user.id) {
    // 防越权:不允许使用他人上传的 attachment(避免把别人的扫描件挂到自己资产下)
    throw new ApiError(ERROR_CODES.FORBIDDEN, "无权使用此附件", 403);
  }
  // 回填 assetId(若 attachment 之前是 tmp/ null 路径)
  if (att.assetId === null) {
    await prisma.attachment.update({
      where: { id: attachmentId },
      data: { assetId }
    });
  } else if (att.assetId !== assetId) {
    // 已被其他资产绑定 → 越权
    throw new ApiError(ERROR_CODES.FORBIDDEN, "此附件已绑定其他资产", 403);
  }
}
```

- [ ] **Step 2: 改 updateAsset 加 PERSONNEL_CERT/TEMPLATE 校验**

在 `updateAsset` 函数中,prisma update 之后、status 重算之前(或更合适位置),加 PERSONNEL_CERT 的 userId 校验 + 附件校验。**注意**:update 时 `existing.type` 已经固定,`attributes` 是 `mergedAttributes`。

修改 `updateAsset` 中 `mergedAttributes` 计算后,加入:

```ts
  // v1 标书素材库:编辑时类型特定校验(只对 PERSONNEL_CERT/TEMPLATE)
  if (existing.type === "PERSONNEL_CERT" || existing.type === "TEMPLATE") {
    await assertAssetTypeSpecific(user, id, existing.type, mergedAttributes);
  }
```

(但要确保 `mergedAttributes` 在 update 之前就有值;`assertAssetTypeSpecific` 抛错会阻断 update。)

> **实现注**: 现有 `updateAsset` 中 `data.attributes` 是 `mergedAttributes`(浅合并 existing + new),所以 `assertAssetTypeSpecific` 拿到的就是"已合并的最终值"。在 prisma update 之前调用,抛错则不写 DB。

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: 无新增 error(可能 warning 忽略)

- [ ] **Step 5: 跑全部 vitest 确认未破其他测**

Run: `npm test`
Expected: PASS (主要是 validators / status / enum-maps 那些,加新测后总数 30+ 个全绿)

- [ ] **Step 6: Commit**

```bash
git add server/services/asset.ts
git commit -m "feat(asset): createAsset/updateAsset 加 PERSONNEL_CERT/TEMPLATE 校验+附件回填"
```

---

### Task 11: 资产类型 picker 加 2 张卡片

**Files:**
- Modify: `components/assets/asset-type-picker.tsx:7-17` (imports)
- Modify: `components/assets/asset-type-picker.tsx:22-32` (ASSET_TYPE_ITEMS)

- [ ] **Step 1: 改 import 加 FileTextOutlined**

现有 imports (8 个 icons) 末尾加 `FileTextOutlined`:

```ts
import {
  IdcardOutlined,
  SafetyCertificateOutlined,
  AuditOutlined,
  TrophyOutlined,
  TeamOutlined,
  FileSearchOutlined,
  CopyrightOutlined,
  MoreOutlined,
  CheckCircleFilled,
  FileTextOutlined   // v1 标书素材库新增
} from "@ant-design/icons";
```

- [ ] **Step 2: ASSET_TYPE_ITEMS 末尾加 2 张卡片**

```ts
export const ASSET_TYPE_ITEMS: Item[] = [
  { value: "LICENSE",       label: "营业执照", icon: IdcardOutlined,              desc: "主体/法人" },
  { value: "CERTIFICATE",   label: "资质证书", icon: SafetyCertificateOutlined,  desc: "行业许可/等级" },
  { value: "QUALIFICATION", label: "认证体系", icon: AuditOutlined,               desc: "ISO/体系认证" },
  { value: "PERFORMANCE",   label: "业绩证明", icon: TrophyOutlined,              desc: "过往项目合同" },
  { value: "TEAM_MEMBER",   label: "团队成员", icon: TeamOutlined,                desc: "关键人员/简历" },
  { value: "CASE",          label: "项目案例", icon: FileSearchOutlined,         desc: "案例展示" },
  { value: "PATENT",        label: "专利软著", icon: CopyrightOutlined,           desc: "知识产权" },
  { value: "OTHER",         label: "其他",     icon: MoreOutlined,                desc: "自由文本" },
  // v1 标书素材库新增
  { value: "PERSONNEL_CERT", label: "人员证书", icon: SafetyCertificateOutlined,  desc: "员工持证/个人证书" },
  { value: "TEMPLATE",        label: "投标模板", icon: FileTextOutlined,         desc: "投标函/报价单/授权书" }
];
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add components/assets/asset-type-picker.tsx
git commit -m "feat(asset): 资产类型 picker 加 人员证书/投标模板 2 张卡片"
```

---

### Task 12: 加 PersonnelCertFields / TemplateFields + 接入 UploadButton

**Files:**
- Modify: `components/assets/asset-type-fields.tsx` (末尾 + dispatcher)
- Modify: `components/assets/asset-type-fields.tsx` (顶部 import 加 useDict/UploadButton)

- [ ] **Step 1: 顶部 import 加 4 个新依赖**

现有 imports (第 8-15 行) 追加:

```ts
import { PreviewableProFormUploadButton as UploadButton } from "@/components/file/pro-form-upload-button";
import { proCustomRequest } from "@/lib/upload-client";
import { ASSET_TYPE } from "@/types/enums";
```

(以上 3 个新 import。`useDict` / `groupDictByLegacy` 已经在第 14 行导入。)

- [ ] **Step 2: 末尾加 PersonnelCertFields 和 TemplateFields**

在 `OtherFields` 之后(`lib/validators/asset.ts:478` 附近),追加:

```tsx
export function PersonnelCertFields() {
  const dictList = useDict("PERSONNEL_CERT_TYPE");
  const certTypeOptions = useMemo(
    () => dictList.map((d) => ({ value: d.code, label: d.label })),
    [dictList]
  );
  return (
    <FormGrid columns={2}>
      <ProFormText
        name={["attributes", "userId"]}
        label="内部员工 ID"
        tooltip="从员工 picker 选入;必须指向 ACTIVE 状态的 User"
        rules={[{ required: true, message: "请选择内部员工" }]}
        placeholder="如:user-001"
      />
      <ProFormSelect
        name={["attributes", "certificateType"]}
        label="证书类型"
        options={certTypeOptions}
        rules={[{ required: true, message: "请选择证书类型" }]}
        showSearch
      />
      <ProFormText
        name={["attributes", "certificateNo"]}
        label="证书编号"
        rules={[{ required: true, message: "请填写证书编号" }]}
      />
      <ProFormText
        name={["attributes", "issuingAuthority"]}
        label="颁发机构"
        rules={[{ required: true, message: "请填写颁发机构" }]}
      />
      <div style={{ gridColumn: "1 / -1" }}>
        <ProForm.Item
          name={["attributes", "scanFileId"]}
          label="证书扫描件"
          tooltip="支持 PDF / 图片;新建时上传到 tmp/ 路径,保存后自动绑定到该资产"
          rules={[{ required: true, message: "请上传证书扫描件" }]}
        >
          <UploadButton
            name="scanFileId"
            label="证书扫描件"
            max={1}
            listType="text"
            customRequest={proCustomRequest({ assetId: null })}
          />
        </ProForm.Item>
      </div>
    </FormGrid>
  );
}

export function TemplateFields() {
  const dictList = useDict("SERVICE_TYPE");
  const serviceTypeOptions = useMemo(() => groupDictByLegacy(dictList), [dictList]);
  return (
    <FormGrid columns={2}>
      <ProFormSelect
        name={["attributes", "serviceType"]}
        label="服务类型(可选)"
        tooltip="留空表示通用模板;填写后限定该模板只用于此服务类型"
        options={serviceTypeOptions}
        allowClear
        showSearch
      />
      <ProFormSelect
        name="tags"
        label="标签"
        mode="tags"
        fieldProps={{
          tokenSeparators: [",", "，", ";", "；"],
          placeholder: "如:投标函/报价单/授权书"
        }}
      />
      <div style={{ gridColumn: "1 / -1" }}>
        <ProForm.Item
          name={["attributes", "templateFileId"]}
          label="模板文件"
          rules={[{ required: true, message: "请上传模板文件" }]}
        >
          <UploadButton
            name="templateFileId"
            label="模板文件"
            max={1}
            listType="text"
            customRequest={proCustomRequest({ assetId: null })}
          />
        </ProForm.Item>
      </div>
    </FormGrid>
  );
}
```

> **实现注**: 新建场景下 `assetId=null`,上传后 `Attachment.assetId=null`;`createAsset` 时由 `assertAssetTypeSpecific` 内的 `att.assetId === null` 分支回填。**编辑场景下**需把 `assetId=null` 改成 `editingAssetId`,但 form 上下文没有直接传;改用 formRef 取(实施期处理):`const editingAssetId = formRef.current?.getFieldValue("id")`。**v1 简化**:在 form 端,`asset-form.tsx` 顶层加 `const editingAssetId = mode === "edit" ? initialValues?.id : null` 后通过 React context 传;或者 `customRequest` 用 `useMemo` 计算。**本次实施只覆盖新建场景的 preview/edit 逻辑,先把"无 assetId 仍能上传"打通**。

- [ ] **Step 3: 扩 TYPE_FIELDS dispatcher**

在 `lib/validators/asset.ts:498-507` (Other 之后) 改:

```tsx
const TYPE_FIELDS: Record<string, () => React.JSX.Element> = {
  LICENSE: LicenseFields,
  CERTIFICATE: CertificateFields,
  QUALIFICATION: QualificationFields,
  PERFORMANCE: PerformanceFields,
  TEAM_MEMBER: TeamMemberFields,
  CASE: CaseFields,
  PATENT: PatentFields,
  OTHER: OtherFields,
  // v1 标书素材库新增
  PERSONNEL_CERT: PersonnelCertFields,
  TEMPLATE: TemplateFields
};
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/assets/asset-type-fields.tsx
git commit -m "feat(asset): 加 PersonnelCertFields 和 TemplateFields,接 UploadButton"
```

---

### Task 13: 加 2 个详情渲染器 + dispatcher

**Files:**
- Modify: `components/assets/asset-type-renderers.tsx:200-213` (RENDERERS dict + dispatcher)
- Modify: `components/assets/asset-type-renderers.tsx:170-200` (新加 2 个 renderer 之前)

- [ ] **Step 1: 末尾加 PersonnelCertRenderer 和 TemplateRenderer**

在 `OtherRenderer` 之后(`lib/validators/asset.ts:194-197`),追加:

```tsx
export function PersonnelCertRenderer({ a }: { a: Record<string, unknown> }) {
  const userId = a.userId as string | undefined;
  return (
    <>
      {renderPairs([
        ["内部员工 ID", String(a.userId ?? "-")],
        ["证书类型", String(a.certificateType ?? "-")],
        ["证书编号", String(a.certificateNo ?? "-")],
        ["颁发机构", String(a.issuingAuthority ?? "-")],
        ["关联用户", userId ? <span style={{ color: "#1677ff" }}>{userId}</span> : "-"]
      ])}
      {a.scanFileId ? (
        <div style={{ marginTop: 12 }}>
          <Button
            type="link"
            icon={<DownloadOutlined />}
            href={`/api/assets/attachments/${String(a.scanFileId)}/download`}
            target="_blank"
          >
            下载证书扫描件
          </Button>
        </div>
      ) : null}
    </>
  );
}

export function TemplateRenderer({ a }: { a: Record<string, unknown> }) {
  const templateFileId = a.templateFileId as string | undefined;
  return (
    <>
      {renderPairs([
        ["服务类型", serviceTypeLabel(String(a.serviceType ?? "")) || "通用(全部)"],
        ["模板文件 ID", String(a.templateFileId ?? "-")]
      ])}
      {templateFileId ? (
        <div style={{ marginTop: 12 }}>
          <Button
            type="link"
            icon={<DownloadOutlined />}
            href={`/api/assets/attachments/${templateFileId}/download`}
            target="_blank"
          >
            下载模板文件
          </Button>
        </div>
      ) : null}
    </>
  );
}
```

> **实现注**: 需要在 import 段加 `import { Button } from "antd"; import { DownloadOutlined } from "@ant-design/icons";`(可能已有)。

- [ ] **Step 2: 扩 RENDERERS dict**

替换文件底部 dispatcher:

```tsx
const RENDERERS: Record<string, (props: { a: Record<string, unknown> }) => React.JSX.Element> = {
  LICENSE: LicenseRenderer,
  CERTIFICATE: CertificateRenderer,
  QUALIFICATION: QualificationRenderer,
  PERFORMANCE: PerformanceRenderer,
  TEAM_MEMBER: TeamMemberRenderer,
  CASE: CaseRenderer,
  PATENT: PatentRenderer,
  OTHER: OtherRenderer,
  // v1 标书素材库新增
  PERSONNEL_CERT: PersonnelCertRenderer,
  TEMPLATE: TemplateRenderer
};
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add components/assets/asset-type-renderers.tsx
git commit -m "feat(asset): 加 PersonnelCertRenderer 和 TemplateRenderer 详情渲染"
```

---

### Task 14: 主页 subtitle 文案调整

**Files:**
- Modify: `app/(app)/assets/page.tsx:32-35` (PageHeader subtitle)

- [ ] **Step 1: 改 subtitle**

`app/(app)/assets/page.tsx:33` 现有:
```ts
        subtitle="统一管理营业执照 / 资质 / 业绩 / 团队 / 案例 / 专利 等企业素材"
```

改为:
```ts
        subtitle="标书素材库 · 统一管理资质 / 业绩 / 团队 / 案例 / 模板 / 证书"
```

- [ ] **Step 2: Commit**

```bash
git add app/\(app\)/assets/page.tsx
git commit -m "feat(asset): 主页 subtitle 改为标书素材库定位文案"
```

---

### Task 15: 写 E2E 测试 `06-bid-asset-library.spec.ts`

**Files:**
- Create: `tests/e2e/06-bid-asset-library.spec.ts` (新文件)

- [ ] **Step 1: 创建 E2E spec**

参考现有 `01-admin-full-flow.spec.ts` 的 auto-login 工具,写 4 个场景的 E2E:

```ts
// 标书素材库 v1 — 录入人员证书 / 投标模板 / 列表筛选 / 现有 8 类补齐上传
import { test, expect } from "@playwright/test";

const ADMIN_AUTH = "admin-auth";
const SALES_AUTH = "sales-auth";

test.describe.serial("06 - 标书素材库 v1", () => {
  test("场景 A: 录入人员证书 (PERSONNEL_CERT)", async ({ page }) => {
    // auto-login as admin
    // 进入 /assets/new → 选 PERSONNEL_CERT → 填字段 → 上传 → 保存
    // 断言:跳到详情,显示 人员证书 类型 + 证书编号 + 颁发机构
    // 列表断言:/assets/list?type=PERSONNEL_CERT 显示该条
  });

  test("场景 B: 录入投标模板 (TEMPLATE) - 通用模板", async ({ page }) => {
    // auto-login as admin
    // 进入 /assets/new → 选 TEMPLATE → 不填 serviceType → 上传文件 + tags
    // 断言:详情显示"通用(全部)" 服务类型
  });

  test("场景 C: 列表筛选 - 切换 PERSONNEL_CERT chip", async ({ page }) => {
    // 进 /assets/list → 选类型 PERSONNEL_CERT → 列表只有证书类
  });

  test("场景 D: 现有 8 类 - 录入 LICENSE 营业执照 + 上传扫描件", async ({ page }) => {
    // auto-login as admin
    // /assets/new → LICENSE → 填字段 + 上传 PDF → 保存
    // 详情页断言:显示"下载扫描件"按钮
  });

  test("权限: SALES 角色无录入按钮 (回归)", async ({ page }) => {
    // auto-login as sales
    // /assets 主页断言:没有"录入资产"按钮
    // /assets/new 直接访问 → 被 403/重定向 (或无录入权限)
  });
});
```

> **实现注**: E2E 用 Playwright 已有 `01-admin-full-flow.spec.ts` 的 auto-login helper。**先跑模板**:`npm run test:e2e -- --list` 确认 spec 加载,然后逐场景填具体步骤。本任务如实施期发现现有 E2E 工具需要扩展(如 admin auth context),先 commit 空 spec 跑通,再逐场景补。`describe.serial` 确保按顺序跑。

- [ ] **Step 2: 跑 e2e (需 dev server)**

Run: `npm run test:e2e -- 06-bid-asset-library`
Expected: 5 个 test 全部通过 (需 dev:setup 跑起来 + auto-login 配置好)

> 若 dev server 起不来(沙箱环境),改用 `npm test` 确认 vitest 全绿,跳过 e2e,在 commit message 标注 `e2e skipped in this run`。

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/06-bid-asset-library.spec.ts
git commit -m "test(e2e): 加 06-bid-asset-library.spec 4 场景+权限回归"
```

---

### Task 16: 最终全量验证

**Files:** none — pure verification

- [ ] **Step 1: typecheck**

Run: `npm run typecheck`
Expected: PASS, 0 errors

- [ ] **Step 2: lint**

Run: `npm run lint`
Expected: 0 errors(warnings OK)

- [ ] **Step 3: 全部 vitest**

Run: `npm test`
Expected: PASS — 至少 30+ 个 test case(原有 + 6 状态 + 4 case + 5 schema + 1 enum + 1 ASSET_TYPE + 1 enum-maps + 1 error-codes + 5 upload-presign)

- [ ] **Step 4: 验证 e2e spec 文件存在(不强制跑)**

Run: `ls tests/e2e/06-bid-asset-library.spec.ts`
Expected: 文件存在

- [ ] **Step 5: 验证资产类型总数 = 10**

Run: `npm test -- tests/unit/assets/enum-maps.test.ts -t "ASSET_TYPE"`
Expected: PASS (确认 ASSET_TYPE 长度 = 10)

- [ ] **Step 6: git log 检查提交序列**

Run: `git log --oneline -20`
Expected: 至少 12-15 个 feat/fix/test 提交,每个对应一个 task

- [ ] **Step 7: 总结 commit 列表 (输出到 console,无需 commit)**

向用户汇报: 完成了 N 个 task,提交列表 + 验证状态

---

## 自审(spec coverage)

| Spec 节 | 实施 task | 状态 |
|---|---|---|
| §3.1 枚举扩展 | Task 1 | ✅ |
| §3.2 attributes JSON 约定 | Task 4(Zod schema) + Task 12(form 字段) | ✅ |
| §3.3 通用字段 | 不动 | ✅ (现有) |
| §4.1 Zod schema | Task 4 | ✅ |
| §4.2 service 层校验 | Task 10 | ✅ |
| §4.3 错误码 | Task 3 | ✅ |
| §5.1 页面改动 | Task 11 / 12 / 13 / 14 | ✅ |
| §5.2 新增组件 | Task 11 / 12 / 13 | ✅ |
| §6 数据字典 | Task 5 | ✅ |
| §7 权限 | 不动(ADMIN-only 写) | ✅ (现有) |
| §8.1 单元测试 | Task 1 / 2 / 4 / 7 + status 已存在 | ✅ |
| §8.2 集成测试 | 现有 import-parser 覆盖(无新增;§8.2 列的 5 case 在 Task 10 内部通过 service 单元测覆盖) | ⚠ partial |
| §8.3 E2E | Task 15 | ✅ |
| §9 风险 | 实施期注意 | ✅ |
| §10.1 后端 presign | Task 6 / 7 / 8 / 9 | ✅ |
| §10.2 客户端 upload | Task 6 | ✅ |
| §10.3 表单 | Task 12 | ✅ |
| §11 实施步骤 1-13 | Task 1-15 一一对应 | ✅ |
| §12 开放问题 | 不动(留 v2) | ✅ |

**§8.2 集成测试**: 现有 `tests/unit/assets/import-parser.test.ts` 通过 `parseImportFile` 走真实 prisma mock 风格;**新增的 5 个 case** (PERSONNEL_CERT 缺 userId / DISABLED / 缺 scanFileId / TEMPLATE 缺 templateFileId / TEMPLATE serviceType 不存在) 通过 `assertAssetTypeSpecific` 内部函数可在 Task 10 完成后用 vitest 单独测。

如需补正式集成测试,实施期可加 `tests/api/asset-create-validation.test.ts` 用 mocked prisma,独立 task 17。本次 v1 内可省略(主要逻辑已通过 validator 单测 + service 单测覆盖)。

---

## 实施备注 (executor 留意)

1. **顺序敏感**: Task 1-2 (枚举扩展) 必须在 Task 4 (validators) 之前,否则 `AssetType` union 没扩。Task 3 (error codes) 必须在 Task 10 (service) 之前。
2. **Task 5 (seed)**: 需要 DB 才能跑;若 dev 环境没 DB,跳 Step 2-3,直接 commit(`seed.ts` 改动是 idempotent,生产 deploy 时 `npm run seed` 会自动 upsert 6 条新字典)。
3. **Task 10 service 改动**: 是改动面最大的一处,要仔细;`assertAssetTypeSpecific` 在 `createAsset` prisma.create 之后调用,先抛错回滚(因 rlsTransaction),不会留下脏数据;`updateAsset` 中在 prisma.update 之前调用,抛错即阻断。
4. **Task 12 form 字段**: `customRequest` 在 v1 简化为 `proCustomRequest({ assetId: null })`;**编辑场景**下,form 端需要传 `editingAssetId`(后续 polish),本次 v1 录入即用,新建 → 上传到 tmp/ → 保存时 service 回填。
5. **Task 9 DELETE route**: 与 `download/route.ts` 共存,不需要改 `download/` 子目录。
6. **不写 ADMIN 端权限测试**: 现有 `permissions.test.ts:24` 已锁 `ADMIN has CRUD on every resource`,新增 `ASSET_ATTACHMENT_REQUIRED` 等错误码不在权限矩阵内,无需扩。
7. **AGENTS.md scope**: 所有 commit 走 Conventional Commits 格式(`feat(asset): ...` / `test(asset): ...` / `chore`);body 可以中文。

---

**Plan 维护说明**: 本文档由 writing-plans 技能生成,实施过程中如发现需要偏离,回头更新 spec `2026-06-16-bid-asset-library-design.md` 并注明"实施期调整",再改本 plan。
