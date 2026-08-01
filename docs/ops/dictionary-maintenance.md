# 数据字典维护说明(v0.18.0+)

> 数据字典的"唯一定义源"在 `scripts/shared/dict-defs.ts` 的 `DICT_DEFS` 数组。`prisma/seed.ts`(开发全量 seed)与 `scripts/shared/seed-dicts.ts`(生产轻量 seed)均从这里 import,不再双份维护。

## 一、字典的两种用途

| 类别 | 用途 | 消费方 | 维护方式 |
|---|---|---|---|
| **业务字典**(行业/规模/来源/服务类型/跟进方式/学历/合同类型等) | admin 在 `/admin/dictionaries` 维护,前端下拉 `useDict` 拉取 | 客户/合同/员工表单 | 通过 UI 加/停/改 label,业务实时跟随(同标签页即时,跨标签页需刷新) |
| **枚举约束类目**(客户类型/客户规模/合同付款方式/发票类型/收款方式/审批动作/合同状态/开票状态/回款状态) | code 由 `lib/enum-maps.ts` 枚举或状态机硬编码约束;字典表**只读展示** | PDF/状态徽章/前端兜底映射 | **不再通过字典页维护**:字典页锁定 UI,service 拒写(403) |

**为什么锁定 9 类枚举约束类目**:这 9 个类目的 code 被业务 zod 校验或状态机代码硬约束,即便能在字典页改 label/sort,业务读取依然按枚举值兜底(`lib/enum-maps.ts` 的 `*_MAP`),改字典不生效反而误导。把它们在 UI 上锁定为「只读展示」+ service 拒写是**最克制**的处理;彻底字典化仍是未来项(见 §六)。

## 二、16 类白名单

`lib/dictionary-categories.ts` 的 `ALLOWED_DICTIONARY_CATEGORIES` 决定哪些 category 可以出现在 `/admin/dictionaries` 侧栏、用于 `useDict` 与字典写入(只读 9 类也在列 — 只读只是禁写,类目全集不变)。

| 业务域 | 类目(只读标 🔒) |
|---|---|
| 客户域 | CUSTOMER_TYPE 🔒、CUSTOMER_SCALE 🔒、CUSTOMER_INDUSTRY、CUSTOMER_SOURCE |
| 业务域 | SERVICE_TYPE、FOLLOW_METHOD、FOLLOW_RESULT、CONTRACT_TYPE、EDUCATION_LEVEL |
| 财务域 | CONTRACT_PAYMENT_METHOD 🔒、INVOICE_TYPE 🔒、PAYMENT_RECEIVE_METHOD 🔒、REVIEW_ACTION 🔒 |
| 状态域 | CONTRACT_STATUS 🔒、INVOICE_STATUS 🔒、PAYMENT_STATUS 🔒 |

> PERSONNEL_CERT_TYPE **不在白名单**(预留人员证书模块),仅经 legacy `?category=` 分支可读;UI 侧栏不展示。

## 三、单点真理(权威)

**`scripts/shared/dict-defs.ts` 导出 `DICT_DEFS: readonly DictDef[]`**。所有 16 类的 seed 数据都在这里(去掉了已下线的 `CUSTOMER_STATUS` 与从未进白名单的 `PROJECT_STATUS`)。`prisma/seed.ts` 与 `scripts/shared/seed-dicts.ts` 均 import 此文件,不再独立维护副本。

## 四、修改字典条目流程

### 1. 改 label / 排序(常用,业务字典)

直接进 `/admin/dictionaries` 改,**不需要改代码**。前端 `useDict` 同标签页立即跟随(`refreshDict` 触发 SWR mutate);PDF / 状态徽章仍读 `lib/enum-maps.ts` hardcode(若想 PDF 也跟随,改 `lib/enum-maps.ts`)。

### 2. 加新条目(常用,业务字典)

