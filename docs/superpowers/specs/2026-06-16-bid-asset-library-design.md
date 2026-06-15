# 标书素材库 v1 — 设计文档

| 项 | 值 |
|---|---|
| 日期 | 2026-06-16 |
| 状态 | 待 review |
| 范围 | v1 增量（基于现有 `CompanyAsset` 模块） |
| 目标版本 | qt-biz v0.3.0（待定） |

## 1. 背景与目标

`杭州企泰安全科技 业务管理系统` 当前已上线 `CompanyAsset` 模块（`app/(app)/assets/`），统一管理 8 类企业资产（营业执照 / 资质证书 / 认证体系 / 业绩证明 / 团队成员 / 项目案例 / 专利软著 / 其他），覆盖了标书常用素材的 4/6。

**v1 目标**：在该模块上补齐 6 类标书素材（见 §2），把现有模块的定位从"企业资产统一管理"调整为"标书素材库"（菜单名沿用"企业资产"，**不**做品牌级改名；定位文案在 `subtitle` 上体现）。

**非目标**（v1 不做）：标书编制 / 导出 / 一键引用 / 业绩 override 字段解锁 / `DRAFT/PUBLISHED` 状态 / 后台 job 到期提醒 / 新角色。

## 2. 范围

### 2.1 v1 内

- 新增 2 个 `AssetType`：`PERSONNEL_CERT`、`TEMPLATE`
- 新建数据字典 `PERSONNEL_CERT_TYPE`
- 2 个新类型的 Zod schema、字段表单、详情/列表渲染
- **资产附件上传子模块**（v1 顺手补齐 8+2 类资产的附件上传能力）
  - 后端：`/api/files/presign-upload` Zod schema 扩展 `assetId` 字段
  - 客户端：`lib/upload-client.ts` `UploadOpts` 加 `assetId`
  - 表单：`components/assets/asset-form.tsx` 接入 `PreviewableProFormUploadButton`
  - 数据：所有类型的 `attributes` 中附件字段统一存 `attachmentId: string`（见 §3.3 重点说明）
- 现有 8 类资产**不改动业务规则**，仅补齐上传入口
- 主页 `subtitle` 文案调整
- 单元 / 集成 / E2E 测试覆盖

### 2.2 v1 外（明示 deferred）

| 项 | 原因 | 目标版本 |
|---|---|---|
| 标书编制 / 导出 / 一键引用 | 需要独立 brainstorm | v2 |
| 业绩 override 字段解锁 | 与现有 `PerformanceFields` 锁源逻辑冲突，回归成本高 | 待评估 |
| `DRAFT/PUBLISHED` 状态字段 | 现有 `status` 字段语义已承载资产生命周期 | v2 |
| 后台 job 到期提醒 | 现有 `/api/assets/expiring-soon` UI 提示已够用 | 待评估 |
| 新增角色 / 权限位 | 现有 SALES + ADMIN 角色矩阵可覆盖 | v2 |
| 菜单名"企业资产" → "标书素材库" | 用户决定沿用旧名，仅在 subtitle 上做文案调整 | 不做 |

## 3. 数据模型

### 3.1 Prisma Schema 变更

`prisma/schema.prisma` 中的 `AssetType` 枚举（位置需对照当前文件确认）加 2 个值：

```prisma
enum AssetType {
  LICENSE
  CERTIFICATE
  QUALIFICATION
  PERFORMANCE
  TEAM_MEMBER
  CASE
  PATENT
  OTHER
  PERSONNEL_CERT  // 新增
  TEMPLATE        // 新增
}
```

枚举加值在 Prisma 7 下为非破坏性变更，无需数据迁移。

**`Attachment` 模型已存在** `assetId` 字段 + `@@index([assetId, deletedAt])`（见 `prisma/schema.prisma:556-587`），无需 schema 变更。

### 3.2 attributes JSON 约定

新类型的 `attributes` 字段（沿用现有 `Json` 容器）约定如下：

**`PERSONNEL_CERT.attributes`**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `userId` | `string` | ✅ | FK `User.id`，业务上 = 内部员工。必须指向 `ACTIVE` 状态的 User |
| `certificateType` | `string` | ✅ | 字典 `PERSONNEL_CERT_TYPE` 的 `code`（见 §6） |
| `certificateNo` | `string` | ✅ | 证书编号 |
| `issuingAuthority` | `string` | ✅ | 颁发机构 |
| `scanFileId` | `string` | ✅ | 证书扫描件的 `attachmentId`（不是 Prisma FK，见 §3.3 重点说明） |

