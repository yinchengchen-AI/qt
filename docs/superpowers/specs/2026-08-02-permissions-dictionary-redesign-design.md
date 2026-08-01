# 角色权限重排 + 数据字典优化 设计文档

日期：2026-08-02
状态：已通过 brainstorming 评审，待实现

## 背景与动因

1. **权限**：v0.18.0 权限审计后 SALES/FINANCE 配置基本符合岗位实际，但 EXPERT ≈ SALES(仅差发票创建)、OPS 可写客户资料(还要 service 层特殊过滤金额字段),两处不符合"按岗位分工"的最佳实践。另发现 `/admin/roles` 页面可编辑角色权限并存入 DB `Role.permissions`,但运行时只读 `lib/permissions.ts` 硬编码矩阵——**编辑根本不生效**,是纯误导功能。
2. **数据字典**：最大问题是双轨制——多数类目的 code 被 `types/enums.ts` 硬编码枚举 + zod 校验 + `lib/enum-maps.ts` label map 约束,在字典页改条目**不生效或被后端拒绝**;另有 4 个实锤 bug、种子双源漂移、缓存无失效机制。

## 范围

- 做:4 个非 ADMIN 角色矩阵重排;`/admin/roles` 只读化;字典状态机/枚举类防误导只读化;4 个字典 bug;种子合一;字典缓存失效;相关测试与文档同步。
- 不做(YAGNI):DB 驱动动态权限;自定义角色支持;状态机类彻底字典化(动 30+ 文件);字典跨标签页缓存广播;拖拽排序前端(reorder API 继续闲置);OPS 的员工管理写权限(保留给 ADMIN)。

## §1 权限矩阵重排(`lib/permissions.ts`)

原则:SALES/FINANCE 不动;EXPERT 与 SALES 的分工线划在"钱"上;OPS 的写权限收回到组织协同域。

### SALES 业务人员(不变)

行级隔离(仅本人客户/合同,`lib/ownership.ts`)。客户/合同 CRU+导出、发票 CRU+导出(发起开票)、回款 CR+导出(登记,财务确认)、催款 CR、统计 R、消息 CRUD、公告/部门/员工/字典/更新日志 R。

### EXPERT 技术专家(收紧 2 处)

定位:类似销售,跟进自己的客户和合同(保留行级隔离),但不管钱。

| 资源 | 现状 | 改为 | 理由 |
|---|---|---|---|
| PAYMENT | CR+EXPORT | **R+EXPORT** | 登记回款是商务/财务动作;专家只需查看自己合同的回款进度,保留导出用于对账 |
| DUNNING | CR | **R** | 催款记录由业务/财务写;专家只需看到客户处于催款状态 |

其余与 SALES 一致(客户/合同 CRU+导出、发票 R+导出、统计 R、消息 CRUD)。`lib/permissions.ts:94` 的角色注释同步改写。

### FINANCE 财务人员(不变)

全行可见。发票/回款 CRUD+导出、统计 R+导出、催款 CRUD、客户/合同 R+导出、消息 CRUD。

### OPS 行政人员(收紧 1 处)

| 资源 | 现状 | 改为 | 理由 |
|---|---|---|---|
| CUSTOMER | CRU+EXPORT(金额字段 service 层过滤) | **R+EXPORT** | 客户资料的 owner 是销售;行政不录入客户。同步清理 `server/services/customer/crud.ts` 中为 OPS 写的金额字段特殊过滤逻辑(若已无其他消费方) |

OPS 保留写权限域:部门 CRUD、公告 CRUD(行政本职);合同/发票/回款 R+导出(查阅归档)、统计 R、催款 R、消息 CRUD。

### §1.1 `/admin/roles` 只读化