直接进 `/admin/dictionaries` 选对应类目,"新增字典项"填 code + label + sort + 父级(树形类)即可。**CODE 一旦填不可改**(code 是数据库唯一键),**改名需要新建**。

> **code 正则**:`/^[A-Z][A-Z0-9_.]*$/`(允许点号,与存量树形 code 如 `R2.30` 对齐)。不要用全小写或中划线/下划线起始的 code。

### 3. 加新类目(罕见)

需要改 **3 处**(v0.18.0+ 起):

1. `scripts/shared/dict-defs.ts` 的 `DICT_DEFS` 加条目
2. `lib/dictionary-categories.ts` 的 `ALLOWED_DICTIONARY_CATEGORIES` 数组加类目名 + `DICTIONARY_CATEGORY_LABEL` 加中文标签
3. `lib/dict-domain.ts` 的 `DICT_META` 加元数据(UI 形态 / 是否只读 / 域),`CATEGORY_DOMAIN_MAP` 加域映射;若为新域,`DICT_DOMAINS` 数组加新域

### 4. 删条目(谨慎)

- **不能硬删**(被历史业务数据引用,删了会留悬空)
- 走"软停用":admin 字典页 `isActive=false`,前端 `useDict` 默认不返回停用项(可勾选"包含停用")
- 历史数据不受影响,后端读字典不影响(读全表)
- 真要彻底删,先 SQL 找引用记录,确认无引用后再删

## 五、生产部署顺序

```bash
# 1) 数据库迁移
npx prisma migrate deploy

# 2) 角色 (5 角色,与 lib/permissions.ts 同源)
pnpm seed-roles

# 3) 字典 (16 类白名单,与 scripts/shared/dict-defs.ts 同源)
pnpm seed-dicts

# 4) 部门 + 字典 + 9 类工作流模板 (一站式)
pnpm seed

# 5) 创建管理员
pnpm create-admin -- --employeeNo admin --name "系统管理员" --email admin@example.com --password '<强密码>'
```

## 六、状态机硬编码迁移 TODO(已知限制)

`lib/enum-maps.ts` 的 `*_MAP`(`CONTRACT_STATUS_MAP` / `INVOICE_STATUS_MAP` / `PAYMENT_STATUS_MAP` / `INVOICE_TYPE_MAP` / `REVIEW_ACTION_MAP` 等)目前 hardcode,PDF 路由/状态徽章/前端兜底直接 import。`CUSTOMER_STATUS_MAP` 已 v0.5.0 移除,`PROJECT_STATUS_MAP` 早于 v0.5.0 移除。

**v0.18.0 进度**:不替换 hardcode(影响面太大),而是把这 9 个枚举约束类目在字典表里标记「只读展示」+ service 拒写,避免后台误操作后业务不跟进而产生的误导。本方案是阶段性产物,**彻底字典化仍是未来项**:
- import 改成 `useDict("CONTRACT_STATUS")` 等
- 保留 `lib/enum-maps.ts` 但只放"业务强约束"(如 `WORKFLOW_*` 系列,因为工作流引擎强依赖)
- 涉及数十个文件的 import 改造,**分多个 commit**,每个类目一组,渐进迁移

## 七、缓存机制与已知限制

- `useDict(category)` 模块级 SWR 缓存(key=`dict-{category}`),初始为空数组,首次 mount 后 `mutate` 从 `/api/dictionaries?category=...` 拉取
- admin 字典页新增/编辑/启停/批量后调用 `refreshDict(category)` → `mutate(...)` 通知**同标签页**所有挂载 `useDict` 的组件重新拉取,即刻生效
- **跨标签页不广播**:其他已打开的标签页需手动刷新(已知限制)
- 后端字典表 `Dictionary.upsert` 在 `prisma/seed.ts` 与 `seed-dicts.ts` 同步;`cacheVersion` 在 seed 时递增,运维手动改 DB 后用 `pnpm dict-bump-cache` 强制失效所有客户端缓存
