# 数据字典前端页面 重设方案

> 状态: 草案 v0.1, 等业务拍板
> 范围: 仅前端 (`app/(app)/admin/dictionaries/*` + `lib/dictionary-categories.ts` + 新建 `lib/dict-domain.ts`), 不动后端 / 模型 / 业务消费侧

## 一、当前问题

| # | 现状 | 痛点 |
|---|---|---|
| 1 | 16 类白名单字典装在**一个** ProTable | 找"安全咨询"得翻页 + 关键字搜,认知压力大 |
| 2 | 顶栏 Radio 切"表格 / 树视图 (REGION)" | 树只支持 REGION,其他类不支持;模式切换体验差 |
| 3 | 新增 Modal 字段平铺 5 个 (category/code/label/parentCode/sort) | 不分类型,所有类目走同一种表单 |
| 4 | 编辑 Drawer 只能改 label/sort/isActive | 改不了 code / category,误操作后无解 |
| 5 | 类目本身写死在 `lib/dictionary-categories.ts` | 没有"类目管理"概念,15 类变更要走代码 |
| 6 | 没有批量操作 | 启停要逐条点 |
| 7 | 没有"类目只读"保护 | 核心字典 (SERVICE_TYPE 等) 和业务字典混在一起,误改风险 |
| 8 | 移动端体验一般 | ProTable 复杂,小屏操作费劲 |

## 二、设计目标

1. **类目为核心** — 16 类一眼可见,选中类目看条目,不要"翻表找"
2. **高频操作 1 步到位** — 查 / 启停 / 编辑 <= 1 次点击
3. **树形/平铺按类目自动选 UI** — 不需要"模式切换"
4. **Drawer 替代 Modal** — 右侧滑出,操作流不打断列表浏览
5. **类目只读护栏** — 保护核心字典,避免误改
6. **响应式** — 桌面 Sider + 内容, 移动 Sider 收成下拉

## 三、新设计布局 (桌面)

```
+--------------------------------------------------------------------+
| PageHeader: 数据字典                              [+ 新增字典项]    |
| 业务字典管理 · 16 类 / 共 N 条 · 管理员可改                          |
+----------------------+---------------------------------------------+
| Sider (240px 可折叠) | Content                                     |
| -------------------- | ------------------------------------------- |
| [搜索类目 _________] | 类目头:                                      |
|                      |   SERVICE_TYPE  服务类型  . 6 条  . 可改     |
| v 客户域 (4)         |   --------------------------                |
|   客户类型    3      |   [关键字 ____] [包含停用] [批量启停]        |
|   客户规模    4      | --------------------------------------------- |
|   客户行业   18      |   +------------------------------------+    |
|   客户来源   12      |   | Table (或 Tree,按类目自动选)        |    |
|                      |   |  code  label  sort  启用  操作     |    |
| v 业务域 (3)         |   |  ...                                |    |
|   服务类型    6 .    |   |                                    |    |
|   跟进方式    5      |   |  分页 / 计数                       |    |
|   跟进结果    4      |   +------------------------------------+    |
|                      |                                              |
| v 财务域 (4)         |                                              |
|   合同付款方式 5     |                                              |
|   发票类型    5      |                                              |
|   收款方式    6      |                                              |
|   审批动作    5      |                                              |
|                      |                                              |
| > 状态域 (5)         |                                              |
+----------------------+---------------------------------------------+
```

Sider 项的 "." 标记 = 当前选中; 条目数实时显示; 类目按"域"折叠分组。

## 四、按类目自适应 UI

| 类目 | 形态 | 原因 |
|---|---|---|
| SERVICE_TYPE / CUSTOMER_* / PAYMENT_RECEIVE_METHOD 等 12 类 | **Table** | 平铺, 几十到几百条 |
| REGION | **Tree** | 树形(省/市/区/街道), 支持展开折叠 |
| 状态类 (CONTRACT_STATUS / INVOICE_STATUS / PAYMENT_STATUS / REVIEW_ACTION) | **Table (紧凑)** | 5-8 条, 无搜索, 直接展示 |

> 树形 vs 表格 在类目级别自动切换, 不在全页级别切换。

## 五、类目只读护栏

新增 `DICT_DOMAIN` 域元数据, 标记每个类目是否"系统核心":
- **可改** (12 类): CUSTOMER_TYPE / SCALE / INDUSTRY / SOURCE / SERVICE_TYPE / PAYMENT_RECEIVE_METHOD / FOLLOW_METHOD / FOLLOW_RESULT / CONTRACT_PAYMENT_METHOD / INVOICE_TYPE / 状态类 4 个
- **只读 (系统)** (1 类): REGION(由同步脚本管理, 不在 UI 编辑)
- **未来扩展** (按需): 标记某类只允许新增/不允许删除等

只读类目: 显示锁图标, Drawer 中"代码"和"分类"字段 disabled, "删除"按钮隐藏。

## 六、关键交互

### 新增 (Drawer 右滑)