**`TEMPLATE.attributes`**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `serviceType` | `string` | ❌ | FK `Dictionary.code`，`SERVICE_TYPE` 类下。填了表示"模板只用于该类业务"；不填表示通用 |
| `templateFileId` | `string` | ✅ | 模板文件的 `attachmentId`（不是 Prisma FK，见 §3.3 重点说明） |

`TEMPLATE` 的标签（如 `投标函` / `报价单` / `授权书` / `声明书`）**不**存到 `attributes.tags`，统一存到 `CompanyAsset.tags String[]` 表层列。

### 3.3 通用字段（沿用现有 `CompanyAsset`）

`id` / `code` / `type` / `name` / `description` / `attributes` / `tags` / `status` / `validFrom` / `validTo` / `ownerUserId` / `attachments` / `createdAt` / `updatedAt` / `deletedAt` 全部沿用，不新增列、不修改索引。

**重点说明**：`attributes.scanFileId` / `attributes.templateFileId`（以及现有 8 类资产如有附件字段）**不是** Prisma `Attachment` 的外键关系，而是 `attachmentId: string`，**指向通过 `Attachment.assetId` 关系间接关联的 attachment**。具体来说：

- `Attachment` 表上 `assetId` 是 Prisma FK（`onDelete: SetNull`），用于在 service 层查询"某资产下所有附件"
- `attributes` JSON 里的 `scanFileId` / `templateFileId` 存的是 `attachmentId` 字符串，业务上**冗余**指向同一个 attachment
- 这样设计的取舍：JSON 字段便于类型特定的强校验（PERSONNEL_CERT 必填 `scanFileId`），但要求 service 层在做"按 attachmentId 拿 attachment"时同时校验"该 attachment 的 `assetId` 必须等于当前 asset.id"（防越权）

> **注意**：v1 实施时**不**在 Prisma schema 加 `scanFileId` / `templateFileId` 这种 FK 字段；它们**只**在 `attributes` JSON 里。

## 4. 业务服务层

### 4.1 Zod Schema

新加 `lib/validators/assets.ts`（如文件已存在则合并），导出 2 个 schema：

```ts
// lib/validators/assets.ts
import { z } from "zod";

export const personnelCertSchema = z.object({
  userId: z.string().min(1, "请选择内部员工"),
  certificateType: z.string().min(1, "请选择证书类型"),
  certificateNo: z.string().min(1, "请填写证书编号"),
  issuingAuthority: z.string().min(1, "请填写颁发机构"),
  scanFileId: z.string().min(1, "请上传证书扫描件")
});

export const templateSchema = z.object({
  serviceType: z.string().optional(),
  templateFileId: z.string().min(1, "请上传模板文件")
});
```

`userId` 引用完整性（User 必须存在且 `status = ACTIVE`）在 service 层校验，**不**放到 Zod schema 里。

### 4.2 service 层（`server/services/assets/`）

复用现有 `createAsset` / `updateAsset` 入口，按 `type` 路由到对应 schema 校验。`PERSONNEL_CERT` 和 `TEMPLATE` 的特殊处理：

- **必填附件**：调用 `Attachment` 校验函数，确保 `scanFileId` / `templateFileId` 指向的 attachment 存在且未被软删；**且**该 attachment 的 `assetId` 必须等于当前 asset.id（防越权）；缺失返回 400 + `{"code": 40001, "message": "请上传证书扫描件"}`
- **userId 引用校验**：`PERSONNEL_CERT` 创建/更新时，调用 `prisma.user.findUnique({ where: { id: userId, status: 'ACTIVE', deletedAt: null } })`，不存在或非 ACTIVE 返回 400 + `{"code": 40002, "message": "员工不存在或已停用"}`
- **serviceType 字典校验**：`TEMPLATE` 创建/更新时，若 `serviceType` 非空，校验它存在于 `Dictionary` 表中（`category = 'SERVICE_TYPE'`），不存在返回 400 + `{"code": 40003, "message": "服务类型无效"}`
- **状态计算**：`validTo` 为空时 `status = 'VALID'`（永久有效，不显示"即将过期"标签）；不为空时由现有 `lib/assets/status.ts` 计算 `VALID` / `EXPIRED`（沿用现状，**不**改）