- 页面改为只读矩阵展示:渲染 `ROLE_PERMISSIONS` 的当前状态(5 角色 × 14 资源),顶部说明"权限由系统内置(代码矩阵),如需调整请联系开发"。
- 移除 `components/admin/permission-matrix.tsx` 的编辑/保存交互;`server/services/role.ts` 中针对内置角色的权限写接口改为返回 403(提示权限由代码定义);自定义角色创建入口一并禁用(运行时 `ROLE_PERMISSIONS[roleCode]` 对未知 code 会崩)。
- DB `Role.permissions` 字段保留,继续由 `scripts/shared/seed-roles.ts` 从代码矩阵同步,仅作展示用途。
- 权限真源保持在代码:可评审、可测试、随版本发布。

### §1.2 连带更新

- `tests/permissions.test.ts`(EXPERT/OPS 断言)、`tests/menu-filter.test.ts`、`tests/e2e/04-ops-flow.spec.ts`(若涉及客户创建);
- 文档:`docs/user/USER_MANUAL.md` §3.2 角色矩阵表、§12.2(角色编辑生效的描述需改为只读说明)、`docs/architecture/DESIGN-v3.md` §3.2;
- `scripts/shared/seed-roles.ts` 若直接引用矩阵则自动同步,需确认。

## §2 数据字典优化

### §2.1 枚举约束类只读化(防误导,核心)

经核实,16 类白名单中以下 **8 类** 的 code 被硬编码约束(zod `z.enum` / 状态机 / `lib/enum-maps.ts` label map),字典页修改不生效或被后端拒绝:

- 状态机类:CONTRACT_STATUS、INVOICE_STATUS、PAYMENT_STATUS
- zod 枚举类:CONTRACT_PAYMENT_METHOD(`lib/validators/contract.ts:35`)、INVOICE_TYPE(`invoice.ts:21`)、PAYMENT_RECEIVE_METHOD(`payment.ts:7`)、CUSTOMER_TYPE(`customer.ts:13`)、CUSTOMER_SCALE(`customer.ts:15`)
- 硬编码动作枚举:REVIEW_ACTION(`types/enums.ts:49`)

剩余 7 类为真字典驱动,保持可改:CUSTOMER_INDUSTRY、CUSTOMER_SOURCE、FOLLOW_METHOD、FOLLOW_RESULT、SERVICE_TYPE、EDUCATION_LEVEL、CONTRACT_TYPE。

实现(复用现有 `DICT_META.readonly` 机制,目前仅 REGION 使用):

1. `lib/dict-domain.ts`:上述 8 类 `readonly: true`,description 注明"由代码枚举/状态机约束"。**注意**:`BUSINESS_CATEGORIES`(`dict-domain.ts:97`)当前按 `readonly !== true` 过滤,翻转 8 类后会从 16 类缩到 7 类——必须把它改为直接派生自 `ALLOWED_DICTIONARY_CATEGORIES`(其注释本就承诺与白名单一致),保证前端类目列表/新增下拉的类目全集不变,只读只是禁写。
2. 前端字典页:readonly 类目沿用锁图标;新增/编辑/启停/批量按钮禁用;类目头显示说明横幅"此类目由系统枚举/状态机控制,仅供查看,调整需改代码"。表格行的启用 Switch 对 readonly 类目禁用。
3. 后端兜底:`server/services/dictionary.ts` 的 create/update/softDisable/reorder 对 readonly 类目抛 403(扩展 `assertAllowedCategory` 或新增 `assertWritableCategory`),不只靠前端藏按钮。`lib/dict-domain.ts` 在 server 端 import 无客户端依赖,可直接复用 `DICT_META`。

### §2.2 修 4 个实锤 bug

1. `app/(app)/contracts/[id]/page.tsx:179` `useDict("PAYMENT_METHOD")` 幽灵类目(正确名 CONTRACT_PAYMENT_METHOD)——该调用永远返回空数组且页面有 `PAYMENT_METHOD_MAP` 兜底,删除死代码。
2. `DictEditDrawer.tsx:31` 用 `dict.code` 查 `DICT_META` 判断 readonly(恒为 false,REGION 只读可被 PATCH 绕过)——改用 `dict.category`。
3. code 正则三处不一致(后端 zod `/^[A-Z][A-Z0-9_]*$/` vs 前端允许点号 vs 测试复刻版允许点号)——以后端为准但**放宽允许点号** `/^[A-Z][A-Z0-9_.]*$/`(向后兼容,兼容可能存在的存量带点 code),前端正则同步;`lib/validators/dictionary.ts` 注释说明。
4. `server/services/dictionary.ts` 顶部"15 类白名单"过时注释更正为 16 类;`lib/dictionary-categories.ts:1` 注释同步。