```
+----------------------------------------+
| 新增字典项                       X     |
+----------------------------------------+
| 分类 *                                  |
| [Select 客户类型/客户规模/...]         |
|                                         |
| 代码 *   (树形类显示"父级代码"字段)     |
| [_______________]                       |
| 提示: 同分类内唯一, 大写字母/数字/_    |
|                                         |
| 标签 *                                  |
| [_______________]                       |
|                                         |
| 排序                                    |
| [_______]  默认 0, 大靠前              |
|                                         |
| (只读类: 额外提示条"系统字典, 不可...") |
+----------------------------------------+
|                       [取消]  [保存]   |
+----------------------------------------+
```

### 编辑 (Drawer 右滑)

字段: 分类 (只读 Tag) / 代码 (只读 Tag) / 标签 / 排序 / 启用 Switch。

### 启停 (行内 Switch + 批量)

- 行内 Switch 立即生效, 调 PATCH `/api/dictionaries/[id]`
- 顶部"批量启停"勾选模式: 勾选多行 -> 顶部出现"启用 N / 停用 N / 取消"工具条

### 树形类 (REGION)

- 节点展开/折叠
- 节点右侧 Hover 显示 "+子级" 按钮 -> 弹 Drawer, parentCode 自动填
- 节点拖拽改 sort (v2, 本轮不做)

## 七、文件结构

```
app/(app)/admin/dictionaries/
  page.tsx                    # 重写: Sider + Content 布局
  _components/
    DictCategorySider.tsx     # 新: 左侧类目列表 (按域分组)
    DictCategoryContent.tsx   # 新: 右侧类目详情 (头 + 搜索 + 表)
    DictEditDrawer.tsx        # 改造: 字段固定, code/category 只读
    CreateDictDrawer.tsx      # 新: 从原 CreateDictModal 改造, 右滑不打断
    DictTableView.tsx         # 新: 平铺类目表格
    DictTreeView.tsx          # 新: 树形类目 (REGION) 树
    DictBatchBar.tsx          # 新: 批量启停工具条

lib/
  dictionary-categories.ts    # 保留 + 扩展
  dict-domain.ts              # 新: 域分组 + 形态 + 是否可改 元数据
```

## 八、改动量估算

| 文件 | 改动 | 估计行数 |
|---|---|---|
| `page.tsx` | 重写 | 184 -> ~80 (只做 layout shell) |
| `DictCategorySider.tsx` | 新建 | ~120 |
| `DictCategoryContent.tsx` | 新建 | ~80 |
| `DictTableView.tsx` | 新建 | ~150 |
| `DictTreeView.tsx` | 新建 | ~120 |
| `DictEditDrawer.tsx` | 改造 | 95 -> ~110 |
| `CreateDictDrawer.tsx` (原 Modal) | 改造 | 126 -> ~140 |
| `DictBatchBar.tsx` | 新建 | ~50 |
| `lib/dict-domain.ts` | 新建 | ~80 |
| `lib/dictionary-categories.ts` | 扩展 | +20 |
| **合计** | | **~950 行** |

## 九、验收标准

1. 桌面端 16 类全部用新 layout, 无样式回退
2. 选中类目切换 < 100ms (SWR 缓存)
3. CRUD 全通: 新增 / 编辑 / 启停 / 批量启停
4. REGION 类自动用 Tree, 其他类用 Table
5. 移动端 Sider 收成顶部下拉 / Drawer
6. tsc --noEmit 干净
7. 后端 API / 数据库 model 不动

## 十、风险 / 取舍

- **ProTable 替换为 Table + 自定义搜索条**: 失去内置 toolbar / 列设置 / 全屏。优点是可控 / 轻量; 缺点是少些便利。**接受这个取舍**(我们用 antd Pro 主要是 quick win, 字典页用得不多 ProFeatures)
- **批量操作**: 如果 SELECT 很多再补 server 端批量接口; 本轮只做 UI 批量触发多次单条 PATCH
- **类目 CRUD**: **本轮不做** — 类目仍写死 16 类白名单。后续如果要做"类目管理"是另一个大动作

## 十一、关键决策 (等你拍板)

| # | 决策点 | 建议 |
|---|---|---|
| 1 | 类目是否支持 UI 内 CRUD | **否**, 写死 16 类, 改 lib 走代码 |
| 2 | 是否加"域"分组(4 域 vs 16 类平铺) | **加域分组**, 认知更清晰 |
| 3 | 类目只读护栏范围 | **REGION 只读**, 其他可改 |
| 4 | 树形拖拽改 sort | **不做**, 用 InputNumber |
| 5 | 批量启停 | **做**, 多选 + 批量 PATCH |
| 6 | ProTable -> Table | **是**, 字典页不需要 ProFeatures |
| 7 | Mobile Sider | **顶部下拉**, 不用 Drawer |

## 十二、实施步骤 (若方案 OK)

1. `lib/dict-domain.ts` 新建 (域元数据, 步骤 2 的依据)
2. `lib/dictionary-categories.ts` 扩展 (导出按域分组)
3. `DictCategorySider.tsx` + `DictCategoryContent.tsx` 拆分
4. `DictTableView.tsx` + `DictTreeView.tsx` 提取
5. `CreateDictModal` -> `CreateDictDrawer` 改造
6. `DictEditDrawer.tsx` 改造
7. `DictBatchBar.tsx` 批量
8. `page.tsx` 重写为 layout shell
9. tsc 干净 / 浏览器自测 / commit