### 4.3 错误码

新增 3 个错误码，复用现有 `{code, message}` 返回格式：

| code | message |
|---|---|
| 40001 | 请上传证书扫描件 / 请上传模板文件 |
| 40002 | 员工不存在或已停用 |
| 40003 | 服务类型无效 |

## 5. 页面与路由

### 5.1 现有页面改动

| 路由 | 文件 | 改动 |
|---|---|---|
| `/assets` | `app/(app)/assets/page.tsx` | `subtitle` 改为 "标书素材库 · 统一管理资质 / 业绩 / 团队 / 案例 / 模板 / 证书"；其他不变 |
| `/assets/list` | `app/(app)/assets/list/page.tsx` | 筛选器加 `PERSONNEL_CERT` / `TEMPLATE` 两个 chip |
| `/assets/new` | `app/(app)/assets/new/page.tsx` | `AssetTypePicker` 加 2 张卡片（icon：`SafetyCertificateOutlined` / `FileTextOutlined`） |
| `/assets/[id]` | `app/(app)/assets/[id]/page.tsx` | `AssetTypeRenderers` 加 PERSONNEL_CERT / TEMPLATE 渲染分支 |
| `/assets/[id]/edit` | `app/(app)/assets/[id]/edit/page.tsx` | 复用 `AssetTypeFields` 新加的组件 |

### 5.2 新增组件（`components/assets/`）

**`asset-type-picker.tsx`** 新增 2 个 `ASSET_TYPE_ITEMS`：

```ts
{ value: "PERSONNEL_CERT", label: "人员证书", icon: SafetyCertificateOutlined, desc: "员工持证 / 个人证书" },
{ value: "TEMPLATE",        label: "投标模板", icon: FileTextOutlined,         desc: "投标函 / 报价单 / 授权书" }
```

**`asset-type-fields.tsx`** 新增 2 个组件 + 1 个新接入：

- `PersonnelCertFields` — UserPicker（按姓名 / 工号模糊搜索现有 `User` 表）+ 证书字段（编号 / 类型 / 颁发机构 / 有效期）+ **`PreviewableProFormUploadButton` 上传扫描件**（`customRequest: proCustomRequest({ assetId: editingAssetId ?? null })`）
- `TemplateFields` — **`PreviewableProFormUploadButton` 上传模板文件**（必填，`assetId` 同上）+ serviceType select（可选，来源 `useDict("SERVICE_TYPE")`）+ tags input（自由标签）
- 现有 8 类表单（如 `LicenseFields` / `CertificateFields` 等）也接入 `PreviewableProFormUploadButton`，把"扫描件"上传补齐

**`asset-type-renderers.tsx`** 新增 2 个渲染器：

- `PersonnelCertRenderer` — 员工头像 + 姓名 + 工号 + 证书类型 + 证书编号 + 颁发机构 + 有效期颜色（绿/黄/红）+ 扫描件下载按钮
- `TemplateRenderer` — 标签 chips + serviceType（如有）+ 模板文件名 + 大小 + 下载按钮

## 6. 数据字典扩展

新建 `Dictionary` 记录（category = `PERSONNEL_CERT_TYPE`）：

| code | name | sort | 备注 |
|---|---|---|---|
| `REGISTERED_SAFETY_ENGINEER` | 注册安全工程师 | 10 | |
| `SAFETY_EVALUATOR` | 安全评价师 | 20 | |
| `EMERGENCY_RESCUER` | 应急救援员 | 30 | |
| `TRAINING_INSTRUCTOR` | 培训师资 | 40 | |
| `SPECIAL_OPERATION` | 特种作业操作证 | 50 | |
| `OTHER` | 其他 | 999 | |

**注意**：`SERVICE_TYPE` 是现有字典，**不**新建；`TEMPLATE.attributes.serviceType` 引用现有 `SERVICE_TYPE`。

**Seed 集成**：把上述 6 条 `PERSONNEL_CERT_TYPE` 加入 `prisma/seed.ts`（系统管理数据），确保新机器 `npm run seed` 即生效。

## 7. 权限

沿用现有 `CompanyAsset` 权限（`lib/permissions.ts` 中的 `COMPANY_ASSET` 资源位），**不**新加角色 / 权限位：