### §2.3 种子双源合一

- 新建 `scripts/shared/dict-defs.ts` 为唯一定义源,`prisma/seed.ts:79-217` 与 `scripts/shared/seed-dicts.ts` 均改为 import。
- 清理:删除已废弃的 CUSTOMER_STATUS(v0.5.0 已出白名单)、白名单外的 PROJECT_STATUS;对齐两处 SERVICE_TYPE label 漂移("安全咨询" vs "管理咨询",以 `types/enums.ts` + `SERVICE_TYPE_MAP` 为准)。
- 只读类目仍在种子中(状态机展示需要),但种子是展示数据不是约束源,文档中说明。

### §2.4 缓存失效

- `lib/dict-client.ts` 已有 `refreshDict(category)` 但无人调用。admin 字典页所有写操作(新增/编辑/行内启停/批量启停)成功后调用 `refreshDict(category)`,使其他组件的 `useDict` 模块级缓存立即重拉。
- 跨标签页广播不做,在 `docs/ops/dictionary-maintenance.md` 注明已知限制。

### §2.5 测试修复与补充

- `tests/lib/dict-create-schema.test.ts`:从"复刻 schema"改为 import `lib/validators/dictionary.ts` 真实 schema;同步删除已废弃类目用例。
- `tests/api/dict-tree.test.ts`:从复刻逻辑改为 import 路由内 `buildDictTree` 真实实现(需先把该函数提取到可 import 的模块,如 `lib/dict-tree.ts`,路由引用之)。
- 新增 service 层用例:readonly 类目写入被拒绝(403)、非白名单类目仍被拒绝。
- 权限矩阵改动同步:`tests/permissions.test.ts` EXPERT(PAYMENT 无 CREATE、DUNNING 仅 R)、OPS(CUSTOMER 仅 R+EXPORT)断言;`tests/menu-filter.test.ts` 无需变(菜单门控不变);检查 `tests/e2e/04-ops-flow.spec.ts` 是否依赖 OPS 写客户。

### §2.6 文档同步

- `docs/ops/dictionary-maintenance.md`:类目表更正(删 PROJECT_STATUS、补 EDUCATION_LEVEL/CONTRACT_TYPE)、标注 8 类只读及原因、缓存限制说明、"加新类目需改 N 处"清单更新(种子已合一)。
- `docs/user/USER_MANUAL.md` §12.4:说明只读类目行为。
- `server/services/dictionary.ts` 与 `lib/dict-domain.ts` 顶部注释更新。

## 错误处理

- readonly 类目写入:后端 `ApiError(FORBIDDEN, "该类目由系统枚举控制, 不可修改", 403)`;前端按钮禁用,不依赖错误提示。
- 权限收窄后(EXPERT 回款/催款、OPS 客户):存量用户 session 由 `roleVersion` 机制失效重登或自然过期;前端按钮经 `<Authority>` 自动隐藏,直接调 API 由 `requirePermission` 拒 403。
- OPS 客户金额过滤逻辑删除前需确认无其他角色路径依赖。

## 验证

- `npm run typecheck` + `npm run lint` + `npm test` 全绿;
- `npm run test:e2e` 重点跑 04-ops-flow 及权限相关 spec;
- 手动:admin 字典页确认 8 类只读(锁+横幅+按钮禁用)、7 类可改且改完其他页面下拉即时刷新;EXPERT/OPS 账号登录验证收窄后的菜单与按钮。

## 发布

按 AGENTS.md 闭环:测试通过 → 更新 CHANGELOG/README 最近更新 → `npm version` bump → commit/push → `scripts/prod/deploy.sh` 部署。
