# 权限矩阵审计报告 — 2026-08-02

> 配套变更: v0.18.0 — 4 个非 ADMIN 角色的权限重排 + 3 处 service 守门加固.
> 详见 [CHANGELOG.md v0.18.0](../../../CHANGELOG.md).

## 1. 审计范围与方法

- 拉取所有 `requirePermission` / `hasPermission` 调用点 (47 个文件)
- 梳理前端菜单 (`components/dashboard-shell.tsx`) 与 `<Authority>` 用法
- 梳理 service 层额外的 `roleCode ===` 硬护栏
- 与 USER_MANUAL.md / DESIGN-v3.md / CHANGELOG 中既有矩阵描述对账

## 2. 单点真理源

- `lib/permissions.ts#ROLE_PERMISSIONS` 是唯一真理源
- 经 `lib/auth.ts:310` 写进 JWT
- 前端 `session.user.permissions` 推下去; `<Authority>` / `filterMenu` 都消费
- 服务端 `requirePermission` 在每个 service 入口守门

## 3. 既有的额外硬护栏 (service 矩阵之外的兜底)

| 文件:行 | 强制 |
|---|---|
| server/services/contract/crud.ts:507 | 软删合同 ADMIN only |
| server/services/contract/status.ts:19 | 强制发布 ADMIN only |
| server/services/contract/status.ts:54 | 重开 review (MANUAL) ADMIN only |
| server/services/contract/reopen.ts:54 | 强行 reopen ADMIN only |
| server/services/payment.ts:245 | confirm/reconcile/refund FINANCE+ADMIN |
| server/services/invoice/action.ts:93 | issue/reject/void/redo FINANCE+ADMIN |
| server/storage/presign.ts:115 | 附件上传 owner+signer+FINANCE+ADMIN |
| server/services/customer/crud.ts:152 | SALES/EXPERT 不能改 ownerUserId |
| server/services/contract/crud.ts:250 | 同上(合同) |

## 4. v0.18.0 落地项

### 4.1 矩阵调整 (lib/permissions.ts)
- DUNNING:
  - SALES: CRUD → CR (drop UPDATE + DELETE)
  - EXPERT: CRUD → CR (同上)
  - FINANCE: CRU → CRUD (新增 DELETE)
- EXPERT.INVOICE: CRU+EXPORT → R+EXPORT (drop CREATE + UPDATE + DELETE)

### 4.2 service 入口加固
- `server/services/trash.ts: getTrashList` / `restoreRecord` 增加 `roleCode === "ADMIN"` 强校验
- `server/services/announcement.ts: updateAnnouncement` / `softDeleteAnnouncement` 增加 `publishUserId === actor.id || roleCode === "ADMIN"` 校验
- `server/storage/presign.ts: assertCanAttachToTarget` 加注释明确 OPS 不在白名单

### 4.3 死代码清理
- `lib/permissions.ts` 删 `ACTION.AUDIT`
- `components/admin/permission-matrix.tsx` 同步去列

## 5. 已检过但确认无误的点

- **MESSAGE 服务**: 所有读/写/删入口 (`listMessages` / `markRead` / `markAllRead` / `countUnreadMessages` / `deleteMessage` / `clearReadMessages`) 都已在 where 上挂 `receiverUserId: user.id`. 矩阵外的 site 已受 service 卡住, 无 service 改动需要.
- **FINANCE.CUSTOMER**: 矩阵 `[R, EXPORT]`, 客户列表 `listCustomers` 用 `ownerEq(user)`, 对 FINANCE 返回空对象 — 实际全公司列表可见, 与矩阵相符.
- **OPS.CUSTOMER.金额字段**: 矩阵 OPS CUSTOMER 是 CRU+EXPORT; service 内已按之前 P1 注释显式过滤金额, 不动 service 层.

## 6. 拒绝落地的请求

- **EXPERT 是否改成 0 商业权限** (只保留 CUSTOMER/CONTRACT): 仅收掉了 INVOICE 商业发起, PAYMENT 仍保留 C+R (登记回款, 非财务流转), DUNNING 仍保留 C+R (现场进度). 理由: EXPERT "现场交付" 场景下要登记回款催收可能相关, 完全砍会阻塞交付报告链路.

## 7. 兼容性影响

| 角色 | 受影响能力 |
|---|---|
| SALES | 不能 DELETE / UPDATE 催收 (客户合同开票回款不变); 通过 `<Authority>` 自动隐藏按钮 |
| EXPERT | 不能 UPDATE/DELETE 催收; **不能 CREATE/UPDATE/DELETE 开票**; EXPORT 仍保留 |
| FINANCE | 催收可 DELETE |
| OPS | 编辑/删除他人公告 → 403; 跨用户改/删公告行为阻断 |
| 任何人 | 直接 GET /api/admin/trash → 403 (除 ADMIN 外) |

## 8. 已通过的验证

- `npx tsc --noEmit` — 通过
- `npx eslint <files>` — 零警告
- `npx vitest run` — 85 文件 / 653 用例全过
  - 新增 5 个 trash admin-only 用例 (全过)
  - 新增 3 个 announcement 跨用户用例 (全过)
  - 调整 1 个 EXPERT INVOICE 权限断言 (改为期望 false)
  - 调整 dunning UPDATE/DELETE 用例 (角色切换到 FINANCE)
  - 调整 announcement update/delete 用例 (改用 OPS 作为发布人)