| 角色 | COMPANY_ASSET |
|---|---|
| ADMIN | READ / CREATE / UPDATE / DELETE / EXPORT |
| SALES | READ / CREATE（自己）/ UPDATE（自己）/ EXPORT |
| FINANCE | — |
| OPS | — |

`PERSONNEL_CERT` 的特殊点：业务上"人员证书挂在某员工名下"，但权限位仍按"创建者 = ownerUserId"走 SALES 现有规则（**不**做"只有本人可改自己证书"的额外限制）。如果需要"本人可改自己证书"语义，留到 v2 单独 brainstorm。

**附件上传权限**：上传走 `/api/files/presign-upload` 已有的 `requireSession()` 鉴权 + `Attachment` 写入权限位。资产附件上传不引入新权限位，复用现有 `COMPANY_ASSET.UPDATE` 规则（创建前/编辑期上传都按当前用户有 `UPDATE` 权限放行，新建场景下 `assetId=null` 走"tmp/" 暂存路径，与现有 `invoiceId: null` 模式一致）。

## 8. 测试

### 8.1 单元测试（`tests/lib/`）

- `personnelCert-schema.test.ts`
  - 缺 `userId` → 校验失败
  - 缺 `certificateType` → 校验失败
  - 缺 `scanFileId` → 校验失败
  - 完整字段 → 校验通过
- `template-schema.test.ts`
  - 缺 `templateFileId` → 校验失败
  - `serviceType` 缺省 → 校验通过（可选字段）
  - `serviceType` 非空 + 字典中存在 → 校验通过
- `valid-to-status.test.ts`（如已存在则合并）
  - `validTo` 为空 → `status = 'VALID'`
  - `validTo` 已过 → `status = 'EXPIRED'`
  - `validTo` 30 天内 → `status = 'EXPIRED_SOON'`（沿用现状计算）
- `presign-upload-schema.test.ts`（**新增**）
  - body 包含 `assetId` → 通过
  - body 包含 `assetId` 但同时含 `contractId`/`invoiceId` → 通过（允许冗余，service 层按优先级取）
  - body 缺 `assetId`/`contractId`/`invoiceId`（都为 null） → 通过（沿用现状，tmp/ 路径）
  - 未登录调用 → 401（requireSession 触发）

### 8.2 集成测试（`tests/api/`）

- `asset-create-validation.test.ts`
  - `POST /api/assets` with `type=PERSONNEL_CERT` + 无 `userId` → 400 + code 40002
  - `POST /api/assets` with `type=PERSONNEL_CERT` + `userId` 指向 DISABLED User → 400 + code 40002
  - `POST /api/assets` with `type=PERSONNEL_CERT` + 无 `scanFileId` → 400 + code 40001
  - `POST /api/assets` with `type=TEMPLATE` + 无 `templateFileId` → 400 + code 40001
  - `POST /api/assets` with `type=TEMPLATE` + `serviceType='NONEXISTENT'` → 400 + code 40003
- `presign-upload-asset.test.ts`（**新增**）
  - `POST /api/files/presign-upload` 携带 `assetId=existingId` → 200，返回 `attachmentId` 且 `Attachment.assetId` 写入 `existingId`
  - 未登录调用 → 401
  - `POST /api/files/presign-upload` 携带 `assetId=nonExistent` → 422（service 层 Prisma 写入失败）或 400（增加预校验），待实施时定

### 8.3 E2E（`tests/e2e/`）

新加 `06-bid-asset-library.spec.ts`（沿用现有 5 套 E2E 命名风格 `NN-<flow>.spec.ts`）：

- 场景 A：录入人员证书 — 选员工 + 填证书字段 + 上传扫描件 + 保存 + 列表显示 + 详情显示 + 验证有效期颜色
- 场景 B：录入投标模板 — 上传文件 + 不填 serviceType（通用模板）+ tags 输入 + 保存 + 列表显示 + 列表 serviceType 筛选
- 场景 C：列表筛选 — 切换 `PERSONNEL_CERT` chip → 列表只显示证书类
- 场景 D（**新增**）：现有 8 类资产补齐上传入口 — 录入 `LICENSE` 营业执照 + 上传扫描件（PDF） + 保存 + 详情页显示"下载扫描件"按钮 + 点击下载成功

复用现有 `playwright.config.ts` 的 3 套视口（chromium / ipad-portrait / iphone-13），不新增项目。

