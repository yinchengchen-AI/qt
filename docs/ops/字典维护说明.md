# 数据字典维护说明

> 数据字典的"单点真理"在 `prisma/seed.ts` 的 `dictDefs` 数组,所有其他位置(前端 / 业务下拉 / 状态机 label)都从这里派生。

## 一、字典的两种用途

| 类别 | 用途 | 消费方 | 维护方式 |
|---|---|---|---|
| **业务字典**(行业/规模/来源/服务类型等) | admin 在 `/admin/dictionaries` 维护,前端下拉 `useDict` 拉取 | 客户/合同/资产表单 | 通过 UI 加/停/改 label,业务实时跟随 |
| **状态机字典**(客户状态/合同状态/项目状态/发票状态/回款状态/审批动作/付款方式/发票类型) | 后端 `lib/enum-maps.ts` hardcode + 字典并行,前端 PDF / 状态徽章用 hardcode,下拉用 `useDict` | PDF 路由 / 状态徽章 / 下拉选择 | 通过代码改 hardcode(立即生效)+ 同步字典(UI 拉取有数据) |

**注意**:状态机字典**目前没把 hardcode 全替换成 `useDict`**(32 个文件 import `lib/enum-maps.ts`),这一期是**补全字典数据**,不替换 hardcode。如果未来要把状态机从 hardcode 迁到字典,要:
1. 业务代码全改 `useDict` 拉
2. `lib/enum-maps.ts` 的 8 个 `*_MAP` 标记 deprecated
3. 完全去除 hardcode

## 二、16 类白名单

`lib/dictionary-categories.ts` 的 `ALLOWED_DICTIONARY_CATEGORIES` 决定哪些 category 可以被业务写入(seed 写 / 字典 API 写)。

| 业务域 | 类目 |
|---|---|
| 客户域 | CUSTOMER_TYPE, CUSTOMER_SCALE, CUSTOMER_INDUSTRY, CUSTOMER_SOURCE |
| 业务域 | SERVICE_TYPE, FOLLOW_METHOD, FOLLOW_RESULT |
| 财务域 | CONTRACT_PAYMENT_METHOD, INVOICE_TYPE, PAYMENT_RECEIVE_METHOD, REVIEW_ACTION |
| 状态域 | CONTRACT_STATUS, INVOICE_STATUS, PAYMENT_STATUS, PROJECT_STATUS |

## 三、单点真理(权威)

**`prisma/seed.ts` 顶部的 `dictDefs` 数组**。所有 16 类 + 1 类 PERSONNEL_CERT_TYPE 的 seed 数据都在这里。

`scripts/shared/seed-dicts.ts` 是**生产部署用脚本**(`pnpm seed-dicts`),内容是 dictDefs 的**子集**(只放生产字典下拉需要的类目,跟 prisma/seed.ts 保持一致;旧版有 6 类不一致,补全后 105 条)。

## 四、修改字典条目流程

### 1. 改 label / 排序(常用)

直接进 `/admin/dictionaries` 改,**不需要改代码**。前端 `useDict` 立即跟随,PDF 仍读 `lib/enum-maps.ts` hardcode(若想 PDF 也跟随,改 `lib/enum-maps.ts`)。

### 2. 加新条目(常用)

直接进 `/admin/dictionaries` 选对应类目,"新增字典项"填 code + label + sort + 父级(树形类)即可。**CODE 一旦填不可改**(code 是数据库唯一键),**改名需要新建**。

### 3. 加新类目(罕见)

需要改 4 处:
1. `prisma/seed.ts` 的 `dictDefs` 加条目
2. `scripts/shared/seed-dicts.ts` 同步加
3. `lib/dictionary-categories.ts` 的 `ALLOWED_DICTIONARY_CATEGORIES` 数组加类目名 + `DICTIONARY_CATEGORY_LABEL` 加中文标签
4. `lib/dict-domain.ts` 的 `DICT_META` 加元数据(UI 形态 / 是否只读 / 域),`CATEGORY_DOMAIN_MAP` 加域映射
5. (可选) `lib/dict-domain.ts` 的 `DICT_DOMAINS` 数组加新域

如果新类目**不是状态机**(纯业务字典,比如新的客户细分行业),第 1-5 步即可。

如果新类目是**状态机**(走 enum-maps 路径),还要:
- 改 prisma schema 对应字段,加 `// XXX | YYY | ZZZ` 注释
- 改 `lib/enum-maps.ts` 加 `*_MAP` 或扩展现有 MAP
- 改 `lib/status.ts` 的 `DOMAIN_MAP`(如果走 status tone)

### 4. 删条目(谨慎)

- **不能硬删**(被历史业务数据引用,删了会留悬空)
- 走"软停用":admin 字典页 `isActive=false`,前端 `useDict` 默认不返回停用项(可勾选"包含停用")
- 历史数据不受影响,后端读字典不影响(读全表)
- 真要彻底删,先 SQL 找引用记录,确认无引用后再删

## 五、生产部署顺序

```bash
# 1) 数据库迁移
npx prisma migrate deploy

# 2) 角色 (5 角色,与 prisma/seed.ts 同源)
pnpm seed-roles

# 3) 字典 (8 类业务 + 7 类状态机 = 105 条)
pnpm seed-dicts

# 4) 部门 + 字典 + 9 类工作流模板 (一站式)
pnpm seed

# 5) 创建管理员
pnpm create-admin -- --employeeNo admin --name "系统管理员" --email admin@example.com --password '<强密码>'
```

## 六、状态机硬编码迁移 TODO

`lib/enum-maps.ts` 的 `*_MAP`(CONTRACT_STATUS_MAP / INVOICE_STATUS_MAP / PAYMENT_STATUS_MAP / PAYMENT_METHOD_MAP / INVOICE_TYPE_MAP / REVIEW_ACTION_MAP / BILLING_STATUS_MAP / PAYMENT_PROGRESS_STATUS_MAP 等)目前是 hardcode,数十个文件 import。`CUSTOMER_STATUS_MAP` 与 `PROJECT_STATUS_MAP` 已分别在 v0.5.0 / 之前版本移除。

如果要把状态机全字典化,目标:
- import 改成 `useDict("CONTRACT_STATUS")` 等
- 保留 `lib/enum-maps.ts` 但只放"业务强约束"(如 WORKFLOW_* 系列,因为工作流引擎强依赖)
- 这需要先确认状态机字典与 prisma schema 注释完全一致(目前 CONTRACT_STATUS_MAP 多了 SUSPENDED,prisma schema 没列;以 schema 注释为权威)
- 涉及数十个文件的 import 改造,**分多个 commit**,每个类目一组,渐进迁移