## 9. 不兼容与风险

| 项 | 影响 | 缓解 |
|---|---|---|
| Prisma 枚举加值 | 非破坏性 | Prisma 7 默认允许，无需迁移 |
| 现有 8 类数据 | 不动 | `attributes` JSON 容器 forward-compatible |
| `PERSONNEL_CERT` 必填 `userId` | 限制"外聘专家证书"进库 | v1 不支持；v2 评估加 `externalName` 选项（参考 `TeamMemberFields`） |
| 菜单名沿用"企业资产" | 老用户路径无感 | subtitle 文案强调标书定位；v2 编制上线后再正式改名 |
| 现有 `PerformanceFields` 锁源 | v1 业绩 override 不可用 | v1 不做；如需 v2 评估 |
| `status` 字段语义冲突 | 沿用现有 `VALID/EXPIRED`，**不**加 `DRAFT/PUBLISHED` | v2 编制时再评估 |
| 附件上传越权（`attributes.scanFileId` 指向他人资产下的 attachment） | 看到/下载到不属于自己的附件 | service 层校验 `attachment.assetId === currentAsset.id`（见 §4.2）；单元 + 集成测覆盖 |
| 现有 `/api/assets/attachments/[id]/route.ts` 是空文件 | v1 顺手补 DELETE 接口，否则用户无法在前端删除上传错的附件 | 实施要点见 §11 step 7 |
| `PreviewableProFormUploadButton` 复用现有组件 | 已存在 2 处使用（合同 / 发票），无新增依赖 | 引用方式一致，零额外 bundle 成本 |
| 8 类表单接入上传涉及 `asset-form.tsx` 改动 | 现有资产录入流程回归面大 | 单元 + 集成 + E2E（场景 D）三层覆盖；改动限制在 form 渲染层，不动 service / data |

## 10. 附件上传子模块

v1 顺手补齐的附件上传能力，独立列一节，集中描述涉及的 3 个改动点。

### 10.1 后端

**`/api/files/presign-upload`**（`app/api/files/presign-upload/route.ts`）：

```ts
// 现有 bodySchema 仅接受 contractId / invoiceId
const bodySchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(127),
  size: z.number().int().positive(),
  contractId: z.string().optional().nullable(),
  invoiceId: z.string().optional().nullable()
  // v1 新增 ↓
  assetId: z.string().optional().nullable()
});
```

`presignUpload` service（`server/storage/presign.ts`）同步接受 `assetId`，写入 `Attachment.assetId`：

```ts
// server/storage/presign.ts
export async function presignUpload(opts: {
  filename: string;
  mimeType: string;
  size: number;
  contractId: string | null;
  invoiceId: string | null;
  uploadedById: string;
  // v1 新增 ↓
  assetId: string | null;
}): Promise<{ attachmentId: string; ... }> {
  // ...
  const attachment = await prisma.attachment.create({
    data: {
      objectKey,
      bucket,
      originalName: opts.filename,
      mimeType: opts.mimeType,
      size: opts.size,
      uploadedById: opts.uploadedById,
      contractId: opts.contractId,
      invoiceId: opts.invoiceId,
      assetId: opts.assetId   // 新增
    }
  });
  // ...
}
```

**`/api/assets/attachments/[id]`**（`app/api/assets/attachments/[id]/route.ts`）：现有文件 0 行，v1 顺手补 `DELETE` 方法：

```ts
// app/api/assets/attachments/[id]/route.ts
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const att = await prisma.attachment.findUnique({ where: { id } });
    if (!att || att.deletedAt) {
      throw new ApiError(ERROR_CODES.NOT_FOUND, "附件不存在", 404);
    }
    // 权限:有 COMPANY_ASSET.UPDATE 且 attachment 关联的 asset 在用户权限范围内
    if (!hasPermission(user, "COMPANY_ASSET", "UPDATE")) {
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

### 10.2 客户端

**`lib/upload-client.ts`**：扩展 `UploadOpts`：

```ts
// lib/upload-client.ts
export type UploadOpts = {
  contractId?: string | null;
  invoiceId?: string | null;
  assetId?: string | null;   // v1 新增
};

export async function uploadFileToMinIO(file: File, opts: UploadOpts = {}) {
  // ...
  body: JSON.stringify({
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    contractId: opts.contractId ?? null,
    invoiceId: opts.invoiceId ?? null,
    assetId: opts.assetId ?? null   // v1 新增
  })
  // ...
}
```

### 10.3 表单

**`components/assets/asset-form.tsx`**：在 8+2 类表单共用容器里接 `PreviewableProFormUploadButton`，统一从 form 上下文拿 `assetId`：

```tsx
// components/assets/asset-form.tsx (关键片段,非完整文件)
import { PreviewableProFormUploadButton as UploadButton } from "@/components/file/pro-form-upload-button";
import { proCustomRequest } from "@/lib/upload-client";

// 假设 formContext.assetId 由父表单提供;新建时为 null,编辑时为现有 asset.id
const assetId = formContext.editingAssetId ?? null;
const uploadCustomRequest = proCustomRequest({ assetId });

// 在 PersonnelCertFields / TemplateFields / LicenseFields / CertificateFields 等
// 各自的"扫描件 / 附件"表单项里使用:
<UploadButton
  name="scanFileId"          // 或 templateFileId / 现有 8 类各自的附件字段名
  label="证书扫描件"
  max={1}
  customRequest={uploadCustomRequest}
  // ... 复用现有合同 / 发票页面的 props
/>
```

新建场景下 `assetId=null`，落到 `Attachment.assetId=null`（沿用 `invoiceId=null` 模式）；`createAsset` 成功后由 service 层把 `tmp/` 路径下的 attachment 回填 `assetId`（实施细节，实施期补；如果暂未实现，新建的 attachment 在 `attributes` 里的 `scanFileId` / `templateFileId` 字符串暂时找不到对应 attachment，service 层校验会失败——这是实施期需要补的 service 逻辑）。

> **实施注**：v1 实施时需要在 `createAsset` 成功后用 `prisma.attachment.updateMany({ where: { id: { in: [scanFileId, templateFileId] }, assetId: null }, data: { assetId: newAsset.id } })` 把新建前上传的 attachment 回填。这条不展开为代码，留到实施期在 `server/services/assets/create-asset.ts` 中实现。

## 11. 实施计划要点

实施阶段由 writing-plans 技能生成详细 plan，此处只列高层步骤：

1. `prisma/schema.prisma` 加 2 个 enum 值；运行 `npm run prisma:migrate` 生成 migration
2. `prisma/seed.ts` 加 `PERSONNEL_CERT_TYPE` 6 条字典；运行 `npm run seed`
3. `lib/validators/assets.ts` 新加 2 个 Zod schema
4. **附件上传子模块**（见 §10）：
   - `app/api/files/presign-upload/route.ts` 的 `bodySchema` 加 `assetId` 字段
   - `server/storage/presign.ts` 接受并写入 `assetId`
   - `lib/upload-client.ts` `UploadOpts` 加 `assetId`
   - `app/api/assets/attachments/[id]/route.ts` 补 `DELETE` 方法
5. `server/services/assets/` 在 `createAsset` / `updateAsset` 加 type 路由 + 3 个错误码 + `Attachment.assetId` 越权校验 + 新建后回填 `assetId`
6. `components/assets/asset-form.tsx` 接 `PreviewableProFormUploadButton`（所有 8+2 类附件入口统一）
7. `components/assets/asset-type-picker.tsx` 加 2 张卡片
8. `components/assets/asset-type-fields.tsx` 加 `PersonnelCertFields` / `TemplateFields`
9. `components/assets/asset-type-renderers.tsx` 加 2 个渲染器
10. `app/(app)/assets/page.tsx` 改 subtitle
11. `app/(app)/assets/list/page.tsx` 加 chip 筛选
12. 单元 / 集成 / E2E 测试（含 §8.1 / §8.2 / §8.3 全量覆盖）
13. `npm run typecheck` / `lint` / `test` / `test:e2e` 全绿

## 12. 开放问题（v2 评估）

- 标书编制 / 导出 / 一键引用的产品形态
- 业绩 override 字段解锁 vs 现有锁源逻辑的取舍
- 状态字段 `DRAFT/PUBLISHED` 是否需要
- 人员证书的"本人可改"语义
- 后台 job 到期提醒的必要性
- 是否在 v2 编制时把"企业资产"菜单改名为"标书素材库"

---

**Spec 维护说明**：本文档是 v1 brainstorm 阶段的产物，实施过程中如发现需要偏离，应回头更新本文档并注明"实施期调整"。
