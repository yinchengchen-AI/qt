# Changelog

本文件记录 qt-biz 每个版本的详细变更。项目快速入口请见 [README.md](README.md)。

## v0.21.9(2026-09-01)业绩排行导出口径统一(PDF 三维度 + xlsx 明细 sheet)

业绩排行页导出全面切换到统一排行口径,解决「PDF 固定 signer 口径与页面维度不一致」「xlsx 新旧两套实现并存」两个问题。**DB schema 无变化**。

### 新增
- **feat(statistics)**:xlsx 导出 `type=performance` 新增 Sheet 2「业务明细」——合同级明细按排行维度分组 (owner/signer → 员工, region → 区域),组末小计 + 末行总计,超 `exportMaxRows()` 截断并在总计行如实标注;数据源 `getPerformanceContractDetail` 与各维度排行同口径 (owner/region 排除 legacy 零额合同, signer 沿用 `getSignerSummary` 历史口径不排除)
- **feat(statistics)**:新增 `GET /api/statistics/performance/pdf?dimension=&preset=&from=&to=` 业绩排行打印页 (浏览器「另存为 PDF」)——支持 owner/signer/region 三维度 + preset 快捷区间,排行表含总计行,明细表分组小计/总计与 xlsx 同款;region 维度下页面「导出 PDF」按钮不再隐藏

### 移除
- **refactor(statistics)**:删除旧打印端点 `/api/statistics/employee-performance/pdf` (固定 signer 口径,与页面维度不一致时出数对不上) 及 xlsx 导出 `type=employee-performance` 分支 (`buildEmployeePerformanceXlsx`,页面早已无入口);抽屉明细端点 `employee-performance/detail` 与 `by-signer` 保留不动

### 测试
- **test(statistics)**:`tests/api/statistics-performance.test.ts` 新增 `getPerformanceContractDetail` 3 例 (三维度分组 + legacy 零额口径) 与 PDF 路由 4 例 (owner/region 表头、非法 dimension 400、SALES 无 EXPORT 403)

## v0.21.8(2026-08-27)自然语言搜索 + 智能催款接线(Phase 5 落地第一批)

把 v0.21.6 引入的六个智能化服务模块中的两个接上真实入口,其余四个仍无调用方(见文末备注)。**DB schema 无变化**。

### 新增
- **feat(search)**:全局搜索框接入自然语言检索——"找去年Q3的合同""本月大额合同"等查询自动解析 时间/金额/状态/类别 条件并按类别收窄查库,下拉顶部回显已识别条件("智能筛选: 本月 · 大额 · 合同");无结构化条件的查询行为与原来完全一致
- **feat(aging)**:账龄分析页新增「催款建议」Tab——按合同聚合逾期发票,结合客户付款习惯(按时率/平均延迟/偏好付款方式/催收响应率)生成紧急度排序的催款建议;话术 Popover 一键复制,「记录催收」一键打开催收 Drawer
- **feat(api)**:新增 `GET /api/statistics/aging/collection-advice`(DUNNING.READ 鉴权;SALES/EXPERT 行级隔离与账龄页同口径);数据组装层 `server/services/collection-advice.ts`,口径与 `getInvoiceAging(basis=due)` 一致

### 修复(Phase 5 模块潜伏 bug,接线时暴露)
- **fix(nlp)**:`natural-language-search.ts` Payment where 误用不存在的 `customerName` 列 → 改走 `customer.name` 关系(此前一旦带关键词查回款必 Prisma 报错)
- **fix(nlp)**:合同时间条件由"合同完整落在区间内"(startDate≥from AND endDate≤to)改为"startDate 落在区间内",跨季长合同不再全部漏掉
- **fix(nlp)**:新增 `extractResidualKeyword`——剥离已识别的 时间/金额/状态/类别词与语气词后的残余才作 ILIKE 关键词(旧 `keywords` 按空白切分,"找去年Q3的合同"会整串进 where 必零命中);残余关键词经 LIKE 通配符转义;"的"只在紧贴类别词或 token 开头时剥离,不误伤"美的集团"类品牌名
- **fix(search)**:NL 命中时下拉隐藏"查看全部"并禁用 Enter 跳列表页(列表页只认 keyword,不认结构化条件,跳转会口径不一致)

### 测试
- **test(nlp)**:新增 `tests/unit/server/nl-search.test.ts`(10 例纯函数:残余关键词提取、计划生成、类别收窄、状态词不串域、通配符转义)
- **test(api)**:`tests/api/search.test.ts` 新增 2 例 NL 集成;新增 `tests/api/collection-advice.test.ts`(4 例:合同聚合/已付清·未到期·DRAFT 排除/SALES 行级隔离/权限收窄 403),DB 不可达自动 skip
- typecheck 0 errors / lint 0 warnings / vitest 969 通过(4 例失败为本地 .env 数据库凭证失效的既有 DB 测试,与本次改动无关)

### 备注
- `smart-collection` 话术规则消费的付款方式取值(snake_case)与 `Payment.method` 的 DB 值(BANK_TRANSFER 等)不一致,组装层 `collection-advice.ts#normalizeMethod` 负责归一化
- Phase 5 其余模块状态:`risk-score-enhanced` 有路由 `/api/contracts/[id]/risk/enhanced` 但无前端调用;`risk-trend-prediction` / `ai-report-generation` / `personalized-recommendations` 仍无任何调用方

## v0.21.7(2026-08-21)智能化增强模块修复

修复 v0.21.6 引入的六个 Phase 5 智能服务模块的质量问题，并接入首个调用方。**DB schema 无变化**。

### 修复
- **fix(risk)**：`risk-score-enhanced.ts` 移除 `Math.random()`，行业风险评分改为确定性映射（LOW=20 / MEDIUM=50 / HIGH=85），保证同输入同输出、可审计、可测试
- **fix(risk)**：统一增强版权重与文档一致——新维度 5%+5%+3%=13%，原五维度等比例压缩为 87%
- **refactor(risk)**：`risk-score-enhanced.ts` 复用 `risk-score.ts#computeRiskScore`，消除约 100 行重复逻辑
- **fix(collection)**：`smart-collection.ts` 正确返回 `contractNo`（不再误传 `contractId`）
- **fix(ai)**：`smart-collection.ts` / `ai-report-generation.ts` 未配置 `DEEPSEEK_API_KEY` 时明确抛 503，不再伪装成本地生成
- **fix(nlp)**：`natural-language-search.ts#toSearchParams` 按 category（contract/customer/invoice/payment）返回对应模型的 where 条件
- **fix(prediction)**：`risk-trend-prediction.ts` 增加输入校验（非法日期、越界分数、负 lookback/daysAhead 等回退到安全默认值）
- **fix(recommendation)**：`personalized-recommendations.ts` 根据 `workingHours` 计算 `avgResponseTime`，并移除 `dueDate` 非空断言

### 接入
- **feat(api)**：新增 `GET /api/contracts/[id]/risk/enhanced`，暴露 Phase 5 增强风险评分，供详情页后续接入

### 测试
- **test(intelligent)**：新增 `tests/unit/server/intelligent-enhancements.test.ts`（21 例），覆盖增强评分确定性、权重、催款 `contractNo`、趋势校验、自然语言分类 where、个性化工作时长、LLM 未配置报错
- typecheck / lint / vitest 全绿（110 文件，960 用例）

## v0.21.6(2026-08-21)智能化增强模块

新增六个智能化服务模块，覆盖风险预测增强与用户体验优化。**DB schema 无变化**。

### 风险预测增强
- **feat(risk)**：增强版风险评分引擎 (`risk-score-enhanced.ts`)，在原五维度基础上新增三个维度：行业风险（基于行业违约率）、历史逾期率（客户历史逾期比例）、季节性因素（淡旺季影响），权重从 100% 调整为 87% + 13% 新维度
- **feat(risk)**：智能催款建议系统 (`smart-collection.ts`)，基于客户付款习惯生成个性化话术，分析付款行为模式，智能计算催款紧急度（LOW/MEDIUM/HIGH/CRITICAL），提供最优催款时机建议
- **feat(risk)**：风险趋势预测服务 (`risk-trend-prediction.ts`)，基于历史快照预测未来 7/14/30 天风险走势，识别趋势模式（上升/下降/平稳/波动），生成趋势分析报告

### 用户体验优化
- **feat(search)**：自然语言搜索服务 (`natural-language-search.ts`)，支持自然语言查询（如"找去年Q3的合同"），解析时间范围、金额范围、状态等条件
- **feat(report)**：AI 业务分析报表服务 (`ai-report-generation.ts`)，基于业务数据生成自然语言分析摘要，识别关键趋势和异常，提供可视化建议
- **feat(recommendation)**：个性化推荐服务 (`personalized-recommendations.ts`)，分析用户工作模式，智能排序待办优先级，生成个性化提醒

- **测试**:typecheck / lint 全绿

## v0.21.5(2026-08-19)主线整合：远端 v0.21.x + 合同深化路线图

并行开发汇合：远端 v0.21.0-v0.21.4（操作日志体验、框架加宽、详情页概览收敛）与合同深化路线图 v0.20.3-v0.20.8（工作台/风险引擎/续签/联动补盲/风险报告/移动端/DeepSeek AI）合并为一条主线。**注：因并行开发，历史中同时存在两个 v0.20.3（本线"个人合同工作台"与远线"对账修复"），git tag 与 CHANGELOG 均按实际发生保留；此后版本号回到单一递增序列**。

整合要点:
- **详情页概览**:采用远端一行三卡 StatGrid（进度条内建于卡片）+ 保留路线图的预警 Alert（超期未开票/开票-回款偏差）、续签链「续签自/至」链接、「风险分析」区块——双方设计语义兼容，无功能丢失
- **schema**:`MessageType` 取双方枚举并集（`RECONCILIATION_*` 4 值 + `RISK_LEVEL_UP`/`CONTRACT_RENEWAL_REMIND`/`LINKAGE_NO_INVOICE`/`LINKAGE_INVOICE_PAYMENT_GAP` 4 值）
- **fix(migrate)**:`scripts/shared/migrate-deploy.sh` 扩展第二个 fresh-DB 重放雷区处理——`20260817_reconciliation_fixes` 文件名排序先于 `20260820_bank_reconciliation` 建表迁移，全新库重放必报 42P01（relation "BankTransaction" does not exist）；按 20260630 既有模式自动处理（幂等 enum DDL → `migrate resolve --applied` → 续跑建表 → 幂等补列），scratch 库完整重放验证 56 迁移全过。**此问题在远线 v0.21.x 上 CI fresh replay 必现，本修复随整合生效**
- **测试**:typecheck / lint 全绿；vitest 939 用例全绿（双方测试合集）

## v0.21.4(2026-08-19)合同详情页概览金额改用 ¥ 千分位格式

**DB schema 无变化**。

变更:
- **feat(contract)**：概览三卡（合同总额 / 已开票 / 已回款）金额从 "X.X 万" 改为 `formatCurrency` 的 ¥ 千分位两位小数格式（如 ¥2,000.00)，与详细信息 tab 的 `CurrencyCell` 口径一致；删除 `fmtWan` 辅助函数
- **测试**:typecheck / lint / vitest 全绿（100 文件，829 用例）

## v0.21.3(2026-08-19)合同详情页概览收敛

合同详情页「概览」tab 从 4 个堆叠区块收敛为一行三卡，消除重复信息。**DB schema 无变化**。

变更:
- **feat(contract)**：概览合并为一个 `StatGrid columns=3`——合同总额（description 带开票/回款计数）、已开票、已回款；后两张卡底部带占合同总额百分比的细进度条（除零保护）,description 内嵌状态 Tag（沿用 COMPLETED→success / IN_PROGRESS→processing 配色）
- **feat(contract)**：删除与统计卡数字完全重复的「开票状态 / 回款状态」独立卡片，以及开票数/回款数计数卡（tab 标签已带计数）
- **fix(contract)**:PageHeader 副标题过期文案修正——原列了不存在的「项目」tab，改为真实 7 个 tab（概览/详细信息/交付物/开票/回款/操作记录/附件）
- **测试**:typecheck / lint / vitest 全绿（100 文件，829 用例）

## v0.21.2(2026-08-19)操作日志时间段选择与查询再优化

操作日志的时间交互收敛进搜索表单：RangePicker 内置预设取代头部快捷按钮；列表补列头排序；keyword 搜索扩展到对象可读名。**DB schema 无变化**。

变更:
- **feat(operation-log)**:时间范围 RangePicker 内置 10 个预设（近 1 小时 / 近 24 小时 / 今天 / 昨天 / 近 7 天 / 近 30 天 / 本周（周一起算，手动计算不依赖 dayjs locale)/ 本月 / 上月 / 本年），移除头部快捷按钮；预设 value 用函数形式，点击时才取当前时间，长开页面不会拿到过期区间
- **feat(operation-log)**：时间（默认倒序）/ 动作 / 对象列头排序，后端 `sortBy`/`sortOrder` 白名单 + id 同向兜底保证分页稳定；操作人列不支持排序（actorId 无关联表，按 id 排序无意义）
- **feat(operation-log)**:`keyword` 除 对象ID / 请求路径 / 请求ID / 失败原因 外，新增命中对象可读名（合同号 / 合同标题 / 客户编号 / 客户名 / 发票号 / 回款号 / 用户名 / 工号，每类实体 id 上限 200 防 in 列表过大）;CSV 导出走同一查询自动生效
- **测试**:`operation-log-where.test.ts` 补 `buildOperationLogOrderBy` 3 例（缺省 / 白名单 / 非法值回退）;`tests/api/operation-logs.test.ts` 补 keyword 命中客户可读名、action asc/desc 排序与缺省 at desc 2 例；typecheck / lint / vitest 全绿（100 文件，829 用例）

## v0.21.1(2026-08-19)框架内容页宽度提高 15%

桌面端框架内容区最大宽度由 1280px 提高到 1472px(+15%),移动端逻辑不变(仍放开限制铺到 100%)。**DB schema 无变化**。

变更:
- **feat(layout)**:`components/page.tsx` 的 `Page` 组件桌面端 `maxWidth` 1280 → 1472,所有使用该组件的业务页面统一生效
- **测试**:typecheck / lint / vitest 全绿(100 文件,824 用例)

## v0.20.3(2026-08-17)对账中心与开票/回款规则对齐修复

## v0.21.0(2026-08-19)操作日志前后端体验优化

操作日志模块整体升级：列表行内直接展示关联对象可读名并可跳转详情、过滤候选值改为日志中真实出现过的数据、新增关键字模糊搜索，并修复搜索区时间范围过滤长期不生效的 bug。**DB schema 有变化：新增迁移 `20260822_operation_log_action_index`（`OperationLog(action)` 索引，无新表无需 GRANT）**。

变更:
- **fix(operation-log)**:列表搜索区"时间范围"过滤长期不生效——列 transform 返回 `from/to` 而 request 读的是 `atRange`,条件被静默丢弃；现统一由 request 读 `from/to`,快速区间按钮改用 dayjs 对象回填表单
- **feat(operation-log)**:列表行内展示关联对象可读名（合同号+标题 / 客户编号+名称 / 发票号 / 回款号 / 用户）,批量分组查询避免 N+1;有详情页的对象可直接点击跳转
- **feat(operation-log)**:新增 `GET /api/operation-logs/meta`——返回日志里真实出现过的 entity / action / actor,前端"对象 / 动作 / 操作人"过滤从硬编码候选改为动态下拉(可搜索),操作人不再要求手填用户 ID
- **feat(operation-log)**:新增 `keyword` 模糊过滤(不区分大小写),一条关键字同时匹配 对象ID / 请求路径 / 请求ID / 失败原因
- **feat(operation-log)**:失败行"失败"标签悬停显示失败原因;详情抽屉 diff 字段名带中文映射(状态/金额/合同编号等 50+ 高频字段,未命中回退原名);请求 ID / IP / 对象 ID 一键复制
- **feat(operation-log)**:CSV 导出自动翻页(上限 1000 行,带进度提示),导出内容补 对象可读名 / 失败原因两列
- **refactor(operation-log)**:列表/详情逻辑下沉到 `server/services/operation-log.ts`(薄路由+可测 service),回款详情可读名从内部 id 改为 paymentNo
- **perf(operation-log)**:`OperationLog(action)` 补索引,动作过滤不再全表扫描
- **测试**:新增 `tests/unit/server/operation-log-where.test.ts`(where 构建纯函数 6 例)与 `tests/api/operation-logs.test.ts`(真实 DB:权限 403 / keyword 命中 path+errorMessage+entityId / entityDisplay 解析 / meta 动态候选 / detail 404,5 例);typecheck / lint / vitest 全绿(100 文件,824 用例);dev 冒烟 meta/list/detail 401、页面 307 正常


对账中心上线后做动态走查（真实 DB 跑 service 全链路），发现并修复一批与回款/开票模块的耦合缺口：对账通知因 PG enum 缺值全部静默丢失、对账确认绕过回款确认的金额校验与到账通知、`RECONCILED` 状态无人驱动、手动匹配不回写流水号、消息中心通知点击无跳转。**DB schema 有变化：新增迁移 `20260817_reconciliation_fixes`（`MessageType` 补 4 个 `RECONCILIATION_*` 枚举值 + `BankTransaction.paymentPrevStatus` 列）**。

变更:
- **fix(messages)**:MessageType PG enum 补 `RECONCILIATION_AUTO_MATCHED`/`SUGGESTION`/`DISCREPANCY`/`WEEKLY_REPORT`——v0.20.0 误判"生产 qt_app 非 enum owner"而只注册应用层枚举，但 `Message.type` 列仍是原生 enum，Prisma 写库被拒且被 service try/catch 吞掉，对账通知全部静默丢失；迁移以 `MIGRATION_DATABASE_URL`（qitai，DB owner）执行，与 20260701/20260702/20260724 三个历史 ALTER TYPE 迁移同路径
- **fix(reconciliation)**:`confirmMatch`/`manualMatch` 重构为共享 writeback，与回款模块 confirm 同规则——R-10 流水号唯一（409）/ R-11 累计≤发票金额 / R-12 累计≤合同总额（PLANNED 新入账时校验）+ advisory lock + 合同/发票行锁；此前对账确认直接 `payment.update` 绕过全部校验，超额回款可确认入账
- **fix(reconciliation)**:对账确认终态改为 `RECONCILED`（记 `reconcileUserId`/`reconciledAt`），对账中心成为"对账"动作的实际驱动者；PLANNED→RECONCILED 补发 `PAYMENT_RECEIVED` 到账通知（合同 owner/登记人/管理员），已 CONFIRMED 的不重复发
- **fix(reconciliation)**:`manualMatch` 与 `confirmMatch` 写回对称——回写 `bankRefNo`、推进状态、金额不一致同样记 `AMOUNT_MISMATCH` 差异
- **fix(reconciliation)**:`unmatch` 用新增 `paymentPrevStatus` 列精确回滚（PLANNED/CONFIRMED 各归各位并清对账人/对账时间），修复前的旧数据退化到原启发式（bankRefNo+receivedAt 签名）
- **feat(messages)**:补发 `RECONCILIATION_SUGGESTION`（建议匹配）与 `RECONCILIATION_DISCREPANCY`（差异提醒）通知；差异通知链接指向关联流水
- **fix(messages)**:消息链接 `kind=reconciliation` 接入 `MESSAGE_LINK_PATH`，新增 `/payments/reconciliation/[id]` 重定向到列表页 `?txId=` 并自动打开详情抽屉——此前通知点击无跳转
- **测试**:一致性测试移除对账类型豁免（4 个类型纳入 PG enum 校验 + 落库 smoke）；新增 7 个回归用例（R-10/R-11/R-12 拦截、RECONCILED 终态与 receivedAt 语义、PAYMENT_RECEIVED 发送与去重、差异通知、终态回款拒绝匹配、CONFIRMED 精确回滚）;typecheck / lint / vitest 全绿（98 文件，813 用例）；生产 build 通过；真实 DB 动态复验 7 项全过（自动匹配通知落库 / R-11 拦截 / 到账通知 / RECONCILED 终态 / unmatch 回滚 / manualMatch 对称 / 链接生成）

## v0.20.8(2026-08-19)DeepSeek 合同风险 AI 分析（Phase 4b）

风险报告接入 DeepSeek LLM：详情页与工作台抽屉的「AI 分析」区一键生成自然语言风险摘要与跟进话术，出域数据最小化（仅合同号/客户名/金额/评分，不含个人敏感字段），key 走 `lib/env.ts` 校验仅服务端可见。**DB schema / migrations: 无变化**。

变更:
- **feat(ai)**:`server/services/contract-ai.ts` — DeepSeek chat/completions 封装（OpenAI 兼容）；结构化 prompt 要求 `json_object` 输出并稳健解析（容忍 markdown 包裹/首尾杂讯）；20s 超时；401/429/5xx/网络错误分类映射 502，未配置 key 明确 503（不伪装本地生成）；错误信息永不携带 key
- **feat(api)**:`GET /api/contracts/[id]/ai-analysis` 薄壳路由（requireSession → getContractRisk 复用行级读权限 → LLM），返回 `{ summary, talkTracks[], model, generatedAt }`
- **feat(ui)**:`RiskReportView` 底部「AI 分析」区——按钮触发生成（不自动调用省 token），loading / 摘要 Alert / 话术列表 / 错误可重试；工作台抽屉与合同详情页共用自动获得
- **chore(env)**:新增 `DEEPSEEK_API_KEY`（可选）/ `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL`（默认 `deepseek-chat`）；key 仅入本地 `.env`（gitignored），`.env.example` 占位
- **test**:`tests/unit/server/contract-ai.test.ts` 11 用例（mock fetch：prompt 结构含报告字段、JSON 解析、401/429/500/空返回/解析失败/网络超时/无 key 503）；E2E 19.4（结果或降级错误均正常呈现不白屏）；真实 smoke 经 dev 路由调用 DeepSeek 成功（摘要与话术贴合风险数据）
- **明确不做**:条款合规检查（需条款文本 + 附件 OCR，spec 注明单独立项）；结果缓存与计费统计
- **测试**:typecheck / lint / vitest 全绿（106 文件，913 用例 × 3 连跑）；E2E 五 spec 全 project 32 通过 / 37 跳过 / 0 失败

## v0.20.7(2026-08-19)移动端适配 + PWA（Phase 5）

移动端体验补齐：PWA 可添加到主屏幕（standalone 启动、应用壳缓存 + 离线兜底，Service Worker 不拦截 API 防陈旧数据），手机端底部固定导航（工作台/合同/消息/我的 + 未读角标），风险报告雷达图窄屏降级条形图，工作台统计卡 2×2 网格。**DB schema / migrations: 无变化**。

变更:
- **feat(pwa)**:`app/manifest.ts`（standalone、品牌主题色）+ `public/sw.js`（应用壳缓存 + 离线回退，明确不拦截 `/api` 与非 GET——会话与业务数据永远走网络）+ `PwaRegister`（仅生产注册，dev 不污染调试）+ 图标 192/512（品牌 SVG 经 Playwright 截图生成）；推送不在本期——spec §8.3 明确 PWA 推送仅作站内信增强通道，关键提醒以站内信为准
- **feat(mobile)**:`MobileBottomNav` 底部固定导航（工作台 `/dashboard` / 合同 `/contracts` / 消息 `/messages`（未读角标）/ 我的 `/contracts/workbench`），仅手机断点渲染，主内容区底部留 64px 占位防遮挡
- **feat(mobile)**:风险报告 `RiskReportView` 手机端 Radar 雷达图降级为 Column 纵向条形图（spec §8.2：窄屏雷达标签重叠不可读）；`StatGrid` 新增 `mobileColumns` 属性（默认 1 零影响），合同工作台统计卡手机端 2×2
- **test**:`tests/e2e/20-mobile-pwa.spec.ts` 5 用例（manifest/SW 可达、2×2 网格、底部导航可见可跳转、图表降级渲染、非手机断点不渲染导航；iPad project 虽是 isMobile 但 820px 走侧边栏——guard 按视口宽度区分）
- **测试**:typecheck / lint / vitest 全绿（105 文件，902 用例 × 2 连跑）；E2E 五 spec（16-20）全 project 29 通过 / 20 跳过 / 0 失败

## v0.20.6(2026-08-19)规则引擎风险报告（Phase 4a）

合同风险报告上线：基于 Phase 2 评分与快照，纯本地计算输出结构化报告（五维度明细、加权公式串、多条业务化建议、30 天趋势与主因维度），工作台风险抽屉与合同详情页「风险分析」区块共用同一视图。**DB schema / migrations: 无变化**。

变更:
- **feat(risk)**:`server/services/contract/risk-report.ts` 纯函数报告构建器（spec §7.2 契约）——`weightedScore` 公式串与示例逐字符一致（`67×0.30 + 80×0.25 + 60×0.20 + 33×0.15 + 0×0.10 = 57.1 → 四舍五入 57`）；建议升级为多条（原始分 ≥50 的维度降序取 Top 3，催款带剩余金额、逾期带宽限期倒数、开票带缺口，趋势上升 ≥10 分追加主因建议）；`trendSummary { days, from, to, mainDriver }`（窗口内各维度增量最大者，快照 < 2 个时为 null 显示「数据积累中」）
- **feat(risk)**:`computeContractRisks` 透出 `totalAmount / paidAmount / invoicedAmount / daysOverdue` 与 `dimensionRaw`（报告构建免二次查询）；`GET /api/contracts/[id]/risk` 响应追加 `weightedScore / trendSummary / asOf`，`recommendations` 升级为多条（向后兼容）
- **feat(detail)**:抽取 `RiskReportView` 共享组件（雷达 + 维度明细 + 加权公式 + 趋势折线 + 建议列表），工作台风险抽屉与合同详情页概览 tab 新增「风险分析」区块复用（不新增 Tab）
- **test**:`tests/unit/server/risk-report.test.ts` 10 用例（§7.2 公式串验算 / mainDriver 判定 / 建议排序与文案）；API 测试补报告契约断言；`tests/e2e/19-risk-report.spec.ts` 3 用例
- **测试**:typecheck / lint / vitest 全绿（105 文件，902 用例 × 2 连跑）；E2E 四 spec（16-19）全 project 21 通过 / 30 跳过 / 0 失败

## v0.20.5(2026-08-18)续签跟进 + 联动补盲（Phase 1.5/3）

合同深化路线图 Phase 1.5 与 Phase 3 落地：续签链路（`renewedFromId` 自关联 + 每周提醒 + 工作台一键续签 Modal），联动补盲两条每日检查（超期未开票 / 开票-回款偏差）+ 详情页概览增强（双进度条、预警 Alert、续签链链接）。**DB schema 有变化：迁移 `20260822_contract_renewed_from`（`Contract.renewedFromId` + FK `ON DELETE SET NULL` + 索引）+ `20260822_message_type_renewal_linkage`（`MessageType` 追加 `CONTRACT_RENEWAL_REMIND` / `LINKAGE_NO_INVOICE` / `LINKAGE_INVOICE_PAYMENT_GAP` 三个值）**。

变更:
- **feat(renewal)**:`Contract.renewedFromId` 续签链路（不加 RENEWED 状态，源合同走既有自动完结/强关收尾，状态机零改动）；`contract-renewal-remind` job 对到期超 30 天未续签合同每周提醒（entityKey `合同:ISO周` 同周去重，owner+admin）
- **feat(renewal)**:创建接口接受 `renewedFromId`（源合同存在性 404 校验，审计快照带上）；工作台待办 overdue/expiring 项旁「续签」按钮 → RenewalModal 预填源合同字段（日期默认原 endDate+1 起同跨度可编辑）→ 走正常 DRAFT 创建流程；创建成功后源合同待办消失（服务端按 renewal 记录排除）
- **feat(linkage)**:`linkage-checks.ts` 共享判定模块（job 与详情页 overview 同源，防口径漂移）——超期未开票（生效 30 天无已开票发票）与开票-回款偏差（已开票≥1万 且回款缺口>20% 且最新发票开具超 30 天，与 INVOICE_OVERDUE_PAYMENT 按发票粒度互补）
- **feat(linkage)**:`daily-linkage-check` job 按日 entityKey 去重；未开票提醒发 owner，偏差提醒发 owner+财务
- **feat(detail)**:合同详情页概览区新增开票/回款双进度条、未结预警 Alert（点击锚跳发票/回款列表）、续签链「续签自/续签至」双向链接
- **fix(test-infra)**:`RiskScoreSnapshot` FK 由 RESTRICT 改 CASCADE（迁移未上 main，合规编辑；快照为纯派生数据，合同硬删随之清理）——根治并发测试 fixture 清理撞 FK；三个新 job 的 emit 加 P2003 容忍（并发测试清理竞态，生产全软删不触发）；`payment-browse-permissions` 的 EXPERT 解析钉到种子账号 employeeNo（原 `findFirst` 无序匹配会撞并发临时用户）
- **test**:新增 `tests/api/contract-renewal.test.ts` 8 用例、`tests/api/linkage-check.test.ts` 13 用例（纯函数边界 + job 去重 + overview 透出）、`tests/e2e/18-renewal-linkage.spec.ts` 5 用例（续签 Modal 全流程 + 详情页增强，Prisma 直造 fixture）
- **测试**:typecheck / lint / vitest 全绿（104 文件，892 用例 × 3 连跑）；E2E 三 spec（16/17/18）全 project 18 通过 / 24 跳过 / 0 失败

## v0.20.4(2026-08-18)合同风险预警引擎（Phase 2）

合同风险五维度评分引擎上线：到期/付款/开票/客户信用/金额异常加权总分映射四级（低/中/高/严重），每日快照支撑趋势与升档检测，工作台风险卡接入真实计数，风险抽屉展示雷达图 + 30 天趋势 + 建议操作。**DB schema 有变化：迁移 `20260822_risk_score_snapshot`（新表 `RiskScoreSnapshot`，含 `GRANT ALL ... TO qt_app`）+ `20260822_message_type_risk_level_up`（`MessageType` 追加 `RISK_LEVEL_UP`，走 20260724 已验证的 ALTER TYPE 路径）**。

变更:
- **feat(risk)**:`server/services/contract/risk-score.ts` — 五维度分段函数纯计算（逾期 30 天满分 / 进度落后 50pp 满分 / 客户样本<3 固定 20 分 / 金额偏离 50%-200% 线性）+ 批量预聚合入口（payment/invoice/客户历史各一次查询，禁 N+1）
- **feat(risk)**:`server/jobs/risk-score-snapshot.ts` 挂入 `runAllJobs` — 每日对全部 ACTIVE 合同算分幂等 upsert 快照；与昨日快照比对，升档至 HIGH/CRITICAL 发 `RISK_LEVEL_UP` 站内信（owner+admin，entityKey 同日同档去重，降档再升档会重发属有意为之）；job 完成后给 admin 发当日汇总一条
- **feat(api)**:`GET /api/contracts/my-risk`（我的 MEDIUM+ 风险合同降序）+ `GET /api/contracts/[id]/risk`（单合同实时分 + 五维明细 + 近 30 天趋势 + 建议操作）；`/api/contracts/my-stats` 的 risk 从占位 0 改为真实 HIGH+CRITICAL 计数
- **feat(workbench)**:风险抽屉组件（列表 → 详情：Radar 五维 + Line 趋势 + 建议，图表库 dynamic import 不拖工作台首屏）；风险卡真实计数 +「查看风险合同」入口；我的合同表新增风险列（中/高/严重标色）
- **fix(e2e)**:`tests/e2e/_auth.ts` 进程内共享登录态 — 根治 proxy.ts 登录限速（5 次/分钟/IP）导致的多 spec 并发登录 429；桌面用例在移动端 project 跳过（侧边栏分组/跳转属桌面交互，移动端由专项 viewport 用例覆盖）
- **test**:新增 `tests/unit/server/risk-score.test.ts` 36 用例（分段函数边界 + spec §7.2 验算口径）、`tests/api/contract-risk.test.ts` 8 用例（快照幂等/升档去重/汇总去重/my-risk/my-stats/越权 null）、`tests/risk-score-snapshot-schema.test.ts` 9 用例（迁移回归）、`tests/e2e/17-contract-risk.spec.ts`；workbench 测试改独立用户 fixture（并发文件隔离）
- **测试**:typecheck / lint / vitest 全绿（102 文件，871 用例）；E2E 三 project 13 通过 / 14 跳过 / 0 失败

## v0.20.3(2026-08-18)个人合同工作台 Phase 1

新增个人合同工作台页面，集成统计卡、待办列表、我的合同表格，支持按 ownerUserId 行级隔离过滤合同（mine=true），防止越权枚举。**DB schema / migrations: 无变化**。

变更:
- **feat(workbench)**:新增 `/api/contracts/my-stats`（活跃/即将到期/逾期/风险预警）和 `/api/contracts/my-todos`（优先级排序待办：逾期 > 7 天内到期 > 未开票）两个薄壳 API
- **feat(workbench)**:工作台页面 `/contracts/workbench` — StatGrid 四卡片 + WorkbenchTodoList + ProTable（mine=true 复用合同列表列）
- **feat(workbench)**:侧边栏「合同工作台」菜单项（业务组内）
- **feat(contracts)**:合同列表支持 `mine=true` 按 ownerUserId 过滤，服务端从 session 注入（忽略客户端传入的他人 id）
- **test**:新增 `tests/api/contract-workbench.test.ts` 12 用例（mock + DB-reachable 双层）+ `tests/e2e/16-contract-workbench.spec.ts` 5 用例
- **测试**:typecheck / lint / vitest 全绿（99 文件，818 用例）
## v0.20.2(2026-08-17)对账规则配置（ReconciliationRule）下线

删除 v0.20.0 引入但从未接线的对账规则配置：匹配引擎不读规则表、前端无配置入口、DSL 为拍脑袋设计，表/CRUD API/service 全属死代码。**DB schema 有变化：新增迁移 `20260821_drop_reconciliation_rule`（`DROP TABLE "ReconciliationRule"`）**。

变更:
- **chore(reconciliation)**:删 `ReconciliationRule` model、`GET/POST /api/reconciliation/rules` 与 `PATCH/DELETE .../rules/[id]` 两组路由、service 的 `listRules/createRule/updateRule/deleteRule`、validators 的规则 schema（约 130 行）
- **docs(db)**:迁移索引补齐 41-44 号（user_session_version / aging_snapshot / bank_reconciliation / drop_reconciliation_rule），主题跳转补"对账中心"
- **测试**:typecheck / lint / vitest 全绿（98 文件，806 用例）;dev 冒烟：rules API 404、对账 summary 正常 401

## v0.20.1(2026-08-17)对账中心可用性修复与导入增强

对 v0.20.0 对账中心做全链路走查（浏览器实操 + DB 落账核对），修复一批实用性与数据一致性问题：部署后角色权限不同步导致全员 403 且页面静默空数据、取消匹配不回滚回款状态、操作后表格不刷新、导入只支持手贴 JSON 等。**DB schema / migrations: 无变化**。

变更:
- **fix(deploy)**:`deploy.sh` 在 migrate 后新增 `seed-roles` 幂等步骤（失败只告警不阻断）——权限以 DB `Role.permissions` 为准，新增 `RECONCILIATION` 资源只改代码矩阵不同步 DB 会导致线上全员 403
- **fix(reconciliation)**:`unmatchTransaction` 改事务内回滚 `confirmMatch` 对 Payment 的副作用——清掉本流水写入的 `bankRefNo`；仅当确为本对账推进（bankRefNo 匹配且 receivedAt == 交易日期）才退回 PLANNED，不误退原本就 CONFIRMED 的回款，消除孤儿状态
- **fix(reconciliation)**:`confirmMatch`/`manualMatch` 新增回款一对一占用校验，已被其它流水占用的回款 422 拒绝（报"该回款已关联银行流水 xxx"）
- **feat(reconciliation)**:导入三通道——上传 `.xlsx`/`.csv` 文件（服务端 exceljs 解析，日期单元格/带逗号金额正确处理，5MB、5000 行上限）、Excel 复制表格直接粘贴（TSV）、保留 JSON 粘贴；新增前后端共用解析器 `lib/statement-text.ts`；导入失败行明细弹窗展示
- **fix(reconciliation)**:ProTable 接入 `actionRef`，匹配/取消/忽略/批量/导入/确认后表格与统计卡自动刷新（此前需手动刷新，行状态纹丝不动）；列表请求失败显式 `message.error`，403 不再静默显示"暂无数据"
- **feat(reconciliation)**:筛选下拉与状态标签新增"建议匹配"（UNMATCHED + ≥60 分的虚拟状态），服务端 `matchStatus=SUGGESTED` 翻译为对应查询，建议记录不再无处可找
- **fix(reconciliation)**:搜索区瘦身——表格列全部 `search: false`，只留关键词/匹配状态/交易日期区间三个有效项，消除"操作列变搜索框"与重复"匹配状态"（React duplicate key 告警）
- **fix(reconciliation)**:差异处理改逐项弹窗（点该项"标记处理"→ 填说明（必填）→ 确认），处理完列表自动刷新；非财务角色隐藏按钮
- **fix(layout)**:面包屑补 `reconciliation` → "对账中心"
- **测试**:新增 8 用例（占用防护 / unmatch 回滚 / SUGGESTED 筛选 / CSV·TSV·xlsx 解析）;typecheck / lint / vitest 全绿（98 文件，806 用例）;浏览器全链路复验通过

## v0.20.0(2026-08-20)发票与回款自动对账匹配

新增对账中心模块：银行流水导入、多维度自动匹配引擎、差异处理与对账确认全流程。**DB schema 有变化：新增 `BankTransaction`/`ReconciliationRule`/`ReconciliationDiscrepancy` 3 张表（迁移 `20260820_bank_reconciliation`，含 `GRANT ALL ... TO qt_app`）**。

变更:
- **feat(reconciliation)**:银行流水 Excel/CSV 导入（`POST /api/reconciliation/import`），支持中文字段映射（流水号/交易日期/金额/对方户名/摘要）、同批次去重、跨批次唯一约束防重复；导入结果含成功/失败/错误明细
- **feat(reconciliation)**:多维度自动匹配引擎 — 金额（40%权重，精确/容差/近似分级）、日期（20%，±0/1/3/7天分级）、客户名称相似度（25%，公共子串比例）、摘要关键词（15%，发票号/合同号/回款单号识别）、历史交易模式（5%）；高置信度（≥80分且领先第二名≥20分）自动匹配写 `AUTO_MATCHED`，中置信度（60-79分）标记建议
- **feat(reconciliation)**:对账中心页面 `/payments/reconciliation` — 6 项统计卡片（待匹配/建议/自动待确认/已确认/已忽略/差异）、ProTable 流水列表（关键词/状态/日期/金额筛选）、详情 Drawer（含候选匹配列表带分数与依据）、批量自动匹配按钮、差异处理 Drawer
- **feat(reconciliation)**:匹配操作 API — `POST /api/reconciliation/transactions/[id]/match` 支持 auto-match/confirm-match/manual-match/unmatch/ignore；`confirm-match` 联动更新 Payment.bankRefNo + 状态推进 PLANNED→CONFIRMED，金额差异自动写 `ReconciliationDiscrepancy`
- **feat(reconciliation)**:差异处理 — `GET /api/reconciliation/discrepancies` 列表 + `POST .../resolve` 标记处理，支持严重程度分级（LOW/MEDIUM/HIGH/CRITICAL）
- **feat(permissions)**:新增 `RECONCILIATION` 资源权限 — ADMIN/FINANCE CRUD+EXPORT，SALES/OPS/EXPERT 只读；规则配置仅 ADMIN 可写
- **feat(messages)**:新增 4 类对账消息 — `RECONCILIATION_AUTO_MATCHED`（自动匹配待确认）、`RECONCILIATION_SUGGESTION`（建议匹配）、`RECONCILIATION_DISCREPANCY`（差异提醒）、`RECONCILIATION_WEEKLY_REPORT`（周报，预留）
- **测试**:新增 `tests/api/reconciliation.test.ts` 20 用例 — 解析（标准/英文/YYYYMMDD/异常）、导入（批量/去重/跨批重复/权限）、自动匹配（高置信度/无候选/重复处理）、匹配操作（确认/手动/取消/忽略）、查询（统计/列表/筛选）;typecheck / lint / vitest 全绿（97 文件，795 用例）

## v0.19.9(2026-08-17)账龄分析明细列表翻页失效修复

账龄分析页「明细」tab 翻页点击无效:page/pageSize 只存在 `DetailTable` 本地 state,从未进查询串——请求恒为 `page=1&pageSize=20`(服务端早已支持分页参数,有 schema 测试),onChange 只是用相同参数重拉。代码注释里甚至留了 "实际生产:把 page/pageSize 也放 filter" 的 TODO。**DB schema / migrations: 无变化**。

变更:
- **fix(statistics)**:page/pageSize 提升到页面层并进 `/api/statistics/invoice-aging` 查询串,翻页/改页大小真正生效;filter 变化自动重置到第 1 页;删除 DetailTable 本地分页 state 与无效 `onChanged` 透传
- **fix(statistics)**:当前页为空但 total>0(如末页数据被并发变化抽空)时仍渲染表格+分页器,不再困死在空态页
- **测试**:typecheck / lint / vitest 全绿(96 文件,775 用例)

## v0.19.8(2026-08-17)CI 修复:seed 前补 prisma generate

CI 二跑再进一步(迁移 resolve 路径与 build job 均通过),挂在 seed 步:fresh node_modules 的 `@prisma/client` 没有生成 client(postinstall 只跑 patch-package),`pnpm seed` 报 `does not provide an export named 'Prisma'`。test job 在迁移前补显式 `prisma generate`(无需 DB,与 dev-up.sh "显式跑一次保险" 同理)。**DB schema / migrations: 无变化**;纯 CI 配置改动,无需部署。

- **测试**:CI 三跑全绿——test job 1m44s(迁移 resolve 路径生效,vitest 96 文件 775/775 无 skip)+ build job 56s

## v0.19.7(2026-08-17)CI 修复:fresh DB 迁移重放雷区自动化 + 测试 fixture 自愈

CI 首跑暴露两个 fresh DB 才能发现的问题,均已修复并全流程本地彩排(scratch PG 16 从建库到 775 用例全绿)。**DB schema / migrations: 无变化**;CI/脚本/测试/docs 改动,不影响运行时,无需部署。

变更:
- **fix(ci)**:CI 迁移步骤撞 fresh DB 已知雷区——`20260630_message_type_enum_index` 裸 `CREATE TYPE` 必撞 `20260627` 预建 enum(42710);封装 `scripts/shared/migrate-deploy.sh`:只在 deploy 报错点名 20260630 时才 `migrate resolve --applied` + 补列转换/索引 DDL 再续跑(与 `prisma/migrations/README.md` #29 文档化路径一致),其它失败原样报错绝不 resolve;`migrate status` 不点名失败迁移,判定依据是 deploy 的 P3018 "Migration name:" 输出
- **fix(dev)**:`dev:setup` 从 `migrate dev`(shadow DB 重放,与迁移历史不兼容,AGENTS.md 明令禁止)改为同一 `migrate-deploy.sh` 入口——此前新机器跑 dev:setup 必挂 P3006
- **fix(test)**:`tests/api/contract-no-partial-unique.test.ts` 不再 `findFirstOrThrow` 依赖环境已有客户(fresh DB 必挂),改为 beforeAll 自建 TAG 前缀客户 fixture + afterAll 清理;无用户(seed 未跑)时整组 skip
- **docs(ops)**:AGENTS.md 修正 `docs/db-bootstrap.md` 失效引用(已迁至 `docs/ops/db-bootstrap.md`)、数据库迁移节补 fresh DB 两坑(qt_app 角色 + 20260630);`docs/ops/db-bootstrap.md` 同步补 "fresh DB 的两个已知坑" 小节
- **测试**:typecheck / lint / vitest 全绿(96 文件,775 用例);scratch PG 16 全新库完整彩排:建 qt_app 角色 → migrate-deploy.sh(自动 resolve)→ seed/seed:dev-users → vitest 775/775

## v0.19.6(2026-08-17)CI 门禁上线 + CHANGELOG 草稿半自动化

发版闭环加固:GitHub Actions CI 在每次 push/PR 时用真实 PG(迁移+seed)跑 lint/typecheck/vitest + 生产构建冒烟;新增 `npm run changelog:draft` 从 commits 生成 CHANGELOG 草稿,不用手翻 git log。**DB schema / migrations: 无变化**;CI/工具/docs 改动,不影响运行时,无需部署,随下次上线顺带同步。

变更:
- **ci(workflow)**:新增 `.github/workflows/ci.yml`——test job(postgres:16 service → 建 qt_app 角色(20260704/20260711 两个无保护 GRANT 迁移依赖) → migrate deploy → seed + seed:dev-users → lint → typecheck → vitest)与 build job(`SKIP_ENV_VALIDATION=1` next build 冒烟,抓 tsc 查不出的 RSC/构建期错误)并行;`pnpm-workspace.yaml` 是 gitignored 本机文件,CI 按 allowBuilds 白名单重建(否则 pnpm 11 install 报 ERR_PNPM_IGNORED_BUILDS)
- **feat(dev)**:新增 `scripts/release/changelog-draft.ts` + `npm run changelog:draft`(`--patch/--minor/--major/--from <ref>`),复用 `lib/git` + `lib/release-plan` 与 release:publish 同口径过滤 release 噪音;自动检测 `prisma/migrations` + `schema.prisma` 改动预填 "DB schema" 行
- **docs(agents)**:闭环粒度明确为"一个功能/修复(或一个工作 session)一次",中间 commit 不强制各自 bump+部署;补充 CI 兜底定位与 changelog:draft 用法
- **测试**:typecheck / lint / vitest 全绿(96 文件,775 用例);changelog:draft 空区间/正常区间两条路径实测;workflow YAML 语法校验通过

## v0.19.5(2026-08-17)移除 scheduler.ts 失效的 eslint-disable 指令

依赖按 lockfile 同步后 eslint 9.18→9.39.5,`declare global` 中的 `var` 不再被 `no-var` 命中,`server/notifications/scheduler.ts` 原有 `eslint-disable-next-line no-var` 变成未使用指令并报 warning。**DB schema / migrations: 无变化**;注释类改动,无需部署,随下次上线顺带。

变更:
- **chore(lint)**:删除 `server/notifications/scheduler.ts` 中失效的 `eslint-disable-next-line no-var`(新版 eslint 下 `no-var` 不再检查 ambient 声明,指令未使用触发 reportUnusedDisableDirectives 警告)
- **fix(dev)**:本地 `pnpm-workspace.yaml`(gitignored)`unrs-resolver` 占位符 `set this to true or false` 导致 pnpm 11 install 报 ERR_PNPM_IGNORED_BUILDS,改为 `true` —— 仅本地文件,不进仓库,记录在案供其他机器参考
- **测试**:typecheck / lint / vitest 全绿(96 文件,775 用例)

## v0.19.4(2026-08-16)聚合搜索框移至内容区 sticky 吸附条

搜索框从顶栏右侧移至内容区顶部,sticky 吸附在 Header 下方——随页面滚动始终保持可见,任何页面任何滚动位置都能直接搜索。**DB schema / migrations: 无变化**。

变更:
- **feat(search)**:搜索条移至 Content 顶部 sticky(top=Header 高度, zIndex 低于 Header),居中限宽 720px,实色背景遮挡滚动内容;顶栏右侧移除搜索框,只留消息与头像
- **feat(search)**:`GlobalSearch` 新增 `block` 全宽模式:宽度 100% + 下拉跟随输入框宽度;手机端直接显示输入框(不再走"图标→展开 fixed 条"两步流程)
- **fix(search)**:手机端隐藏 `Ctrl K` 徽标(无物理键盘场景)
- **test(e2e)**:登录 waitForURL timeout 10s→20s(dev 按需编译 + 多项目连续跑时登录 POST 偶发 >10s;生产构建无此问题)
- **测试**:typecheck / lint / vitest 全绿(96 文件,775 用例);playwright 三项目(chromium/ipad/iphone)各 3 用例全过;桌面+移动端 sticky 滚动截图验证

## v0.19.3(2026-08-16)全局搜索框外观与实用性优化

顶栏聚合搜索框视觉与交互双重升级:分组彩色图标、快捷键唤起、搜索历史、Enter 直达列表页。**DB schema / migrations: 无变化**。

变更:
- **feat(search)**:Ctrl+K / ⌘K 全局快捷键聚焦搜索框(手机端展开全宽输入条);输入框右侧常驻 `Ctrl K` 徽标提示(非 Mac 自动切换文案)
- **feat(search)**:搜索历史(localStorage 最近 5 条,仅在真实跳转时写入);空输入聚焦显示「最近搜索」分组,单条可删
- **feat(search)**:Enter 智能跳转——未用 ↑↓ 导航时跳首个命中类的「查看全部」列表页(带 ?keyword=);用过 ↑↓ 则交给 antd 默认选中,两者不冲突
- **feat(search)**:1 字符输入显示「再输入 1 个字符开始搜索」提示(此前静默无反馈)
- **style(search)**:下拉分组标题加彩色图标(客户蓝/合同紫/发票青/回款绿);「查看全部 N 条」整行醒目化(主色+虚线分隔+右箭头);空态/失败态带图标,失败可点击重试;输入框 240→280px,下拉 420→480px
- **fix(search)**:修复下拉闪烁竞态——fill 输入后防抖 300ms 窗口内 loading=false+data=null 导致下拉闪关并触发 antd onOpenChange(false) 锁死 open 状态,改为 trimmedLen>=1 常开(e2e 实测复现)
- **测试**:e2e 新增 2 用例(Ctrl+K 聚焦+历史记录 / Enter 跳查看全部);typecheck / lint / vitest 全绿(96 文件,775 用例);playwright chromium 3 用例全过

## v0.19.2(2026-08-16)remote-deploy.sh 退出码假阴性修复

修复本地触发远端部署的两个退出码判定缺陷:部署成功后脚本误报"30 分钟 stream 超时"(exit 124),以及潜在的 deploy 失败被误记为成功。**DB schema / migrations: 无变化**;纯运维脚本(本地触发端)改动,随下次部署顺带同步远端。

变更:
- **fix(deploy)**:`scripts/prod/remote-deploy.sh` tmux 会话退出分支从"误报 stream 超时"改为 ssh 读远端 `/tmp/qt-deploy.log` 的 `EXIT=` 标记并以其为真实退出码(EXIT= 由 tmux 内命令写入日志文件,不出现在 capture-pane 输出,原 grep 永不命中)
- **fix(deploy)**:tmux 内命令加 `set -o pipefail`:否则 `deploy.sh | tee` 的 `$?` 是 tee 的退出码(恒 0),deploy.sh 失败会被误记为 EXIT=0
- **测试**:bash -n 语法检查通过;--dry-run 回归正常

## v0.19.1(2026-08-16)全局搜索对齐 read-open 权限口径

全局搜索从行级隔离改为读开放(read-open),与列表页读口径一致(v0.18.4 Wave 3 权限改造同策略):SALES/EXPERT 现在可跨 owner 搜索客户/合同/发票/回款。此前搜索仍走 ownerEq/ownerViaContract 行级隔离,与列表页"读开放、写守门"行为不一致(列表页可见的记录搜不到)。**DB schema / migrations: 无变化**。

变更:
- **fix(search)**:`server/services/search.ts` 四组 where 去掉 `ownerEq` / `ownerViaContract` 行级隔离注入,与列表页读口径对齐(`lib/ownership.ts` 注释: owner 过滤仅统计/工作台/回收站口径使用);逐组 READ 权限门禁(`hasPermission`,无权限组返回空分组且不查库)、LIKE 通配符转义、分组 total 统计保留不变
- **fix(search)**:`GlobalSearch` 恢复为自管理组件(AutoComplete 下拉式,防抖/高亮/分组/移动端展开),清理合并时混入的受控弹窗调用与 ⌘K 快捷键残留
- **test(search)**:`tests/api/search.test.ts` 用例"SALES 只命中自己名下记录"改为"SALES 跨 owner 可见 (read-open, 与列表页同口径)",断言 SALES 也能搜到 admin 名下客户
- **测试**:typecheck / lint / vitest 全绿(96 文件,775 用例)

## v0.19.0(2026-08-14)统计模块收口:业绩排行三维度合并 + 账龄趋势快照预计算

「员工业绩」与「区域统计」两页合并为统一的「业绩排行」页(按员工 / 按签约人 / 按区域三维度切换);账龄趋势图从每次请求实时重算 30 天改为读每日快照表。**DB schema 有变化:新增 `AgingSnapshot` 表(迁移 `20260814_aging_snapshot`,含 `GRANT ALL ... TO qt_app`)**。

变更:
- **feat(statistics)**:`/statistics/performance` 重做为统一业绩排行页 — 维度 Segmented(员工/签约人/区域,默认签约人)+ 指标 Segmented(合同额/已开票/已回款/合同数)单图切换;区间改为预设(本月/本季/本年,默认本年)优先、RangePicker 自定义兜底;区域维度行点击下钻 `/customers?district=&town=`,「未填写」行不进图表 Top N;员工/签约人维度保留业绩明细抽屉与 PDF 导出
- **feat(statistics)**:新增 `GET /api/statistics/performance?dimension=owner|signer|region&preset=&from=&to=&limit=`,服务端 `getPerformanceRanking` 复用 `getEmployeePerformance` / `getSignerSummary` / `getRegionStatistics` 三个既有口径,行级隔离在子服务内天然生效
- **feat(statistics)**:导出新增 `type=performance&dimension=...`(`业绩排行_<dimension>_<ts>.xlsx`);旧 `type=by-region` 导出保留兼容
- **feat(statistics)**:新增 `AgingSnapshot` 表 + `server/jobs/aging-snapshot.ts`(cron 每日幂等 upsert 近 30 天 × 2 基准的全局账龄桶);`getAgingTrend` 非受限角色改读快照表(单次 findMany),快照缺失日回退实时计算,受限角色(SALES/EXPERT)恒走实时计算维持行级隔离
- **refactor(lib)**:新增 `lib/date-range.ts#resolveStatsRange`(预设 > 自定义 > 默认本月,消除各统计页兜底语义漂移)与 `lib/stats-ui.ts`(统计页共享的比率阈值 / 色板 / 排名 emoji / 账龄桶常量)
- **remove(statistics)**:删除 `/statistics/by-region` 页面与菜单项(功能并入业绩排行「按区域」维度);菜单「员工业绩」更名「业绩排行」
- **fix(auth)**:登录 `sessionVersion +1` 后补 `invalidateAuthCache(user.id)`,且 jwt callback 登录分支直接落 `token.sessionVersion = user.sessionVersion`;修复快速重登(2s 缓存窗口内)签发的新 token 被旧缓存覆盖成旧 sessionVersion、缓存过期后被单点校验误踢的缺陷(e2e 连续登录同账号复现)
- **测试**:新增 `tests/api/statistics-performance.test.ts`(12 用例:三维度口径 / limit 截断 / preset 区间 / SALES 行级隔离);重写 `tests/e2e/99-performance-region.spec.ts` + `99-region-drilldown.spec.ts`(下钻区域改用 `seed:dev-customers` 固定 tier 余杭区/瓶窑镇,废弃 networkidle 改等具体响应,登录后统一关闭 AppRelease 弹窗);typecheck / lint / vitest 全绿(96 文件,782 用例)

## v0.18.11(2026-08-14)工作台月度/季度/年度 Top 5 客户按区间过滤 + 待审待开票计数修复

修复工作台月/季/年切换时数据不准确的问题:Top 5 客户此前漏传区间参数,显示的是全期数据(而非所选 月度/季度/年度 区间);「待审/待开票」此前因按 `actualIssueDate` 过滤而恒为 0,现改为独立计数待财务审核发票存量。**DB schema / migrations: 无变化**。

变更:
- **fix(dashboard)**:`app/api/dashboard/summary/route.ts` `getTopCustomers(user, "contract", 5)` 补传 `range` 参数,Top 5 客户按统计区间过滤(与 `statistics/top-customers` 同口径)
- **fix(dashboard)**:`app/api/dashboard/summary/route.ts` 新增 PENDING_FINANCE 发票独立 count(按当前存量,不受 `actualIssueDate` 区间过滤影响,与 90+ 账龄/催收中/法务介入等待办预警同口径),response `invoices.pending` 承接;修复「待审 X 张待开票」与「待办预警-待开票」恒为 0 的缺陷
- **fix(dashboard)**:`app/(app)/dashboard/page.tsx` KPI 副文案与待办预警改用 `inv.pending`,删除对 `byStatus` 中 PENDING_FINANCE 的查找
- **测试**:新增 `tests/api/dashboard-summary-range.test.ts`(3 用例:month 区间 Top 过滤 / from-to 全期对照组 / pending 独立计数);typecheck / lint / vitest 全绿(95 文件,775 用例)

## v0.18.10(2026-08-14)工作台客户区域分布柱状图恢复按镇街彩虹色

客户区域分布柱状图恢复 `colorField="town"` 按镇街彩虹着色(每个镇街独立颜色,图例可区分),保留 v0.18.9 的 Top 10 + 其他 聚合与空镇街「未录入」标注。**DB schema / migrations: 无变化**。

变更:
- **fix(dashboard)**:`app/(app)/dashboard/page.tsx` 区域分布图恢复 `colorField="town"` 彩虹着色(因已聚合 Top 10 + 其他,图例最多 11 项,不再有几十项巨型图例)
- **测试**:typecheck / lint / vitest 全绿(94 文件,772 用例)

## v0.18.9(2026-08-14)工作台客户区域分布柱状图视觉打磨

工作台「客户区域分布」柱状图视觉打磨:去除彩虹色与巨型图例,聚合 Top 10 + 其他,空镇街标注。**DB schema / migrations: 无变化**。

变更:
- **fix(dashboard)**:`app/(app)/dashboard/page.tsx` 区域分布图去掉 `colorField="town"` 彩虹色与自动生成的几十项图例,改用单色(品牌主色) + `legend: false`
- **fix(dashboard)**:前端按 count 聚合 **Top 10 + 其他**(后端 `townDistribution` 已按数量降序,口径不变);未录入镇街的客户标为「未录入」
- **fix(dashboard)**:x 轴标签 `autoHide: true` 防长镇街名重叠;卡片副标题在截断时显示「前 10」
- **测试**:typecheck / lint / vitest 全绿(94 文件,772 用例)

## v0.18.8(2026-08-14)合同详情页操作记录动作中文标签 + 语义色

合同详情页「操作记录」时间线 + 点击节点打开的详情抽屉,动作标识从英文原始码(经 StatusTag 回退显示)统一改为中文标签 + 语义色 Tag。**DB schema / migrations: 无变化**。

变更:
- **fix(contract)**:`components/contract/operation-timeline.tsx` 动作列改用 `<Tag color={shortActionTone(action)}>{shortActionLabel(action)}</Tag>`,中文标签 + 语义色(正向绿 / 负向红 / 进行中蓝 / 待定橙 / 中性灰)
- **fix(contract)**:`components/admin/operation-log-drawer.tsx` 详情抽屉「动作」字段同步改为中文标签 + 语义色
- **refactor(lib)**:`lib/operation-log-format.ts` 的 `ACTION_LABELS` 升级为 `ACTION_META`(label + tone 语义色),新增 `shortActionTone()`
- **测试**:typecheck / lint / vitest 全绿(94 文件,772 用例)

## v0.18.7(2026-08-14)消息中心前端显示优化 (Wave 2)

消息中心前端显示打磨:补齐抽屉的「加载更多」与「置顶公告」缺口,统一类型标签样式,消除冗余列与单条已读后的分页跳动。**DB schema / migrations: 无变化**。

变更:
- **fix(messages)**:抽屉加载更多 — 原 `loadMessages` 仅拉第 1 页 10 条(`messages.drawer.loadMore` 文案预留却从未接线),现支持分页追加,带 `hasMore` / `loading` 态
- **feat(messages)**:抽屉置顶公告 — 打开抽屉 / 收到 SSE kick 时拉取 `/api/announcements/pinned`,列表顶部渲染置顶公告区
- **fix(messages)**:单条已读后分页跳动 — 标记已读 / 删除 / 清空由 `reloadAndRest`(重置到第 1 页)改为 `reload`(保留当前分页)
- **refactor(messages)**:合并冗余列 — 消息页「标题」列 + 「内容」列 + `详情` 气泡合并为单一「消息」列(标题加粗 + 内容两行截断预览),移除硬编码「详情」气泡与未使用的 `Popover` 导入
- **fix(messages)**:类型标签统一 — 抽屉内手写的 `m.type` 彩色 `Tag` 改为 `<StatusTag status={m.type} domain="message" />`,与消息页一致;删除不再使用的 `MESSAGE_TYPE_COLORS` 映射
- **feat(i18n)**:新增 `messages.column.message` / `messages.drawer.loading`(中英文)
- **测试**:typecheck / lint / vitest 全绿(94 文件,772 用例)

## v0.18.6(2026-08-13)消息中心优化:事件驱动推送 + 跨页未读同步 + 置顶公告

消息中心体验升级:后端 emit 事件后即时定向 SSE kick(替代纯 5s 轮询兜底),前端跨页面共享未读计数 + SSE 监听,Drawer 与消息页统一置顶公告展示。**DB schema / migrations: 无变化**。

变更:
- **feat(notifications)**:后端事件驱动推送 — emit() 在非事务路径立即 broadcastKick(receivers),事务路径 queueKickKick 延迟到 $transaction commit 后 flushPendingKicks;5s scheduler 保留为安全兜底
- **feat(notifications)**:hub 新增 queueKickKick / flushPendingKicks / _pendingKickCount,invoice/payment/contract/status-machine 事务后自动 flush
- **feat(messages)**:前端 SSE 单例 — lib/use-message-stream.ts 重构为模块级单 EventSource + listener registry,多消费者共享单一连接
- **feat(messages)**:跨页未读同步 — lib/message-unread.ts 共享 SWR useUnreadCount() hook + refreshUnread() 全局 mutate,Dashboard Shell 与消息页统一数据源
- **feat(messages)**:置顶公告 — GET /api/announcements/pinned 端点,消息页顶部 Card 展示 pinned announcements,Drawer 同步展示
- **feat(i18n)**:9 组中英文 key(tab 标签/空态/drawer 提示/加载更多/查看全部/置顶公告标题)
- **测试**:typecheck / lint 通过

## v0.18.5(2026-08-13)行级隔离前端收口 (Wave 3)

行级隔离(RLS)前端收口:后端服务层已有 owner 校验(见 v0.18.4 前 permissions 系列提交),本版本对齐页面层——非管理员查看/编辑他人数据的入口全部按 owner 判定,直接访问 URL 也有 403/降级兜底。**DB schema / migrations: 无变化**。

变更:
- **feat(workflow)**:客户详情页编辑按钮 owner 判定(SALES/EXPERT 仅本人可编辑),编辑页直接访问兜底(T10)
- **feat(workflow)**:合同详情页编辑按钮 owner 判定(草稿放宽管理员),编辑页直接访问兜底(T11)
- **feat(workflow)**:发票详情页 owner 判定(仅 ADMIN/FINANCE/owner),`getInvoice` 带出 `contract.ownerUserId`,`Invoice` 类型补 owner 字段,编辑页直接访问兜底,新建页合同选择器只列本人合同(T12)
- **feat(workflow)**:回款新建页合同选择器 owner 过滤,只列本人合同(T13)
- **feat(workflow)**:员工档案 403 降级基本联系卡(不外泄敏感字段),敏感区仅 ADMIN 可见,证书到期页门禁放开 OPS 查看(T14)
- **测试**:typecheck / lint / vitest 全绿(94 文件,772 用例)

## v0.18.4(2026-08-11) 全局搜索

新增全局搜索功能，支持跨客户/合同/发票/回款快速检索。

变更:
- **feat(search)**:全局搜索 — Header 右侧搜索图标 + `Cmd+K` / `Ctrl+K` 快捷键触发
  - 搜索范围:客户(名称/编号/联系人/电话)、合同(合同号/标题/客户名)、发票(发票号/代码/客户名)、回款(回款号/流水号/客户名)
  - 实时搜索:300ms 防抖，按实体类型分组展示，键盘导航(↑↓ 选择 / Enter 跳转 / Esc 关闭)
  - 权限控制:RBAC + 行级隔离(SALES/EXPERT 只能搜自己负责的数据)
  - API: `GET /api/search?q=keyword`，返回 `{ customers, contracts, invoices, payments }`
- **test(search)**:搜索服务测试覆盖 — 11 个用例(关键词校验/各实体搜索/结果结构/行级隔离)

新增文件:
- `server/services/search.ts` — 搜索业务逻辑
- `app/api/search/route.ts` — API 路由
- `components/global-search.tsx` — 搜索 Modal 组件
- `tests/api/search.test.ts` — API 测试

---

## v0.17.0(2026-08-02) 去掉 docker fallback 应急回退

docker qt-app 镜像 (`qt-app:latest` **DEPRECATED**) 已删, 留出来的 1.49GB 不再用。
不再维护 docker 应急回退能力 — release 永远 forward, native 是唯一路径。

变更:
- **`docker rmi qt-app:latest`** (**DEPRECATED**): 镜像已删; 服务器现在只跑 postgres + minio 两个容器 (active)
- **`scripts/prod/rollback.sh`**:移除 `--docker` flag; 调它现在 unknown flag 报错退出
- **`scripts/prod/deploy.sh`**:磁盘清理段简化, 只清 dangling intermediate + builder cache; 无 KEEP=1 的 qt-app 保留逻辑
- **`scripts/prod/switch-to-native.sh`**:标记为历史脚本 (一次性已用); docker qt-app 不再存在, 再跑会在 preflight `docker inspect qt-app` 失败退出
- **`docker-compose.prod.yml` `app:` 块** 保持注释; pg/minio 块正常 (数据卷 + Dockerfile 留着, 仅为文档/历史参考)

回滚 (自此只有 native 路径):
- `bash scripts/prod/rollback.sh` — 默认 HEAD~1
- `bash scripts/prod/rollback.sh --to <sha|tag>` — 任意 commit
- `bash scripts/prod/rollback.sh --list` — 候选

磁盘影响:
| 项 | 前 | 后 |
|---|---|---|
| docker images 总占用 | ~1.94GB | ~451MB |
| 总盘 avail | 16G | **21G** |
| Use% | 67% | **56%** |

如果未来需要复活 docker fallback, 见 v0.17.1 段。

---

## v0.17.1(2026-08-02) 全链路标 DEPRECATED

v0.17.0 仅清理了镜像, 没改 docs/code 里的引用。v0.17.1 统一打 `DEPRECATED` 标签:

- `Dockerfile` 顶部 16 行 `~~~~~~~~~~~~~~~~~~~~~~~~~~~~ DEPRECATED ~~~~~~~~~~~~~~~~~~~~~~~~~~~~` banner; 原代码保留 (应急 docker build 还能用)
- `docker-compose.prod.yml` 顶部 banner; `app:` 块加 DEPRECATED 注释
- `scripts/prod/deploy.sh:62` 错误信息改成 "qt-app:latest 镜像已 DEPRECATED, 不再是 fallback"
- `scripts/prod/rollback.sh:33` 注释明确标 DEPRECATED
- `scripts/prod/remote-deploy.sh:32` 注释里的 `[remote] ==> docker build qt-app:v0.13.8` 文档示例换成 native
- `AGENTS.md` / `README.md` / `docs/ops/deploy-current.md` 同步加 `**DEPRECATED**` 标记

历史档案 (`CHANGELOG.md` v0.16 及更早段, `docs/ops/deploy-history/*.md`) **不动** — 历史就是历史。

复活 docker fallback 的 3 步 (仍在, 但 DEPRECATED):
```
git checkout <commit>
docker build -t qt-app:latest .   # Dockerfile 不动, build chain 没破
docker compose -f docker-compose.prod.yml up -d app  # 反注释 app 块
```

建议: 当前 49G / 21G 够用, 维持 native。

---

---

## v0.18.0(2026-08-02) 权限矩阵梳理 + 三处 service 守门加固

非 ADMIN 四个角色的权限做了重新分配, 同时 3 处 service 入口补强. 详见 docs/history/security/permissions-audit-2026-08-02.md (审计报告).

### 权限矩阵调整

- DUNNING (催收): SALES / EXPERT 从 CRUD 降为 CR (现场可记录/查看, 不能改既有条目); FINANCE 从 CRU 升为 CRUD (财务对账留痕, 拿全控). 此前 SALES 拿到 DELETE 可以删催收, 审计链断.
- EXPERT.INVOICE: 从 CRU+导出 降为 R+导出 (技术专家不再开票/改票). 商业发起归 SALES. EXPERT 仍能在交付完成后导出对账数据.
- EXPERT.DUNNING: 与 SALES 对齐改 CR.

### Service 守门加固

- trash 服务: getTrashList / restoreRecord 入口硬卡 roleCode === ADMIN. 此前只检 CUSTOMER.READ, 任意有读权限的角色绕过菜单都能直接 GET /api/admin/trash 拉到全公司软删清单.
- announcement 服务: updateAnnouncement / softDeleteAnnouncement 加 publishUserId === actor.id || roleCode === ADMIN 守门. 此前 OPS 之间可互相改/删他人公告.
- storage/presign.ts 加注明确 OPS 不在合同/发票附件白名单, 由 owner/signer/FINANCE/ADMIN 兜底; 行为不变.

### 清理 / 文档

- lib/permissions.ts 删 ACTION.AUDIT 死枚举 + components/admin/permission-matrix.tsx 同步去列 (原本就只有空列).
- docs/user/USER_MANUAL.md 3.2 权限矩阵同步变更; 3.1 OPS 职责描述明确为"部门 / 公告 / 字典 R".
- docs/architecture/DESIGN-v3.md 3.2 同步.

### 影响 / 兼容性

- SALES / EXPERT: 不能 update / delete 催收记录; EXPERT 不能再开票. 通过 Authority 自动隐藏按钮.
- OPS: 菜单里"部门/公告"工作流未受影响; 仅交叉用户修改他人公告 / 删合同/回收站被服务层挡住.
- DB schema / migrations: 无变化 (纯 role 矩阵 + 入口守卫, DB 通用).

## v0.18.1(2026-08-02) 权限细化 + 数据字典只读/拒写

v0.18.0 权限收紧的延伸: 同主题内把 EXPERT/OPS 行级再细一刀, 干掉「编辑不生效」的假功能, 修字典的 4 个隐藏 bug, 把字典种子双源并一. 详见 `docs/superpowers/specs/2026-08-02-permissions-dictionary-redesign-design.md` 与 `docs/superpowers/plans/2026-08-02-permissions-dictionary-redesign.md`.

### 权限矩阵精细化

- EXPERT: PAYMENT 从 `CR+导出` 降为 `R+导出`, DUNNING 从 `CR` 降为 `R`. EXPERT 仍是客户/合同的主体 (行级隔离同 SALES), 但钱相关一刀切只读 + 商业动作 (开票/回款登记/催收记录) 归 SALES 与财务.
- OPS: CUSTOMER 从 `CRU+导出` 降为 `R+导出`. 客户资料 owner 是销售, 行政不再代录.
- SALES / FINANCE 不动.

### `/admin/roles` 只读化

- 服务层: `createRole` 一律 403 (自定义角色已停用); 系统角色 (isSystem) 的 `permissions/code` 不可改, 仅 `name/description` 可改 (展示文案).
- 路由层: 删除 `/admin/roles/new` 与 `/admin/roles/[id]/edit` 页面; 列表页加 Alert 说明运行时真源是 `lib/permissions.ts` 的硬编码矩阵, 不是 DB.
- `PermissionMatrix` 补齐 14 资源 (原缺 DEPARTMENT / DUNNING / APP_RELEASE).

### 数据字典 9 类枚举约束只读

约束来源是 `types/enums.ts` 的 zod 枚举 + 状态机代码, 字典表改 label/sort 不生效, 反误导:

- `lib/dict-domain.ts` `DICT_META` 给 CUSTOMER_TYPE / CUSTOMER_SCALE / CONTRACT_PAYMENT_METHOD / INVOICE_TYPE / PAYMENT_RECEIVE_METHOD / REVIEW_ACTION / CONTRACT_STATUS / INVOICE_STATUS / PAYMENT_STATUS 翻 `readonly: true`.
- `server/services/dictionary.ts` 加 `assertWritableCategory`, `createDict` / `updateDict` / `softDisableDict` / `reorder` 对 readonly 类目统一抛 `403 FORBIDDEN`.
- 前端 `DictEditDrawer` / `DictTableView` / `CreateDictDrawer` 原生按 `readonly` 渲染锁标 + 禁写, 业务逻辑只需翻标记.

### 字典 bug 修复

- **`refreshDict` 真正失效 `useDict` 缓存**: 原 `subs/notify` 是死代码, 从不注册回调. 改用 SWR `mutate("dict-{category}")`, admin 字典页新增/编辑/启停/批量后调用 `refreshDict(category)`, 同标签页其他页面下拉即时刷新. **跨标签页不广播**(已知限制, 写入维护文档).
- **`DictEditDrawer` 只读判断改用 `category`**: 原代码用 `code` 头字符判断与具体业务耦合, 改成读 `DICT_META[cat].readonly`.
- **删除合同详情页幽灵 `useDict("PAYMENT_METHOD")`**: 类目不存在 (正确名 `CONTRACT_PAYMENT_METHOD`), 永远返回空数组; 改成直接用 `PAYMENT_METHOD_MAP` (覆盖全部 4 个枚举值).
- **建字典 code 正则放宽**: `/^[A-Z][A-Z0-9_.]*$/` (允许点号), 与存量树形 code (如 `R2.30`) 对齐; 前端 `CreateDictDrawer` 的 zod 校验同步.

### 字典种子双源合一

- 新增唯一定义源 `scripts/shared/dict-defs.ts`, `prisma/seed.ts` 与 `scripts/shared/seed-dicts.ts` 都从它 import, 消除此前 6 条 SERVICE_TYPE label 漂移.
- 移除已下线的 `CUSTOMER_STATUS` (v0.5.0) 与从未进白名单的 `PROJECT_STATUS`. 保留 `PERSONNEL_CERT_TYPE` (人员证书模块预留, 仅 legacy 分支可读).
- 字典 `ALLOWED_DICTIONARY_CATEGORIES` / `BUSINESS_CATEGORIES` 加 `EDUCATION_LEVEL` (员工-最高学历) 与 `CONTRACT_TYPE` (员工-合同类型), 重新归类为业务域.

### 文档同步

- `docs/user/USER_MANUAL.md` §3.1/§3.2 EXPERT·OPS 矩阵、§12.2 角色页只读说明、§12.4 字典 9 类只读规则.
- `docs/architecture/DESIGN-v3.md` §3.1 OPS、§3.2 矩阵同步 v0.18.1.
- `docs/ops/dictionary-maintenance.md` 整体重写: 单点真源改 `dict-defs.ts`、3 处加类目清单、code 正则、`refreshDict` 已知限制.

### 影响 / 兼容性

- EXPERT: 不能登记回款 / 记录催收; OPS: 不能新建/编辑客户. 走现有 `Authority` 自动隐藏按钮, 但旧 IFLOW 直接命中会被 service 拒 (403).
- 字典前端: 9 类只读类目立刻禁用所有写按钮 (历史数据不受影响).
- DB schema / migrations: 无变化 (纯 role 矩阵细化 + 字典 schema 旁路拒绝, 与 v0.18.0 同).

## v0.18.2(2026-08-02) 修复 deploy.sh 的 npm ci devDeps 漏装

v0.18.1 首次部署失败定位: 服务器 `.env` 设了 `NODE_ENV=production`, `deploy.sh:71 set -a; . ./.env` 会把它注入 npm ci 的环境, 而 npm 看到 production 会自动 omit=dev, 把 `prisma / tsx / vitest / eslint` 等 devDependencies 全部跳过安装。表现是 `npx prisma generate` 临时下载 prisma 找不到 `prisma/config` 模块 → `Failed to load config file`。

v0.18.0 部署时靠 prisma 在 node_modules 残留, 没暴露; v0.18.1 那次 `npm ci` 把残留清掉了, 才触发。

### 改动

- `scripts/prod/deploy.sh` 在 `npm ci` 前 `save_NODE_ENV="$NODE_ENV"; unset NODE_ENV`, 调用完后 `export NODE_ENV="$save_NODE_ENV"` 还原 (供 `next build` 与 systemd runtime 用 production 语义)。
- **不动 `.env` / `.npmrc`**: `NODE_ENV=production` 是运行时配置 (Next + systemd), 不能改。

### 验证

- 服务器手动 `unset NODE_ENV && npm ci` 后 `node_modules/.bin/prisma` 出现, `prisma generate` 通过。
- 本机重启 `npm run typecheck / lint / test` 全绿 (86 文件 / 661 用例)。

## v0.18.3(2026-08-02) ADMIN 可在 /admin/roles 直接调整角色权限 (运行时真源由代码矩阵翻到 DB)

v0.18.0 / v0.18.1 把权限矩阵收紧 + 把 `/admin/roles` 改成只读, 当时的口径是「运行时真源 = lib/permissions.ts 硬编码矩阵, DB 副本仅展示」。本版本反转这个口径: **运行时真源改为 DB `Role.permissions`**, admin 可在 `/admin/roles` 直接编辑 (含系统角色), 保存后 ≤2s 内全员生效. 自定义角色 (createRole) 仍未开放, 单独再做.

### 真源翻转

- `lib/permissions.ts`: 顶部 `ROLE_PERMISSIONS` 改为 seed bootstrap + DB 不可用兜底, 新增 `runtimePermissions` 进程级缓存; `hasPermission` / `requirePermission` 先查缓存, 查不到回退矩阵. 导出 `setRuntimePermissions` / `clearRuntimePermissions` / `_resetRuntimePermissionsForTests` 给上层调用.
- `lib/auth.ts`: `session` callback 每次请求 `loadRolePermissions(roleCode)` 从 DB 拉当前权限 (2s TTL rolePermCache), 灌进 `runtimePermissions` 并挂到 `session.user.permissions`. DB 不可用时 fallback 到 `ROLE_PERMISSIONS` (避免一个 DB 抖动让全员 500).
- 现有 173 处 `requirePermission(roleCode, ...)` 调用 **零改动** — 签名不变, 行为变化是透明的.
- `scripts/shared/seed-roles.ts` 不动: 仍然把 `ROLE_PERMISSIONS` upsert 到 DB, 兼容 fresh DB bootstrap.

### `/admin/roles` 编辑入口

- 列表页: 行操作加 **「编辑权限」** → `/admin/roles/[id]/edit`; Alert 文案从「运行时真源是代码矩阵」改为「运行时真源是 DB, 编辑后 ≤2s 全员生效」.
- 详情页: 加 **「编辑权限」** 按钮跳编辑页; 副标题展示更新时间, 方便 audit 对照.
- 新增 `/admin/roles/[id]/edit` 编辑页:
  - 名称 / 说明: `<Input>` + `<Input.TextArea>` 受控 (覆盖范围跟现有 API 一致).
  - 权限矩阵: 复用 `components/admin/permission-matrix.tsx` (早已支持 `onChange` / `readOnly`).
  - ADMIN 角色: 顶部黄色 Alert 提醒 [角色] 资源的读+改必须保留, 否则保存被服务端拒; 客户端先做 disabled 兜底.
  - dirty 检测 + 保存按钮 disabled; 保存 → `PATCH /api/roles/[id]`, 成功后 toast + 跳详情.

### `updateRole` service 安全护栏

- 去掉 v0.18.0/0.18.1 的「系统角色 permissions/code 不可改 → 403」拦截. 现在 admin 可改任意角色, 含 5 个系统角色.
- **ADMIN 锁死护栏**: ADMIN 角色 permissions 必须保留 `RESOURCE.ROLE` 的 `READ + UPDATE`. 缺失任一即 `403 FORBIDDEN 锁死护栏` — 否则后续无人能调回 (含你自己).
- **空 permissions** → `400 VALIDATION_FAILED 权限不能为空`.
- **code 改名去重**: 改成已存在 → `409 角色代码 X 已被使用`. 系统角色 code 改成 `RoleCode` 联合外的值 → `400 系统角色代码必须是 ADMIN/SALES/FINANCE/OPS/EXPERT 之一` (避免运行时崩).
- **等价 permissions / 仅改名** → 不触发缓存失效 (permissionsEqual 函数判定).

### 缓存失效策略 (≤2s 全员生效)

每次 `updateRole` 检测到 permissions 或 code 真有变化:
1. `prisma.user.findMany({ roleId })` → 拿所有活跃用户 id.
2. `prisma.user.updateMany` → 所有这些用户 `roleVersion + 1` (用户能感知到 epoch 变化).
3. 对每个用户 `invalidateAuthCache(uid)` 清 2s `userCache` — 下个请求 jwt callback 重读 DB.
4. `invalidateRolePermCache(existing.code)` + (如 code 改名) `invalidateRolePermCache(updated.code)`.
5. `setRuntimePermissions(updated.code, newPerms)` 立即让本进程生效 — 即使其他用户的 userCache 还没失效, 他们访问的 service 也会读到新权限.

`deleteRole` 同步清 `clearRuntimePermissions(code)` + `invalidateRolePermCache(code)`, 避免残余权限被后续请求看到.

### 旧行为的兼容

- 5 个 `dev:test` 账号 (`admin/sales/finance/ops/expert`) 登录后看到的权限与之前完全一致 — 因为 seed 把 `ROLE_PERMISSIONS` 写到了 DB, session callback 从 DB 读到的就是同一份.
- `tests/permissions.test.ts` 10 条硬编码矩阵断言原样通过.
- `createRole` 仍 `403 FORBIDDEN` (自定义角色另行单独做, 不是本次范围).

### 测试

- 新增 `tests/unit/server/role-update.test.ts` (15 条): 锁死护栏 / 空权限 / 缓存失效 / code 改名护栏 / 审计字段 / `deleteRole` 清缓存.
- 新增 `tests/permissions-runtime.test.ts` (7 条): `setRuntimePermissions` / `clearRuntimePermissions` / `_resetRuntimePermissionsForTests` 单测, 含 DB-only 自定义角色场景.
- 全量 `vitest run`: 88 个文件 / 683 条用例全绿.
- E2E 通过 dev server + curl 走通: admin 登录 → PATCH SALES → 重登 sales 看新权限 → restore → ADMIN 锁死护栏 403 → 空权限 400 → code 改名冲突 409 → code 改名超联合 400 → 全链路 SALES 用户 `roleVersion` 从 2 → 3.

### 影响 / 兼容性

- 行为变化对用户透明: 5 个 dev 账号登录后看到的菜单/按钮与之前完全相同 (DB 与旧硬编码矩阵完全对齐).
- admin 的「新能力」: 直接调权, 不再需要改 `lib/permissions.ts` + 发版 + 跑 seed. 风险面更广, 因此同时上了 ADMIN 锁死护栏.
- DB schema / migrations: 无变化 (纯运行时逻辑).
- 现有 173 处 `requirePermission` 调用零改动 (签名兼容).

---

## v0.16.0(2026-08-02) 部署架构迁移 — native systemd 主路径

部署耗时从 ~14 分钟压到 30s–2min,根因 3.5GB ECS 内存被 dockerd (1.7GB) + hermes-agent (0.5GB) 吃掉大头,build 阶段只能 swap。

变更:
- **`scripts/prod/deploy.sh`** 全面重写:native `next build`(复 `.next/cache/` 走 Turbopack 增量)替换 `docker build`;`systemctl restart qt-app.service` 替换 `compose up -d app`
- **`scripts/prod/rollback.sh`** 重写:默认 native 回滚(`git checkout + 增量 build`);`--docker` flag 切回 docker 应急
- **`scripts/prod/switch-to-native.sh`** (新增):首次切 native 的一键脚本,自动停 docker qt-app、enable systemd、smoke test、备份 `docker-compose.prod.yml.bak-pre-native`
- **`ops/qt-app.service`** 同步:跟实际部署一致(User=root + 直接 node 启动)
- **postgres / minio 仍留 docker**:数据卷 `/opt/qt/docker-data/` 不动
- **`npm ci` 智能跳过**:仅在 `package.json / package-lock.json / patches/ / prisma/` 变化时跑,常规部署 0s
- **release:publish / prisma migrate deploy** 也走 native,不再 docker run --rm
- **`docker image prune` KEEP=1** (`qt-app:latest` DEPRECATED): 留 1 版给 `--docker` 应急用

性能 vs 原架构:
| 改动类型 | 原 docker deploy | 新 native deploy |
|---|---|---|
| 纯文档/注释 | ~14min | ~30s |
| 改 lib 工具 | ~14min | ~1-2min |
| 改 prisma schema | ~15min(需重 build) | ~2-3min(client 重生)+ migrate |
| 改 package.json | ~15min | ~1min + npm ci |
| Lockfile 大变 | ~15min | ~3min(npm ci) |

回滚:
- 上一版本:`bash scripts/prod/rollback.sh`(默认)
- 任意 commit: `bash scripts/prod/rollback.sh --to <sha>`
- 应急到 docker: `bash scripts/prod/rollback.sh --docker`

详细文档: [docs/ops/deploy-current.md](docs/ops/deploy-current.md)

---

## 重大里程碑

- **v0.15.0(2026-08-01)**: 强制单点登录 — User 加 sessionVersion 字段,登录时 +1, jwt callback 校验不等时返 null; 旧设备的 JWT 立即失效; admin 可在员工详情页"踢出所有设备"按钮主动让某用户下线。渐进式动迁(只影响 deploy 后新登录,旧会话不受打扰)
- **v0.14.0(2026-08-01)**: 消息中心全面优化 — 行级去重(entityKey + @@unique + skipDuplicates)压 58% 增长;MessageArchive 归档表 90d cron + admin 查看页(/admin/messages);SSE 端点 + 进程内 hub + 5s kick 调度把通知延迟从 60s 压缩到 ≤5s;i18n 系统升级支持参数占位符;Bell badge overflowCount=99+ 上限;UI 新增"清空已读"批量按钮。详细见 README 「最近更新」v0.14.0 段
- **v0.10.2(2026-07-17)**: 业务不变量与行级隔离修复 — R-08 开票上限补 PENDING_FINANCE 口径 + submit/issue 复检 + 锁合同行消竞态;EXPERT 行级隔离生效(`isRowRestricted`);账龄统计越权;红冲"已开票"口径统一(`INVOICE_ISSUED_AMOUNT_STATUSES`);raw 软删附件 404 + presign-upload 归属校验;with-profile 接入"最后 ADMIN"护栏,详见 README 「最近更新」v0.10.2 段
- **v0.10.1(2026-07-13)**: 安全与并发修复 — 密码重置链路加固 + 文件下载代理审计/响应头 + 回款确认 FOR UPDATE + advisory lock + 合同总额调小锁行 + Zod 错误脱敏,详见 README 「最近更新」v0.10.1 段
- **v0.10.0(2026-07-11)**: 登录安全加固 — 限速 + 失败计数锁定 + 审计日志 + 自服务密码重置 + 开放重定向 URL 白名单;新增 `User.mustChangePassword / failedLoginCount / lockedUntil / lastFailedLoginAt / roleVersion` 5 字段 + 新表 `PasswordResetToken`(migration `20260711_login_security_hardening`),详见 [docs/history/security/login-security-review-2026-07-11.md](docs/history/security/login-security-review-2026-07-11.md) 与 README 「最近更新」v0.10.0 段
- **v0.9.7(2026-07-08)**: 日期与日期时间显示/导出统一为 `YYYY-MM-DD` 风格 — `lib/format.ts` 切到本地时区 + 18 处 `toLocaleDateString/toLocaleString('zh-CN')` 改走中央 helper;空值回退(`""` / `"—"` / `"-"`)按各调用点原地保留
- **v0.8.2(2026-07-04)**: 回滚 9a48265 (CI 暴露 schema migration 冲突, 19 个代码/lib 文件 + 3 migration 目录回退到 ced7665) + README 乱码修复(从 v0.8.1 还原 blob + 追加修复叙事段) + 删 CI/GitHub 自动部署 (改回本地开发 + 运维手动部署)
- **v0.8.0(2026-07-03)**: 报表中心 PDF 5 字段对齐 + Excel 多 sheet + 移除自动生成 (cron 删了, 走手动) + 文件名时间戳 (YYYY-MM-DD_HHMM)
- **v0.6.0(2026-06-29)**:cron 静默失败 9 个月事故复盘 (242 个合同 269 万应收恢复) + reopen API + force 旁路 + cron-healthcheck 自检 + 强关 7/3/1 醒目文案 + postmortem reopen vs force 业务选择指南 + Timeline icon 对称 + serviceTypeLabel helper + by-region Tooltip
- **v0.5.1+(2026-06-29)**:统计区间月度/季度/年度切换 + dashboard 客户统计口径重命名 + system actor seed + 合同 owner 默认值 + 证书页 bug + 迁移漂移恢复 + AI 团队配置 + 清理 18 个孤儿脚本/lib 文件
- **v0.5.1(2026-06-29)**:Excel 导出文件名国际化 + 合同选择器显示合同总额
- **v0.5.0(2026-06-29)**:客户状态机下线(硬删, BREAKING; 5 态/4 规则/撤销横幅 全删; Customer 表无 status)
- **v0.3.0(2026-06-23/24)**:企业资产库下线 + 统计分析 round-2 收尾 + 合同 7→3 状态机 + 项目/工作流模块删除
- **v0.2.0(2026-06-22)**:合同/项目收紧 + 业务纯化
- **v0.1.0(2026-06-11)**:上线前清理 — 清空 136 个 lint warnings,登录页 + 顶部导航品牌化,统一仓库 `core.autocrlf=false`
- **v0.1.0-rc.1**:MinIO 接入(presign upload/download + Attachment 表 + CORS);Docker 合并为单 image;合同/发票上传/预览/下载/删除端到端打通
- **P3**:RLS 策略 + 备份脚本 + Vercel Cron(原通知三通道已合并到站内信)
- **P2**:领域事件总线 + 4 个定时任务 + 统计分析 + xlsx 导出 + 软删除
- **P1**:四大模块 CRUD + 16 条跨模块校验 + 27/27 e2e
- **P0**:项目脚手架 + 登录 + 字典种子 + 5 角色权限

## 详细变更

### v0.15.0(2026-08-01) 强制单点登录

- **User 新增 `sessionVersion Int @default(0)` 字段**,migration `20260801151832_user_session_version`
- **登录时 +1**:`authorize()` 成功后 `prisma.user.update({ data: { sessionVersion: { increment: 1 } } })`, 用新值签发 JWT
- **JWT 携带 `sessionVersion`**:`lib/auth.ts` declare module "next-auth" JWT/Session/User 都加上
- **jwt callback 校验**:`loadActiveUser` 缓存(2s TTL)多查 `sessionVersion` 一列,**不增加 DB 请求数**; `token.sessionVersion !== u.sessionVersion` 返 null
  - 校验失败 → NextAuth 把 null 当无 session → 重定向到 `/login?error=SessionRequired`
  - 缓存命中最多 2s 延迟,实际生效几乎实时
- **前端提示**:`app/login/login-client.tsx` `useEffect` 监听 `?error=SessionRequired` 或 `?reason=session-revoked`,显示"您的账号在另一台设备登录,已自动登出。如非本人操作,请尽快修改密码"
- **Admin 主动踢人**:
  - service `kickUserSessions(actor, targetUserId)` (server/services/user.ts): `+1 sessionVersion` + 写 `USER_KICK_SESSIONS` audit + 调 `invalidateAuthCache` 清缓存
  - API `POST /api/admin/users/[id]/kick-sessions` (admin 限定, USER.UPDATE 权限)
  - UI 按钮 `/admin/users/[id]` 页面 "踢出所有设备" (DisconnectOutlined 图标, danger 风格) + 二次确认 Modal, 成功后 mutateUser 刷新
- **不动 roleVersion** (已存在但未启用, 职责留给"角色变更失效"用)
- **不动 mustChangePassword** (独立流)
- **不重发事件到旧设备** (新设备 +1 时不通知旧设备, 用户下次访问自动跳登录页; 复杂度低)

测试:
- `tests/unit/lib/auth.test.ts` (新, 4 用例):
  - `normalizeEmployeeNo` trim + toLowerCase + null/undefined
  - `invalidateAuthCache` 不抛
  - `prisma.user.update({ sessionVersion: { increment: 1 } })` SQL intent 验证
  - 完整 jwt callback sessionVersion 校验在 e2e 覆盖 (tests/api/auth-*.test.ts)

验证:
- typecheck 0 / lint 0 / test **84 files / 643 tests 全过** (新增 4 个 auth 测试)
- 渐进式动迁: 部署后只影响新登录的设备, 现有已登录用户 JWT 仍是旧 sessionVersion (default 0), 仍匹配, 不受打扰

### v0.14.0(2026-08-01) 消息中心全面优化

#### 行级去重 (PR 2)
- Prisma schema: Message 新增 `entityKey String?` (业务实体键 `type:linkId`) + `@@unique([entityKey, receiverUserId])` (NULL 多行不冲突);migration `20260801132108_message_entity_key_dedupe` 一次性 backfill 4482 条历史 link.id 为 entityKey + `keep_min` 去重
- `server/events/bus.ts`:`DomainEvent.entityKey?` 可选字段;`createMany({ data, skipDuplicates: true })` 作 @@unique 兜底
- 5 个 emit 调用点显式传 entityKey: stale-contract × 2 / certificate-expiry-check / runner × 2 / payment
- `server/services/message.ts`: 新增 `clearReadMessages(user)` — 批量 deleteMany + 单条 `MESSAGE_CLEAR_READ` audit
- `app/api/messages/read/clear/route.ts`: POST 一键清空接口
- UI: `/messages` PageHeader 加"清空已读"按钮(带二次确认);Header drawer 在 inbox 全已读时显示"清空"链接

#### 归档 (PR 3)
- 新 `MessageArchive` 表 (append-only): id, receiverUserId, type, title, content, link, entityKey, readAt, createdAt, **archivedAt**
- migration `20260801132739_message_archive`
- `server/jobs/message-archive.ts`: `runMessageArchive(now)` — 找 `readAt != null && readAt < (now - 90d)` 的消息(BATCH 1000)→ $transaction: `messageArchive.createMany({ skipDuplicates })` + `message.deleteMany`;env `MESSAGE_ARCHIVE_AFTER_DAYS` 覆盖默认 90
- `server/jobs/runner.ts`: 在 `runAllJobs` 末尾注册 `message-archive` (与现有 5 个 job 同过 hourly tick)
- `app/api/admin/messages-archive/route.ts` + `app/(app)/admin/messages/page.tsx`: ADMIN 专属只读页(月份过滤 + ProTable,列含类型/标题/内容/接收人/链接/创建/归档时间)
- `server/services/message.ts`: `listArchivedMessages` 显式校验 `roleCode === "ADMIN"` (兜底 403)

#### SSE 实时通知 (PR 4)
- 新 `app/api/messages/stream/route.ts`: GET, runtime=nodejs, maxDuration=3600, dynamic=force-dynamic, 25s 心跳 `:keepalive`, 立即推 `event: ready`
- 新 `server/notifications/hub.ts`: 进程内 in-memory `Map<userId, Set<Subscriber>>` + `subscribe / broadcastKick / broadcastKickAll`
- 新 `server/notifications/scheduler.ts`: 5s setInterval `broadcastKickAll`;globalThis 哨兵防 Next.js dev hot-reload 重复启动;`interval.unref()` 不阻塞进程退出
- 新 `lib/use-message-stream.ts`: EventSource hook, `onKick` callback;卸载自动 close
- 新 `lib/logger.ts`: 轻量 debug/info/warn/error,无外部依赖
- `components/dashboard-shell.tsx`: 60s polling 之后挂 `useMessageStream onKick = loadUnread + (drawerOpen ? loadMessages)`;60s polling 保留作为 EventSource 失败的兜底
- `ops/nginx/qt-biz.conf`: 加 `/api/messages/stream` SSE 块 — `proxy_buffering off`, `proxy_cache off`, `proxy_read_timeout 1h`, `Cache-Control: no-store, no-transform`, `X-Accel-Buffering: no`

#### UI 微调 (PR 1)
- `components/dashboard-shell.tsx`: Bell badge 加 `overflowCount={99}`, 超过显示 `99+` 避免 4 位数压力
- `lib/i18n.ts`: `format()` 占位符替换 + `getT`/`useT` 接受 `params`;加 `messages.toast.markedRead` (zh/en)
- `app/(app)/messages/page.tsx`: 硬编码 `msg.success(\`已标记 ${n} 条消息为已读\`)` 改用 `t("messages.toast.markedRead", { n })`

#### 验证
- typecheck 0 errors / lint 0 warnings / **test 83 files / 639 tests 全过** (新增 11 用例: events-bus skipDuplicates + message clearRead + message-archive cron + notifications-hub)
- 生产数据验证: migration 后 entityKey backfill 4482/4482 = 100% 覆盖, zero (entityKey, receiverUserId) 重复行
- 部署注意: 服务器 `sudo cp ops/nginx/qt-biz.conf /etc/nginx/conf.d/qt-biz.conf && sudo nginx -t && sudo systemctl reload nginx` 让 SSE block 生效

### v0.13.9(2026-08-01) KPI 口径说明与全站 tooltip/subtitle 批量校正

- **KPI 标题 ⓘ 口径**(dashboard/page.tsx):对照 server/services/statistics.ts + lib/invoice-amounts.ts + prisma/schema.prisma 实际实现, 4 个 KPI tooltip 描述与代码一致:
  - 客户总数:`deletedAt IS NULL` + `本期新增按 createdAt`
  - 合同总额:`status IN [ACTIVE, CLOSED]` + `isLegacyZeroAmount = false` + `signDate` + `totalAmount` (含税)
  - 已开票额:口径 `INVOICE_ISSUED_AMOUNT_STATUSES = [ISSUED, RED_FLUSHED]` (v0.10.2 起统一);RED_FLUSHED 原票按 +A 计入,冲票 ISSUED 按 -A 计入,一对红冲净额归零;DRAFT/PENDING_FINANCE/REJECTED/VOIDED 不计
  - 已回款额:`status IN [CONFIRMED, RECONCILED]` + `receivedAt`;PLANNED/REFUNDED/CANCELLED 不计

- **账龄 KPI ⓘ**:补 `dueDate` 缺时 fallback 到 `actualIssueDate` + 应收 = 发票金额 − 已回款 (>0.01 元才计入) + 超期公式 + 两种基准的语义差异 (due = 合同违约;issue = 账龄流转)

- **全站 tooltip/subtitle 批量修正**(9 处,详见 commit fc7aa0b2):
  - `customers/new` subtitle:删除 v0.5.0 已硬删的 "进入洽谈中状态" 误导句
  - `admin/users/[id]/edit` 姓名字段:删除错位的 tooltip(之前说"不可修改",但姓名字段可编辑)
  - `invoices/new` FormSection:"已生效或执行中" → "生效中 (ACTIVE)"(合同 enum 实际只有 DRAFT/ACTIVE/CLOSED)
  - `invoices/new` 剩余可开票额度 hint:"含草稿/待审" → "草稿/待审/已开/红冲"(INVOICE_LIMIT_COUNTED_STATUSES 实际 4 个状态)
  - `admin/trash` subtitle:删除 v0.3.0 已删的 "项目、工作流模板"
  - `dashboard` subtitle:加 permHint ⓘ 说明
  - `lib/i18n aging.subtitle`:"按发票/到期日" → "按开票日/到期日"
  - `invoices/new` subtitle:"提交后由财务审核" → "保存后可在详情页提交财务审核"(保存只是 DRAFT)
  - `contracts/[id]/edit` subtitle:补 "止期必须晚于起期, 否则无法保存" 约束

**版本号**: `0.13.8` → `0.13.9` (patch bump,纯文档/UI文案,无 schema / API 契约变更)

**部署说明**: 无 migration, deploy.sh 常规流程。release:publish 自动写 AppRelease (覆盖 b53ccecd + fc7aa0b2 共 2 个 docs commit), 用户登录弹窗展示。

### v0.13.8(2026-08-01) 部署链路优化:远端触发 + preflight + 一键回滚

- **抽出公共库** `scripts/prod/_lib.sh`: `log` / `log_warn` / `log_err` / `log_ok` / `preflight_check` / `smoke_test` / `require_root_or_docker`,`deploy.sh` 和 `rollback.sh` 通过 self-rewrite 护栏把它复制到 `/tmp` 再 source(避免 self-rewrite 路径丢函数)。
- **`deploy.sh` 加 preflight**(替换原来散落的 echo): 检查 `.env` 含 8 个关键 key + git 干净 + 磁盘 ≥3G + 可用内存 ≥1500MB(warn) + `qt-postgres`/`qt-minio` 容器健康。任一硬失败即 exit 1,给出可操作修法。
- **`deploy.sh` 持久化日志**: 每次输出同时写到 `/var/log/qt-deploy.log`(`DEPLOY_LOG=: ` 关闭);`smoke_test` 由 `_lib.sh` 提供,失败时提示跑 `rollback.sh`。
- **新增 `scripts/prod/remote-deploy.sh`**: 本地 Mac 一键触发远端 deploy。默认读 `~/Downloads/QT.pem` (或 `~/.ssh/qt_deploy.pem`),目标主机配在 `.deploy-target` (gitignored),远端 `tmux` hold 会话跑 deploy.sh + 本地 `capture-pane` stream `[remote]` 前缀日志 + 退出码回传。`--dry-run` 只显示 ssh 配置。
- **新增 `scripts/prod/rollback.sh`**: 默认切到上一版; `--list` 看历史, `--to v0.13.6` 指定版本, `--skip-smoke` 紧急跳过。切完跑 `smoke_test`,失败自动回滚到切之前状态。
- **文档拆分**: 原 `docs/ops/deploy-ecs.md` (2077 行, 累计 v0.1.0~v0.13.7 所有部署记录 + 事故复盘) 移到 `docs/ops/deploy-history/v0.1.0-to-v0.13.7-deploy-records.md`;日常部署文档重写为 `docs/ops/deploy-current.md` (130 行)。`docs/README.md` 文档地图同步更新,`AGENTS.md` 加 Deploy Quick Reference 段。
- **`.gitignore`**: 新增 `.deploy-target` / `.deploy-target.*` / `*.pem.local` (模板是 `.deploy-target.example`,已 commit)。
- **`scripts/prod/deploy.sh` 内部清理**: 移除冗余 `echo`,历史教训注释从函数体移到 `_lib.sh` 顶部注释块(单一来源),236 → 239 行但**可读性提升**(原 50% 行是历史注释)。


### v0.13.7(2026-07-31) 合同编辑支持管理员变更签订人 + 依赖升级

- **合同编辑页新增「签订人」字段**: 管理员可搜索改为任意在职员工 (代录修正场景); 非 admin 只读展示, 提交时剥离该字段。服务端与负责人变更同口径: 非 admin 改为他人 422, 目标员工非 ACTIVE 400, 传现值无害放行; 变更纳入 `CONTRACT_UPDATE` 审计 diff (`server/services/contract/crud.ts`)。
- **校验 schema**: `contractUpdateSchema` 不再剔除 `signerId`; `customerId` 仍不可更换 (service 层显式丢弃)。
- **依赖升级**: next 16.2.7→16.2.12 / prisma 7.8.0→7.9.1 / eslint 9.18→9.39.5 / next-auth 4.24.14→4.24.15 / tsx 4.23.1 等; 新增 `overrides` 加固 (brace-expansion / nodemailer / postcss / sharp / exceljs→uuid); eslint 忽略 `docker-data/`。
- **测试**: `contract-update-validation` 改写原"signerId 剔除"用例, 新增 4 例 — admin 变更生效 / DISABLED 员工 400 / 非 admin 422 / 传现值放行 (全套 623 tests 通过)。

**版本号**: `0.13.6` → `0.13.7` (patch bump)

**部署说明**: 无 schema 变更、无新 migration,`deploy.sh` 常规流程。

### v0.13.6(2026-07-29) 统计分析 4 页视觉 + 布局改版

> 与 v0.13.5 dashboard 改版同一语言:KPI 图形化(icon + progress)、风险/核心信息前置、删重复内容。纯前端,数据获取与 API 不变。

- **overview**: 移除「客户区域分布」section(与 dashboard 完全重复);「合同/开票/回款趋势」提为唯一主图;`StatGrid columns={5}`(仅 4 项)修为 4;KPI 加 icon/progress;修 `prefix:"¥"` + `formatCurrency` 双 ¥ 折行。
- **by-region**: 删除常驻 `Alert`(默认本年度说明并入 subtitle);KPI 加 icon/progress;图表/明细表/Top N 不动。
- **aging**: `QueryFilter` 改默认折叠(原 6 字段常驻展开,移动端占满首屏);`AgingSummary` 同步去双 ¥。
- **performance**: 4 个同构柱状图(合同额/已开票/已回款/合同数)合并为单图 + `Segmented` 切换,员工固定配色(employeeColorMap)原样保留;窄屏卡片标题去指标名防换行;KPI 加 icon/progress;明细抽屉不动。

**版本号**: `0.13.5` → `0.13.6` (patch bump)

**部署说明**:无 schema 变更、无新 migration、无 API 变更,`deploy.sh` 常规流程。

### v0.13.5(2026-07-29) 工作台视觉 + 布局改版

> Dashboard 首屏信息层级重排:风险信号前置、图表不再独占整行、KPI 图形化。纯前端改动,数据全部来自现有 `/api/dashboard/summary` + `/api/statistics/aging/dunning/summary`。

- **头部**: 月/季/年 `Segmented` 移入 `PageHeader` actions;区间日期 + 本月/季/年 Tag 收成一行,权限提示收进 ⓘ Tooltip(原独立 HintBox 行删除)。
- **KPI 区**: 4 卡加图标(客户/合同/开票/回款),开票率与回款率加卡片底部细进度条;`StatGrid` 的 `StatItem` 新增可选 `icon` / `progress` 属性(其它使用方零影响)。
- **待办预警条(新)**: 待开票(PENDING_FINANCE)、90+ 账龄金额、催收中合计、法务介入,仅非零项渲染,色块左边框 + 点击跳 `/invoices` / `/statistics/aging`。
- **布局**: 镇街柱状图 24 栏 420px → 16 栏 320px(移动端 260px);合同状态由文字行改 `@ant-design/charts` Pie donut(8 栏,状态语义配色,总数入副标题);开票/回款概况 12/12 分栏,每个状态下加金额占比细条;Top 5 客户行内加合同额占比条形背景(以第一名为 100%)。
- **账龄**: 90+ 卡片金额 >0 时红框红底 + 左红边强化。

**版本号**: `0.13.4` → `0.13.5` (patch bump)

**部署说明**:无 schema 变更、无新 migration、无 API 变更,`deploy.sh` 常规流程。

### 部署提速: Dockerfile 换国内源(未发版,随下次构建生效)

> v0.13.7 部署实证: 依赖升级导致缓存全破时构建 25 分钟, 瓶颈全在 ECS 拉外网 — npm 官方源 8KB/s、apk dl-cdn ~250s、daocloud docker mirror ~150KB/s。本次只改 `Dockerfile`, 不改应用行为、不带版本号, 下次 `deploy.sh` 构建自动生效。

- **apk 换阿里云源** (deps/build/runner 三阶段): `dl-cdn.alpinelinux.org` → `mirrors.aliyun.com`, 服务器实测 16 包 5.6s (原 ~250s)。
- **npm 换 npmmirror CDN**: `npm ci --registry=https://registry.npmmirror.com --no-audit --no-fund`, 实测 99 包 6.4s (官方源 8KB/s); 整项目 `npm ci` 预计 387s → 1-2min。
- **BuildKit npm 缓存挂载** (`--mount=type=cache,target=/root/.npm`): lockfile 变化时只下载增量 tarball, npm 缓存不再随镜像层作废。
- **docker registry mirror**: 公共 mirror (1panel/rat.dev) 实测不可用; 已配阿里云个人加速器 `2yeh01gi.mirror.aliyuncs.com` 为首选 (daemon.json, reload 生效), daocloud 兜底; 实测 alpine 拉取 ~2.5x 提速。基础镜像仅 digest 变化时重拉, 影响偶发。

### 部署脚本改进(未发版,随下次部署生效)

> 以下为纯 `scripts/prod/deploy.sh` 运维改动,不改应用行为、不带版本号,随下一次 `deploy.sh` 的 `git pull` 生效(re-exec 护栏保证新脚本完整执行)。

- **构建零停机首选**(`227e2f9e`):内存兜底从"无条件停 qt-app"改为首选全部容器在线构建,仅当构建被 OOM Kill(exit=137)才停 qt-app(不够再停 PG/MinIO)重试一次。此前每次部署都有整个 build 时长(~4 min)的停机(v0.13.4 部署实证)。
- **自我改写护栏**(`3635c8ec`):脚本在任何动作前复制自身到 /tmp 并 re-exec 稳定副本,防止 `git pull` 中途更新 deploy.sh 自身导致 bash 按旧字节偏移续读、静默跳过步骤(v0.13.2 部署实证,release:publish 段曾被整段跳过)。

### v0.13.4(2026-07-29) 更新日志列表取消重要置顶

> `/releases` 列表排序从 `important desc, publishedAt desc` 改为纯 `publishedAt desc`,重要更新不再置顶;`important` 仅保留弹窗视觉权重与未读首条选择(`getLatestUnreadRelease` 排序不变)。回归测试改为「旧且重要 vs 新且普通」断言不置顶。

**版本号**: `0.13.3` → `0.13.4` (patch bump)

**部署说明**:无 schema 变更、无新 migration,`deploy.sh` 常规流程。

### v0.13.3(2026-07-29) 更新日志完全自动发布 + 应用全 Docker 化

> 两件事:(1) 更新日志取消手工"发布更新"功能,完全自动发布;(2) 应用从 native systemd 迁移到全 Docker 部署。

**更新日志:移除手工发布入口(feat,破坏性)**

- 删除 `/admin/releases` 管理页、「发布更新」菜单项、`POST /api/app-releases`(创建)、`PATCH/DELETE /api/app-releases/[id]`、`/api/app-releases/preview-from-git`。
- API 只保留只读:`GET` 列表/详情/`latest` + `POST [id]/read`;service 移除 `createRelease/updateRelease/softDeleteRelease`,写入唯一路径是 `scripts/release/publish.ts`(部署时一次性容器直写 Prisma)。
- 删除 `lib/validators/app-release.ts` 及其 schema 测试;i18n 清掉 admin 专用 `releases.*` key(保留用户时间线 `history.*` / `tag.important` / `release.popup.*`)。
- 想重新生成某版本更新日志:DB 软删旧记录后重跑 `release:publish`(幂等跳过逻辑不变)。

**部署:应用全 Docker 化(feat)**

- 根目录新增多阶段 `Dockerfile`(node:22-alpine:deps → build standalone → runner);runner 含全量 node_modules + scripts/lib/server 源码 + git,`migrate deploy` 与 `release:publish` 以一次性容器执行(`.git` 只读挂载)。
- `next.config.mjs` 加 `output: 'standalone'`;`lib/env.ts` 加 `SKIP_ENV_VALIDATION`(仅构建期跳过 fail-fast,运行时不变)。
- `docker-compose.prod.yml` 新增 `app` 服务(host 网络,`.env` 127.0.0.1 地址零改动);`deploy.sh` 改为:git pull → docker build → 容器内 migrate + release:publish → `compose up -d app`;镜像 tag 保留最近 3 版本,回滚秒级。
- `package-lock.json` 重新生成(原锁文件与 package.json 不同步);`npm ci --legacy-peer-deps` 对齐 pnpm 实际安装树。
- 灰度验证:服务器构建镜像 → 3001 并行烟测(含 cron run-all / release:publish 幂等)→ 切流 3000,native systemd qt-app 已 stop+disable(留作回滚)。

**版本号**: `0.13.2` → `0.13.3` (patch bump)

**部署说明**:无 schema 变更、无新 migration。本次部署首次走新 Docker 版 `deploy.sh` 全流程(自身即灰度验证后的正式路径)。

### v0.13.2(2026-07-29) 更新日志随部署自动发布

> 更新日志(AppRelease)此前全靠管理员在 `/admin/releases` 手敲发布;schema 里的 `source/gitFrom/gitTo/gitCommitCount` 字段和 `scripts/release/generate.ts` 是从未落地的遗留设计。本次重新设计为随部署自动发布:版本 bump → push → 服务器 `deploy.sh` 时自动生成并发布更新日志,用户登录即弹窗,零人工操作。

**自动发布链路(feat)**

- 新增 `scripts/release/publish.ts`:读 `package.json` 版本 → `git log <上一 release tag>..HEAD` → 过滤 `chore(release)`/`docs(release)` 发版噪音 commit → `lib/git-format.ts` 生成 title/summary/content → 幂等写 AppRelease(`source=GIT_COMMITS`,git 元数据补齐;任一 commit 带 breaking `!` 标记自动标重要)+ audit。发布人默认工号 `admin`,env `RELEASE_PUBLISHER_EMPLOYEE_NO` 可覆盖,回落第一个 ACTIVE ADMIN。
- `scripts/prod/deploy.sh` 在 build 成功后、restart 前自动执行 `npm run release:publish`;失败只 `[WARN]` 不阻断部署,可手动补跑。同版本已存在(含人工发布)则幂等跳过;想重新生成先在 `/admin/releases` 删除旧记录。
- 新增 `lib/release-plan.ts` 纯函数(噪音过滤 / important 判定 / tag 区间选择)+ `lib/git.ts#listReleaseTags()`;9 条新单测。

**管理页(feat)**

- `/admin/releases` 列表新增「来源」列:蓝色 Tag「自动生成」(tooltip 显示基于 N 条提交)/「手动」,i18n 中英镜像。手工发布 / 编辑 / 删除入口保留作兜底。

**版本号**: `0.13.1` → `0.13.2` (patch bump)

**部署说明**:无 schema 变更、无新 migration,`deploy.sh` 常规流程即可;部署后 v0.13.2 的更新日志由新链路自动发布(首个自动发布的版本)。

### v0.13.1(2026-07-29) 编辑开票页合同编号显示修复

> 编辑开票页「合同编号」显示的是 contractId(cuid)而非合同编号:`getInvoice` 只返回 Invoice 标量,而 Invoice 表无 `contractNo` 字段,前端 `contractNo ?? contractId` 兜底落空。查询 include 合同 `contractNo` 并平铺返回。无 schema 变更,无 API 契约变更(响应仅新增字段)。

**版本号**: `0.13.0` → `0.13.1` (patch bump)

**部署说明**:无 schema 变更、无新 migration,`deploy.sh` 常规流程即可。

### v0.13.0(2026-07-29) 员工档案每步独立保存 + 前端修复 + 开票税号放宽

> 员工档案向导支持每步独立保存(部分提交 + 乐观锁);修复一批档案前端真实 bug;确认开票移除"公司抬头必填税号"拦截;e2e 套件对齐登录页改版。无 schema 变更,无 API 契约变更(请求语义向后兼容)。

**员工档案:每步独立保存(feat)**

- 向导每步新增「保存本步」按钮:只校验并提交当前步切片(profile 字段按步切分,子表数组按步整体替换),保存后停留本页;最后一步「提交」仍是全量保存并返回详情页。
- 每次保存成功用响应里的最新 `updatedAt` 刷新乐观锁基线,连续分步保存不误报 409;409 覆盖确认弹窗在分步保存场景不跳转。
- 后端 `updateUserFullProfile` 乐观锁覆盖子表单保存:payload 只含子表(profile 字段为空)且带 `expectedUpdatedAt` 时,用条件 `updateMany` 显式 touch `updatedAt`,并发覆盖仍返回 409。
- 紧急联系人电话后端放行座机(`0xx-xxxxxxxx`),与前端校验对齐。

**员工档案:前端 bug 修复(fix)**

- 省市区级联受控失效:`Cascader` value 只由 initial 推导导致选择被回退;改内部 state + 按最深一级找回显路径,向导内用 `Form.useWatch` 取值,直辖市两级树回显正确。
- 详情页「重置密码」按钮从空实现接通完整 Modal(复用列表页 `POST /api/users/:id/reset-password`);HeroHeader 显示已上传头像;禁用/启用改 `message` + SWR `mutate`(去掉整页 reload)。
- 编辑向导头像回显:已有头像映射为 upload 列表项,删除列表项即清空头像(`avatarAttachmentId: null`)。
- `normalizeValues` 统一剔除 profile 的 null 值(服务端 null 初值 / 直辖市 `district: null` 会被 zod 拒绝,原路径保存必 400)。
- 新增身份证 / 紧急联系人电话 / 银行卡号格式校验;子表删除加 Popconfirm;向导头部移动端单列。

**开票(fix)**

- 确认开票(`→ ISSUED`)移除"公司抬头必须填写税号"的 422 拦截;R-09 现仅保留"电子发票号必须 20 位数字"。税号在新建/编辑表单本为选填,红冲 / PDF / 导出均按可空展示。

**e2e 套件修复(test)**

- 登录页改版后 16 个 spec 共 57 处过时选择器全部替换(placeholder `工号`/`密码` exact;按钮 accessible name 为带空格的「登 录」)。
- 修复 WebKit 水合竞态(`goto("/login")` 后补 `networkidle` 等待)、14 号 spec beforeAll 的 storageState ENOENT、3 处过时业务断言(「薪资」→「月薪(税前)」、「P5」exact、01.1 品牌断言改「欢迎登录」)。
- spec 12 新增「保存本步」断言(Step 1 / Step 4 分步保存 + 全量提交不弹 409)。

**测试**: Vitest 622/622(新增 7 用例:validator 6 + 乐观锁子表分支 1);e2e 01.1 / 12 / 14 三项目(chromium / iPad / iPhone)全绿;typecheck / ESLint 0 error。

**版本号**: `0.12.0` → `0.13.0` (minor bump, 每步独立保存新功能)

**部署说明**:无 schema 变更、无新 migration,`deploy.sh` 常规流程即可。

### v0.12.0(2026-07-28) 前端移动端适配强化

> 基于最新 UI 审查,对管理后台多个页面进行移动端/窄屏适配,覆盖详情、列表、弹窗、抽屉、搜索区、权限矩阵等场景,提升小屏设备可用性。无 schema 变更,无 API 契约变更。

**响应式详情与列表**

- `ProDescriptions` 响应式列数:角色详情、部门详情等详情页根据断点动态调整列数,避免窄屏下字段挤压重叠。
- 多张 `ProTable` 补齐 `scroll.x` / `sticky` / 小屏分页:证书、部门成员、发布、公告、消息等列表在窄屏下可横向滚动、表头吸顶、分页器适配。
- 操作日志快速区间、字典搜索框、新建角色模板选择器等搜索/筛选区在窄屏下自动换行或收缩,避免布局溢出。

**响应式弹窗与抽屉**

- `Modal` / `Drawer` 宽度改为响应式:公告、发布、字典、新建用户等弹窗/抽屉根据视口宽度动态调整,小屏下占满或接近占满宽度。

**权限矩阵与工作台**

- 权限矩阵窄屏下缩小列宽并隐藏资源 code,保留权限开关可读性。
- 工作台极窄屏隐藏权限提示,避免顶部提示条占用过多垂直空间。

**版本号**: `0.11.0` → `0.12.0` (minor bump, 前端移动端适配)

**部署说明**:无 schema 变更、无新 migration,直接重启 `next start` 即可生效。

### v0.11.0(2026-07-24) 合同 / 开票 / 回款 全模块逻辑审查修复(24 项)

> 对三个核心模块做了一轮完整代码逻辑审查并修复全部确认问题:P0 功能失效 4 项、P1 数据一致性 / 业务漏洞 12 项、P2/P3 不一致与健壮性问题若干。新增 24 个回归测试,全量 615 用例全绿。

**P0 功能失效**:
- 回款登记页「取消」按钮无效(`onCancel={() => goBack}` 未调用)
- 回款导出 Excel「关联发票号」列恒为空(listPayments select 缺 invoice 关系)
- SALES/EXPERT 无法取消自己登记的 PLANNED 回款(权限自相矛盾):cancel 改走 CREATE 权限 + 创建人校验
- 发票详情页「提交」按钮只有财务可见(服务端本就不限):销售可提交自己的草稿

**P1 数据一致性 / 业务漏洞**:
- `Invoice.dueDate` 补齐写入链路(validator → service → 新建/编辑表单「到期日」选填),账龄 basis=due 不再恒空
- 红冲票(负数票)禁止再作废 / 再红冲,净额自洽
- `updateInvoice` 状态门控 TOCTOU:非 admin 的 update 带 `status: "DRAFT"` 条件
- R-08 累计开票复检全部加合同行 `FOR UPDATE` 锁(create/update/submit/issue),并发不再超额;顺带消除 dummy update 污染合同 `updatedAt`
- 票号唯一性:P2002 → 422 友好报错,预校验与 DB unique 同口径(含软删行)
- 回款 confirm 可更正到账日 / 收款方式(修复预建回款 receivedAt=开票时间的账龄失真)
- 发票作废/红冲取消 PLANNED 回款补审计日志;admin 改 ISSUED 票金额自动同步预建回款
- issue 补 R-09 公司抬头税号强校验;驳回 / 开票站内信通知申请人(`INVOICE_ISSUED` / `INVOICE_REJECTED`)
- 合同创建/编辑补 `CONTRACT_CREATE` / `CONTRACT_UPDATE` 审计(操作记录 tab 不再空白)
- 新增「合同过期 + 回款足额但开票不足额」每日提醒 `CONTRACT_PAID_INVOICE_PENDING`(原三条路径的盲区)
- updateContract 税额重算改用事务内 locked 行;补 serviceType 字典校验;非 admin 显式指定他人负责人 → 422
- `nextBusinessNo` 支持传入外层 tx,修复回滚跳号

**P2/P3**:作废文案与 24h 窗口对齐、三个列表补 id 排序 tiebreaker、stale 阈值统一 Decimal+容差、逾期提醒浮点改 Decimal、金额入参 2 位小数+上限、到账日不得为未来、refund 清对账字段、publish-eligibility 补 READ 权限、死代码/拼写/过期注释清理。

**版本号**: `0.10.6` → `0.11.0` (minor bump, 含新功能:到期日字段、新消息类型、新提醒分支)

**部署说明**:
- 含 2 个新 migration(MessageType 枚举加 `INVOICE_ISSUED` / `INVOICE_REJECTED` / `CONTRACT_PAID_INVOICE_PENDING`),部署时执行 `npm run prisma:deploy`
- 行为变更注意:非 admin 不能再显式指定他人为合同负责人(前端表单已同步收窄);手工 PLANNED 回款计入登记预检(开票自动预建的不计入)

### v0.10.6(2026-07-23) 客户列表「来源」列替换为「联系人」列

> 客户管理列表表格不再展示「来源」(sourceChannel 字典),改为展示主联系人(`contactName · contactTitle`),与导出 Excel、详情 PDF 的口径保持一致;无联系人数据显示 `—`。纯前端列调整,无 schema 变更、无 API 契约变更(列表 API 本就返回全字段)。详情页「来源渠道」与新建/编辑表单「客户来源」保留不变。

- `app/(app)/customers/page.tsx`: 删除来源列 + `CUSTOMER_SOURCE` 字典渲染;新增联系人列(宽 140,`ellipsis`);`Customer` 类型去掉 `sourceChannel`,补 `contactName` / `contactTitle`
- 验证: `npm run typecheck` 通过;ESLint 零告警

**版本号**: `0.10.5` → `0.10.6` (patch bump, 纯 UI 列调整, 无 schema 变更, 无 API 契约变更)

**部署说明**: 直接重启 `next start` 即可生效

### v0.10.5(2026-07-19) 金额+税率表单统一 + 开票页合同联动

> 合同/开票四个表单的"金额+税率"字段收敛为共享组件(带税额实时预览);新建开票页选合同后自动继承合同税率并显示剩余可开票额度,金额超限前端即时提示。无 schema 变更;合同列表 API 返回新增 `occupiedAmount` 字段(纯新增, 向后兼容)。

**共享表单组件** (新增 `components/form/amount-tax-fields.tsx` + `lib/tax.ts`):
- `AmountTaxFields`: 统一合同新建/编辑、开票新建/编辑四处手写的 ProFormDigit+ProFormSelect;`ProFormDependency` 实时预览"税额 ≈ ¥x · 不含税金额 ≈ ¥y"(标注以服务端计算为准)
- `lib/tax.ts` 零依赖纯计算(`calcTaxBreakdownPreview`),公式与 `lib/money.ts#calcTaxBreakdown` 严格一致, parity 测试兜底;`lib/money.ts` 依赖 `@prisma/client` 不可进客户端 bundle, 服务端仍走 Prisma.Decimal 权威计算
- 编辑页不传字段级 `initialValue`, 由 form 级 `initialValues` 回显, 避免默认值冲突

**开票页合同联动** (`app/(app)/invoices/new/page.tsx` + `server/services/contract/crud.ts`):
- 选合同自动 `setFieldsValue({ taxRate })` 继承合同税率(此前固定默认 6%, 与合同税率不一致时需人工对账)
- 合同下方常驻"剩余可开票额度 ≈ 合同总额 − 已占用(含草稿/待审)";`listContracts` 新增 `occupiedAmount`(R-08 额度占用口径 `INVOICE_LIMIT_COUNTED_STATUSES`),与展示口径 `invoicedAmount`(ISSUED+RED_FLUSHED)注释区分, 前端提示与服务端 R-08 校验同口径
- 金额超剩余额度时 antd `warningOnly` 校验即时黄条提示(不阻断提交, 服务端 R-08 仍是权威拦截)

**测试**:
- 新增 `tests/unit/lib/tax.test.ts`: 预览函数用例 + 与 `calcTaxBreakdown` 的 (金额 × 税率) parity 矩阵 + 容差哨兵
- 新增 `tests/api/contract-list-occupied-amount.test.ts`: DRAFT/ISSUED 计入 occupiedAmount、VOIDED 不计、invoicedAmount 仅 ISSUED
- 全量 Vitest 回归: 579 通过 / 10 跳过 (2 个文件因本机 dev DB `User` 表夹具问题失败, 已用 stash 在干净树复现确认为既有问题, 与本次改动无关); `npm run typecheck` 通过; ESLint 零告警
- UI 端到端实测: 选合同税率继承回弹(13% → 合同 6%)、剩余额度提示、超限 warning、编辑页回显均正确

**版本号**: `0.10.4` → `0.10.5` (patch bump, 表单统一 + 开票 UX 增强, 无 schema 变更, API 纯新增字段向后兼容)

**部署说明**:
- 无 schema 变更、无新 migration, `prisma migrate deploy` 无增量(deploy.sh 会执行但为空跑)
- 直接重启 `next start` 即可生效

### v0.10.4(2026-07-18) 合同列表客户区域筛选 + 区域逻辑共享化

> 合同管理页新增"按客户区域查询"、列表"客户区域"列与导出区域列;并把合同/客户两端重复的区域逻辑(级联拉取、路径拆分、展示拼接、Prisma where)收敛到共享模块。无 schema 变更, 无 API 契约变更 (列表/导出 query 新增 4 个可选参数, 向后兼容)。

**合同列表区域筛选** (`app/(app)/contracts/page.tsx` + `server/services/contract/crud.ts` + `lib/validators/contract.ts`):
- 搜索区新增"客户区域"级联 (省/市/区/镇街, `changeOnSelect` 可停在任一级);虚拟字段 `region` 在 request 回调拆成 `province/city/district/town` 4 个标量传给后端,走 `customer` 关系过滤
- 列表新增"客户区域"展示列 (4 级拼接);导出 XLSX 同步带"客户区域"列并跟随当前筛选
- `listContracts` 返回行拍平为 `customerProvince/City/District/Town` (include 一次 join, 无 N+1)

**区域逻辑共享化** (新增 `lib/region.ts` + `lib/use-region-options.ts`):
- `buildRegionWhere()`: 合同/客户两个 service 统一为 equals + insensitive (此前合同侧裸 equals、客户侧 insensitive, 两页口径不一)
- `formatRegion()`: 统一 5 处区域拼接 (合同页列、合同导出、客户页列、客户导出、客户 PDF)
- `splitRegionPath()` + `useRegionOptions()`: 消除两页逐字复制的级联 fetcher/路径拆分
- 级联 options 末尾追加"未知"节点: legacy-fineui 导入客户 `province="未知"` 不在行政区划树内, 此前永远无法被区域筛选命中, 现在可筛出并人工清理
- 地区数据拉取失败时两页显式 `message.warning` 提示 (此前 SWR 静默吞错, 级联无声变空面板)

**导出健壮性** (`app/api/contracts/export/route.ts`):
- 删除本地私有 zod schema, 复用 `contractListQuerySchema.omit({ page, pageSize })` — 防止两处 schema 漂移后导出静默丢筛选条件; omit 是因为列表 schema 的分页默认值 (1/20) 会覆盖 `exportMaxRows` 兜底
- `listContracts` 新增 `countTotal` 可选参数, 导出传 `false` 跳过用不到的 `contract.count`

**测试**:
- 新增 `tests/api/contract-list-region.test.ts`: 7 个用例覆盖单条件/组合/纯区域过滤与拍平字段返回
- `tests/customer-location.test.ts`: 3 处源码断言从锁旧内联拼接改为锁 `formatRegion` 调用, 守卫意图不变
- 全量 Vitest 回归: 571 通过 / 10 跳过 (2 个文件因本机 dev DB `User` 表夹具问题失败, 已用 stash 在干净树复现确认为既有问题, 与本次改动无关); `npm run typecheck` 通过; ESLint 零告警

**版本号**: `0.10.3` → `0.10.4` (patch bump, 新筛选维度 + 重构, 无 schema 变更, 无 API 契约变更)

**部署说明**:
- 无 schema 变更、无新 migration, `prisma migrate deploy` 不需要跑
- 直接重启 `next start` 即可生效

### v0.10.3(2026-07-18) 发布更新流程简化

> 把"手写发布"和"git 自动生成"两个 Modal 合并为单一表单 + 表单顶部"从 git 自动填充"按钮,history 页去掉 Timeline 装饰。无 schema 变更, 无 API 契约变更。

**管理员发布页合并** (`app/(app)/admin/releases/page.tsx`):
- 删除第二个 Modal (`releases.gitModal.*`);"从 git 自动生成"改为表单顶部一颗副按钮,点击拉 `/api/app-releases/preview-from-git` 草稿,只覆盖空字段,管理员审阅后直接保存
- release 列表删掉 commit 数 / `fromGit` badge;git 来源元数据不再透出到 UI

**更新日志页收紧** (`app/(app)/releases/page.tsx`):
- 从 antd Timeline 改为扁平卡片列表;除"版本号 + 重要红点"外的节点装饰全部移除;未读提示沿用顶部一条 banner

**Validator 收紧** (`lib/validators/app-release.ts`):
- 删除 M-1 自动加 `v` 前缀的 transform;显式要求 `v` 开头 + 含数字, 长度 1-50;一并消除 `V0.7.0 → vV0.7.0` 这种边角 case

**Preview / Service / git-format** (`app/api/app-releases/preview-from-git/route.ts` + `server/services/app-release.ts` + `lib/git-format.ts`):
- preview 响应只回 `{ version, title, summary, content, commitCount }`;`commits` / `from` / `to` / `truncated` 不再外露
- `createRelease` 入参去掉 `source` / `gitFrom` / `gitTo` / `gitCommitCount` (DB 列保留以兼容存量, 新建行一律 MANUAL / null)
- `formatReleaseContent` 不再做事先的 `v` 归一化,由 validator 把关

**清理**:
- 删除未在 `package.json` 注册的 `scripts/release/generate.ts` CLI 脚本 (admin 按钮行为已覆盖)
- `lib/i18n.ts` 删 14 个 `releases.gitModal.*` / `releases.fromGit` / `releases.tag.fromGit` 键;新增 `releases.autoFill` / `releases.autoFillHint` / `releases.toast.autoFilled`

**新增/更新测试**:
- `tests/lib/app-release-schema.test.ts`: 反映新版本号规则 (`v` 开头 + 含数字),以及 "已带 v 透传" / "缺 v 被拒"
- `tests/lib/git-format.test.ts`: 用例 "version 自动补 v 前缀" 改写为 "version 透传原样"
- `tests/api/app-release.test.ts`: 移除 git source 相关用例,加 "不传 important 默认 false"
- 全量 Vitest 回归: 72 文件 / 572 用例全绿; `npm run typecheck` 通过

**版本号**: `0.10.2` → `0.10.3` (patch bump, UX 重构 + 接口精简, 无 schema 变更, 无 API 契约变更)

**部署说明**:
- 无 schema 变更、无新 migration, `prisma migrate deploy` 不需要跑
- 直接重启 `next start` 即可生效
- **行为变化提醒**: i18n 删 14 个键,前端已无残留引用 (admin 的 git Modal 已删除);preview 端点响应字段缩减,只有内部 UI 在用,无第三方消费者

### v0.10.2(2026-07-17) 业务不变量与行级隔离修复

> 针对一次六路并行代码审查发现的 2 项 Critical + 5 项 High 缺陷进行修复, 无 schema 变更, 无 API 契约变更。

**累计开票上限 R-08 双重缺陷** (`lib/invoice-amounts.ts` 新增 + `server/services/invoice/{crud,action}.ts` + `server/services/contract/crud.ts`):
- R-08 口径此前漏掉 `PENDING_FINANCE`, 发票提交(DRAFT→PENDING_FINANCE)即在额度校验中"隐身", 顺序操作即可无限超额开票。新建统一常量 `INVOICE_LIMIT_COUNTED_STATUSES`(含 PENDING_FINANCE)收敛三处硬编码(create/update/调低合同总额守卫), 一张票生命周期内恰好计一次
- `submit`/`issue` 流转挂 `precondition` 复检 R-08(对齐 DESIGN-v3.md:393), 堵住"提交后隐身"与"并发绕过"两条超额路径
- `createInvoice` 由"先 findFirst 快照读 → SUM → INSERT"改为事务内 dummy UPDATE 锁合同行(模式同 `updateContract`), 消除并发 TOCTOU 超额竞态

**EXPERT 行级隔离缺失** (`lib/ownership.ts` + `server/services/dunning.ts` + `server/services/statistics.ts`):
- `ownerEq`/`ownerViaContract` 此前只判 `SALES`, EXPERT 零过滤可读/改/导出全公司客户/合同/发票/回款。抽 `isRowRestricted`(SALES+EXPERT)统一判断, 与 DESIGN-v3.md:183 / init RLS 策略对齐
- `dunning.ts` 的 `whereForUser` 同步纳入 EXPERT, 并修正"EXPERT 看到全部"的漂移注释
- `statistics.ts` 三处 `isSales` 特判(员工业绩 short-circuit + 两处 owner/signer 并集查询)统一改 `isRowRestricted`, 避免 EXPERT 丢失 signerId 维度

**账龄统计越权 (IDOR)** (`server/services/statistics.ts`):
- `getInvoiceAging` 的 `ownerUserId` 入参此前用对象展开覆盖隔离注入, 受限角色传他人 id 即可查看/导出他人账龄明细。现对受限角色强制等于自己

**红冲后"已开票"口径错乱** (`lib/invoice-amounts.ts` + contract/status·crud·overview + statistics):
- 红冲对 = 原票 `RED_FLUSHED(+A)` + 负票 `ISSUED(−A)`, 净贡献应为 0, 但所有 `status:"ISSUED"` 金额聚合把它算成 `−A` → 红冲+重开+全额回款后合同永远卡 ACTIVE 且无通知, 统计金额每笔红冲少计 2A。新建 `INVOICE_ISSUED_AMOUNT_STATUSES`(ISSUED+RED_FLUSHED)统一"已开票有效金额"口径: tryAutoClose / 合同列表 / 概览 / statistics 六处金额聚合; 账龄/应收口径(四处 `status:"ISSUED"`)语义不同, 明确保留

**附件安全两处** (`app/api/files/raw/[id]/route.ts` + `server/storage/presign.ts`):
- raw 下载代理此前不查 `deletedAt`, 已软删附件凭 id 仍可下载。补 `att.deletedAt` → 404, 与 presign-download 一致
- presign-upload 对 `contractId/invoiceId/employeeProfileId` 此前零归属校验, 任意登录用户可向他人合同/发票/档案注入附件。新增 `assertCanAttachToTarget` 按绑定目标逐一校验(ADMIN / 合同 owner·signer / FINANCE / 档案本人)

**with-profile 绕过"最后 ADMIN"护栏** (`server/services/employee-profile.ts` + `server/services/user.ts`):
- `updateUserFullProfile` 此前直接 `tx.user.update(input.user)`, 未走 `assertNotSelfAndNotLastAdmin`, 一条请求即可禁用/降级最后一位 ACTIVE ADMIN 致系统无可用管理员。现复用该护栏(导出共享)对齐 `updateUser` 语义, roleId/status 变更后调 `invalidateAuthCache`

**新增/更新测试**:
- 新增 `tests/api/ownership-isolation.test.ts`(6 用例): ownership 助手语义 + 真实 `getInvoiceAging` 越权被堵
- 扩充 `tests/api/invoice-amount.test.ts`(2 用例): 提交后隐身超额被拦、改额 P1-1 复检拦截
- 更新 `tests/unit/server/contract-update-amount-guard.test.ts`: 状态断言改引用 `INVOICE_LIMIT_COUNTED_STATUSES` 常量, 防口径再漂移
- 全量 Vitest 回归: 71 文件 / 572 用例全绿; `npm run typecheck` 通过

**版本号**: `0.10.1` → `0.10.2`(patch bump, 缺陷修复, 无 schema 变更, 无 breaking)

**部署说明**:
- 无 schema 变更、无新 migration, `prisma migrate deploy` 不需要跑
- 直接重启 `next start` 即可生效
- **行为变化提醒**: EXPERT 角色从"可见全公司数据"变为"仅见自己名下数据"(行级隔离生效), 若有 EXPERT 账号依赖全量视图需提前知会

### v0.10.1(2026-07-13) 安全与并发修复

> 针对 v0.10.0 上线后安全审计发现的 5 处中高风险点进行修复, 无 schema 变更, 无 API 契约变更。

**密码重置链路加固** (`lib/password-reset.ts` + `app/api/auth/password-reset/*`):
- request 接口不再把原始 reset token / 完整 reset URL 写入 `OperationLog.diff`, 仅记录 `expiresAt` 与 `issuedByIp`
- confirm 接口把 "消费 token" 与 "写新密码" 包进同一 Prisma 事务; token 消费使用 `updateMany` 条件抢锁, 避免并发下同一 token 被重复消费导致账号可被多次改密

**文件下载代理加固** (`app/api/files/raw/[id]/route.ts`):
- 路由入口接入 `runWithRequestContext`, 为审计提供 IP/UA/requestId/method/path
- 每次成功下载写入 `OperationLog` (`entity=Attachment`, `action=ATTACHMENT_DOWNLOAD`), `diff` 仅含文件名/mime/大小, 不含 MinIO bucket/objectKey
- 响应头增加 `X-Content-Type-Options: nosniff` 与 `X-Frame-Options: DENY`

**回款确认并发竞争** (`server/services/payment.ts`):
- confirm 前置条件中对 `Contract` / `Invoice` 行加 `FOR UPDATE` 锁, 序列化同一合同/发票下的并发确认
- 对 `bankRefNo` 使用 `pg_advisory_xact_lock(hashtext(...))` 事务级分布式锁, 防止同一流水号被并发确认导致重复

**合同总额调小并发竞争** (`server/services/contract/crud.ts`):
- `updateContract` 事务内先 `UPDATE Contract SET updatedAt=now() WHERE id AND deletedAt IS NULL` 锁行, 并重新读取 `status`/`totalAmount`
- 校验基于锁行后的最新 `totalAmount`, 避免事务外快照被并发覆盖导致超额调小
- 最终 update 的 `where` 增加 `deletedAt: null`, 防止并发软删后仍更新幽灵行

**Zod 校验错误脱敏** (`lib/api.ts`):
- `err()` 对 ZodError 的 `details` 仅返回 `{ path, message }[]`, 不再把完整 `ZodError` 对象(含原始输入值)暴露给前端

**新增/更新测试**:
- 更新 `tests/unit/server/contract-update-amount-guard.test.ts` mock, 适配事务内锁行读取 `totalAmount` 的新逻辑
- 全量 Vitest 回归: 70 文件 / 564 用例全绿

**版本号**: `0.10.0` → `0.10.1`(patch bump, 安全修复, 无 schema 变更, 无 breaking)

**部署说明**:
- 无 schema 变更、无新 migration, `prisma migrate deploy` 不需要跑
- 直接重启 `next start` 即可生效; 反代 / CDN 缓存层建议 purge 一次以刷新新增响应头
- 无 frontend breaking, 已登录用户下次刷新即生效

### v0.10.0(2026-07-11) 登录安全加固 + 自服务密码重置

> v0.9.x 阶段登录链路只有 bcrypt 校验, 无失败计数 / 限速 / 审计 / 密码自服务重置.
> 本次按 [docs/history/security/login-security-review-2026-07-11.md](docs/history/security/login-security-review-2026-07-11.md) 触发的修复集, 一次性把 P1/P2 全部上线.
> Schema 改动: User 表新增 5 字段 + 新表 PasswordResetToken (migration `20260711_login_security_hardening`).

**Schema 变更** (`prisma/migrations/20260711_login_security_hardening/migration.sql`):
- `User.mustChangePassword Boolean @default(false)` — legacy 迁移 / admin 重置后强制改密
- `User.failedLoginCount Int @default(0)` — 连续失败计数, 登录成功清零
- `User.lockedUntil DateTime?` — 临时锁定到期时间 (DB 索引), 过期自动失效
- `User.lastFailedLoginAt DateTime?` — 衰减窗口判断用
- `User.roleVersion Int @default(0)` — 角色/权限变更时 +1, JWT 携带, 缓存命中检查
- 新表 `PasswordResetToken` (tokenHash 唯一索引, 30min TTL, 一次性消费, 申请人/消费人 IP+UA 全留痕)

**限速双层防护**:
- **IP 维度** (in-memory, `lib/login-rate-limit.ts` + `app/api/auth/[...nextauth]/route.ts` 包裹层): 5min 窗口内 20 次失败 → 429
- **用户维度** (DB 持久化, 跨实例可见): 5 次失败锁 15min, 第 6 次起锁 60min, 距上次失败 30min+ 视为新一轮

**登录审计** (`lib/login-audit.ts`):
- 8 类事件写 `OperationLog` (entity="Auth"): LOGIN_SUCCESS / LOGIN_FAIL / LOGIN_LOCKED / LOGIN_RATE_LIMITED / PASSWORD_RESET_REQUESTED / PASSWORD_RESET_CONSUMED / PASSWORD_RESET_INVALID / PASSWORD_CHANGED
- `diff` 字段记 employeeNo + reason (e.g. `failed_count=3`, `locked_until=2026-07-11T...`), 不写明文密码 / token
- `/api/operation-logs` 直接展示审计时间线, 无需新 schema

**自服务密码重置** (`lib/password-reset.ts` + 2 个 API):
- `POST /api/auth/password-reset/request` — 校验 (employeeNo, email) 匹配, 签发 token, **统一返回 200** 防枚举; reset URL 写到 `OperationLog` (action=PASSWORD_RESET_LINK), 管理员通过 `/api/operation-logs` 查链接后内部送达
- `POST /api/auth/password-reset/confirm` — 校验 token + 写新密码 + 清锁定; 区分 NOT_FOUND/EXPIRED/ALREADY_USED, 对外统一 "链接无效或已过期"
- 5min/5 次 IP 限速防 token 洪水

**登录页改动** (`app/login/page.tsx`):
- 「忘记密码?」由 mailto 改为 Modal 申请表单 (employeeNo + email)
- 新增 `?resetToken=xxx` 改密页 (覆盖原有登录表单), 改密成功后 `router.replace("/login")`
- 登录成功后 `mustChangePassword=true` 跳 `?resetRequired=1` 强制改密
- `callbackUrl` 解析从黑名单 (`//`, `/\\`, `/%5C`, `/%2f`) 升级到 URL 解析白名单, 禁 `javascript:` / `data:` / `vbscript:` / userinfo / `///evil.com` / 反斜杠绕过 / 跨 origin
- `router.push(callbackUrl) + router.refresh()` 改为 `router.replace + await refresh`, 修竞态
- 工号 `trim().toLowerCase()` 归一化, 消除 `@unique` 大小写敏感引起的双账号隐患

**其他安全点**:
- `lib/auth.ts` 缓存 TTL 30s → 2s, JWT 显式写 `token.exp`, 杜绝 "老 token 跨升级保留旧 exp" 窗口
- `lib/auth.ts#normalizeEmployeeNo` 导出, 登录 / authorize / scripts 共用
- `next.config.mjs` 加 CSP / X-Frame-Options DENY / nosniff / Referrer-Policy / Permissions-Policy 全站响应头
- `lib/auth.ts#lastLoginAt` 失败包 try/catch, 不阻塞登录主流程
- `lib/auth.ts#secret` 走 `env.NEXTAUTH_SECRET` (启动期 fail-fast), 不直接读 `process.env`
- `prisma/seed.ts` + `scripts/shared/seed-roles.ts` 的 system 占位 user 改用 `bcrypt(randomBytes(32))`, 杜绝固定 `$2b$10$ZZZ...` 占位串在不同 bcrypt 实现下的不稳定行为
- `scripts/shared/seed-test-users.ts` 加 `NODE_ENV=production` 守门, 防止误在生产覆盖 5 个内置账号密码
- `scripts/migrate/legacy-fineui.mjs` 不再批量设 `123456`, 每个用户随机 22 字符密码 + `mustChangePassword=true`, 落地后由管理员通过 reset 流程送达

**新增测试**:
- `tests/login-security.test.ts` — 14 个测试 (IP 限速 + 工号归一化 + token hash 抗碰撞 + buildResetUrl)
- `tests/safe-callback-url.test.ts` — 9 个测试 (开放重定向各种绕过)

**版本号**: `0.9.7` → `0.10.0` (minor bump, 含 schema 变更 + 新表 + API 端点, 涉及契约)

**部署说明**:
- **必须**跑 `npx prisma migrate deploy` 应用 `20260711_login_security_hardening` (新增 1 表 + 5 列)
- 现有用户新字段都是 NOT NULL + DEFAULT, 老数据零迁移成本 (PG 把 NULL/缺省按 DEFAULT 填充)
- 现有 `id="system"` 占位用户的 `passwordHash` migration 不会重写 (仅 DDL); 若想让它也用随机 hash, 部署后手动跑 `pnpm seed-roles` 覆盖即可
- `next.config.mjs` 加了响应头, 反代 / CDN 缓存层需要 purge 一次, 避免老资源仍走旧头
- 无 frontend breaking, 已登录用户下次刷新即生效 (新 schema 字段实时读)

### v0.9.7(2026-07-08) 日期与日期时间显示/导出统一为 YYYY-MM-DD 风格

> 此前 `lib/format.ts` 的 `formatDate`/`formatDateTime` 依赖 `zh-CN` locale,输出 `2026/06/09` 与 `2026/06/09 17:30`;
> 同时全库散落 18 处裸 `new Date(x).toLocaleDateString('zh-CN')` / `toLocaleString('zh-CN')`,与中央函数行为分裂。
> 本次把中央函数切到本地时区的 `YYYY-MM-DD` / `YYYY-MM-DD HH:mm`,所有调用点统一走中央 helper。

**中央函数改造** (`lib/format.ts`):
- 新增 `formatYmd(d)` / `formatHm(d)` 两个内部工具,纯本地时区拼接,无 locale 依赖
- `formatDate` → `YYYY-MM-DD`,`formatDateTime` → `YYYY-MM-DD HH:mm`,空值仍返回 `-`

**18 处调用点统一**:
- 显示/页面 (8): `components/release-popup`、`components/admin/operation-log-drawer`、`components/dashboard-shell`、`app/(app)/admin/{operation-logs,trash,users}/page.tsx`、`app/(app)/admin/users/page.tsx` (CSV 导出)、`app/(app)/announcements/page.tsx`、`app/(app)/payments/[id]/page.tsx`
- 导出/CSV (5): `app/api/{contracts,customers,invoices,payments}/export/route.ts` + 上述 users 导出 — 空值回退保留为 `""`
- PDF 路由 (4): `app/api/{contracts,customers,invoices,payments}/[id]/pdf/route.ts` + `lib/print-html.ts` — 空值回退保留为 `"—"`
- 统计 PDF (1): `app/api/statistics/employee-performance/pdf/route.ts` — 空值回退保留为 `"-"`

**保留不动**:
- `server/events/bus.ts` 本地 `formatDate` 本就 `toISOString().slice(0,10)`,已是 `YYYY-MM-DD`
- `scripts/migrate/{contract-fake-close-recovery,contract-fake-close-recurrent-lock}.ts` 本地 `formatDate` 用于 SQL 表名 `YYYYMMDD`,非用户可见

**版本号**: `0.9.6` → `0.9.7`(patch bump,纯 UI 文案统一,无 schema 变更,无 API 契约变更,无 breaking)

**部署说明**:
- 无 schema 变更、无新 migration,`prisma migrate deploy` 不需要跑
- 重启 next start 即可生效(无缓存文件、无服务端状态依赖)
- 导出 CSV/Excel 列宽可按需调整(日期字段从 14 → 10 字符宽度更紧凑)

### v0.8.2(2026-07-04) 回滚 9a48265 + README 乱码修复 + 删 CI/Deploy 自动化

> `9a48265` 那次 commit 引入 3 个 prisma migration 试图下线报表中心,但在 fresh DB 上按时间序 apply 时与历史 migration `20260707_report_center` 冲突(同一 `ReportDefinition` 表被两次 CREATE 字段结构不同的版本),CI 在 `prisma drift` 和 `vitest` 两个 job 的 `prisma migrate deploy` 步骤上失败。本版本决定回滚该 commit 的代码 + migration 改动,保留 v0.8.1 状态;同时彻底删除 CI 和 GitHub 自动部署(workflow 文件 + 依赖),改回「本地开发 + 运维手动部署」模式。

**回滚 9a48265 (一)**:
- 原因: `9a48265` 的 3 条 migration(`20260704_report_center_redesign` / `20260704_report_ready_message_type` / `20260709_drop_report_center`)在 fresh DB 上跑会撞上历史 `20260707_report_center` (e543c41) 已经创建的 `ReportDefinition` / `ReportSnapshot` 表,CI 红
- 范围: 19 个代码/lib/test/seed 文件 + 3 个 migration 目录全部回退到 `ced7665` (9a48265 父) 状态
- 保留: `app/(app)/reports/*` 页面、`server/services/report.ts` 报表 service、`lib/report-labels.ts` 标签字典等全部复活
- 后续: 报表中心下线需用单一 migration(不带中间临时状态)重做,跟 `20260707_report_center` 复用同一组表结构,**不能再独立 CREATE TABLE ReportDefinition**

**README 乱码修复 (二)**:
- 根因: `9a48265` commit 提交时,`README.md` 被以错误编码写入 git blob(8200+ 简体汉字保存为 UTF-8 mojibake 形态,UTF-8 严格解码虽然通过但语义全部变成繁体/日文汉字)
- 修复: 从 `185b9c7` (v0.8.1) 还原 blob 后,**追加** v0.8.2 changelog 段(本节)
- 影响: `185b9c7` 之后的 README 历史 blame 在 v0.8.2 这条 commit 处归位,后续 commit 仍能正常追溯

**删 CI / GitHub 自动部署 (三)**:
- 移除: `.github/workflows/ci.yml` (-193 行) + `.github/workflows/deploy.yml` (-26 行),共 -219 行
- 根因: CI 流程的 `prisma deploy` fallback 自身有 bug(在 9a48265 之前/之后都失败),叠加 v0.8.2 schema migration 冲突,导致 CI 持续红灯 + 自动部署反复挂掉,生产环境被推到不一致状态
- 替代方案: 改回**本地开发 + 运维手动部署**模式,`scripts/prod/deploy.sh` 仍保留(加入 enum fallback 兜底,跟原 CI fallback 行为一致),生产部署由运维 SSH 上去手动 `sudo -E ./scripts/prod/deploy.sh`
- 后续: `next.config.mjs#computeAppVersion()` 仍能在 dev 上正常派生版本号 chip(依赖本地 `.git`),登录页右上角显示不变

**保留: `scripts/prod/deploy.sh` 加 enum fallback**:
- 修了 `20260630_message_type_enum_index` vs `20260627_message_type_enum_bootstrap` 的 enum 冲突,逻辑跟原 CI fallback 一致
- 走 fallback 时用 admin `DATABASE_URL` (qt_app, BYPASSRLS) 跑 `ALTER TYPE`,因为 `MIGRATION_DATABASE_URL` 是降权账号

**版本号**: `0.8.1` -> `0.8.2`(patch bump,仅文档 + 回滚 + 删 CI,无新增功能,无 schema 变更,无应用层 breaking 变更)
**部署说明**:
- 无 schema 变更、无新 migration
- `prisma migrate deploy` 不需要跑(生产 DB 仍在 v0.8.1 之前的 38 条 migration 状态)
- 如果生产已经按 `9a48265` 部署过(可能有 3 条新 migration 记录),需要手动 `migrate resolve --rolled-back` 这 3 条记录(DB 不会有真实 schema 污染,因为 v0.7 报表中心表早已存在,9a48265 的下线 migration 是 `DROP IF EXISTS` 兜底,不影响生产)
- 删 CI 后,**生产部署改回运维手动 SSH + `sudo -E ./scripts/prod/deploy.sh`**;deploy.sh 内的 enum fallback 会自动处理已知冲突

### v0.8.1(2026-07-04) 代码审计修复: 状态机并发安全 + 金额不变式 + 客户端竞态防护

> v0.8.0 报表中心上线后,对全项目做了一次代码审计,修复 10 个高优先级 bug,补充 2 组单元测试。本次覆盖 11 个文件,0 个新迁移,0 个 API 契约变更。

**状态机并发安全 (一)** (`lib/status-machine.ts`):
- `runTransitionInTx` 的 `UPDATE` 现在把源状态写进 `WHERE` (`status: { in: allowedSourceStatuses }`), 防止并发读-改-写覆盖
- 并发导致 Prisma `P2025` (无行匹配) 时,`silentSkip=true` 返回 `SKIPPED`,否则抛出 `ENTITY_IMMUTABLE` 或自定义 `mismatchError`
- 新增 `tests/unit/lib/status-machine.test.ts` 8 个单测覆盖 WHERE 子句 / P2025 映射 / 非 P2025 传播 / `SkipTransition` 行为

**合同金额不变式 (二)** (`server/services/contract/crud.ts`):
- `ADMIN` 调小 `totalAmount` 时,事务内聚合该合同下 `DRAFT/ISSUED/RED_FLUSHED` 发票金额与 `CONFIRMED/RECONCILED` 回款金额
- 任一聚合值超过新总额 + 0.01 元容差,抛 `INVOICE_OVER_LIMIT` / `PAYMENT_OVER_CONTRACT` (422)
- 新增 `tests/unit/server/contract-update-amount-guard.test.ts` 7 个单测覆盖允许/拦截/容差边界

**金额精度 (三)**:
- `server/services/contract/status.ts`: `tryAutoClose` / `tryAutoCloseOnOverdue` 阈值计算改用 `Prisma.Decimal`,避免 `total * ratio` 浮点漂移
- `server/services/invoice/action.ts`: 红冲创建负数发票时使用 `new Prisma.Decimal(...).negated()` 替代 `-Number(...)`;`PLANNED` 回款 `paymentNo` 改为 `nextBusinessNo("PAYMENT")-PLANNED`,避免时间戳冲突

**客户端竞态防护 (四)**:
- `lib/use-list-request.ts`: 加 `requestIdRef` 序号, 忽略过期请求的 `setData`
- `app/(app)/dashboard/page.tsx`: `fetch` 加 `AbortController`,effect cleanup 中 abort
- `app/(app)/statistics/aging/page.tsx`: `useMemo` 副作用改为 `useEffect`,`refetchAging` 内加请求序号/abort 保护

**参数与 JSON 校验 (五)**:
- `app/api/statistics/export/route.ts`: `minAmount` 转换后检查 `Number.isNaN`,非法时返回 400
- `server/storage/presign.ts`: `contract.attachments` 元素用 Zod schema 校验,异常结构回退空数组

**测试加固 (六)**:
- 修复 `tests/api/signer-contract-detail.test.ts` SALES 隔离断言,使其对本测试 TAG 创建的合同做断言,避免被 seeded 数据污染
- 全量测试: `npm test` 71 文件 / 565 测试全部通过

**版本号**: `0.8.0` → `0.8.1`(patch bump,仅 bugfix + 测试,无 schema 变更,无 breaking change)
**部署说明**: 无 schema 变更,无新迁移;`prisma migrate deploy` 不需要跑;业务上仅 `ADMIN` 缩小合同总额时新增校验,正常流程不受影响

### v0.8.0(2026-07-03)报表中心重做: PDF 5 字段 + 多 sheet Excel + 文件名时间戳

> v0.7.0 报表中心上线后, 跟 2026年5月业务明细.pdf 模板对齐, 把员工业绩做成跟原版一致的"按签约人 + 万元小计"结构。本次覆盖 11 个 commit, 涉及 12 个文件, 0 个新迁移 (数据沿用 v0.7 的 ReportDefinition / ReportSnapshot 表)。

**核心变更 (一) PDF 5 字段对齐**:
- 员工业绩明细表严格按原 PDF 模板 5 列: 所属区域 / 企业名称 / 服务项目 / 签约人 / 合同金额(元)
- 末列"小计(万元)"只在签约人小计行 + 全公司合计行填值, 合同行空
- 签约人小计行"签约人"位置写 "{姓名} 小计", 不带工号; 全公司合计行写 "全公司合计"
- 视觉: 粗黑边框 + 浅黄/灰底色 + 居中表头 + 金额右对齐 + tabular-nums 等宽数字
- 签约明细不再输出: `userId / employeeNo / serviceType 代码 / signDate / contractNo / rowType` (内部主键/枚举 code, 不外露)

**Excel 多 sheet (二)**:
- `lib/excel.ts` 新增 `exportToMultiSheetXlsx` (多 sheet 导出, 31 字符 sheet 名截断, 非法字符转 `_`)
- 报表中心导出 Excel: 1 sheet "员工业绩明细(按签约人)" 6 列; 跟 PDF 字段一一对应
- 删了之前的"员工业绩汇总" sheet (跟 KPI 卡片重复, 跟 PDF 不符)

**数据口径 (三) 改用签约人**:
- 新增 `getSignerSummary` (按 signerId 聚合 合同/开票/回款) 跟 `getSignerContractDetail` (合同级明细) 同维度
- 旧 `getEmployeePerformance` (按 ownerUserId 聚合) 弃用, 但保留兼容 (新 payload.signerSummary 优先)
- 详情页 + Excel + PDF 全部走"签约人"口径, 1 个人在同一张报表里"汇总 + 明细"逻辑自洽

**移除自动生成 (四) 简化**:
- 详情页进入不再静默建快照 (`getOrBuildSnapshot` 拆为 `findSnapshot` 只读 + `generateSnapshot` 显式生成)
- 找不到快照时返 404 + 中文提示, 前端走"未生成"空态 + 大"立即生成报表"按钮
- 删 `server/jobs/report-snapshot.ts` + `runner.ts` 里 cron 调用
- 保留 `scripts/shared/backfill-report-snapshots.ts` (一次性手动补历史用)
- 每日 0 点 cron 不再自动跑报表生成

**API 拆分 (五)**:
- `POST /api/reports/snapshots` body 加 `action` 字段: `snapshotId` 走 `regenerateSnapshot`, `action=generate` 走 `generateSnapshot`, 否则 `findSnapshot`
- `POST /api/reports/export` 支持两种模式: `snapshotId` 走快照, `code+periodType+from/to` 走实时 (CUSTOM 周期永不写快照, 但仍要能导出)
- `server/services/report.ts` 拆出 `buildExportSectionsFromResult` helper, snapshot 和 live 两条路径共用 section 构造

**文件名时间戳 (六)**:
- 所有导出文件名统一 `YYYY-MM-DD_HHMM` 格式 (精确到分), 避免同日多次导出覆盖
- `lib/date-range.ts` 新增 `exportFileTimestamp()` helper, 本地时区
- 影响: reports / statistics / customers / payments / invoices / contracts 共 6 个 export 路由
- PDF 另存: print-html `<title>` 加 `_{periodLabel}_{ts}` 后缀, 浏览器"另存为 PDF"对话框默认用这个名
- Content-Disposition 同步加 `filename="..."` (defensive, 给直接下载的客户端)

**测试 (七)**:
- `tests/api/reports.test.ts` — 重写为 9 个新测试 (findSnapshot 404 / generateSnapshot 创建 / hash skip / CUSTOM live / regenerate / permissions)
- `tests/api/reports-export.test.ts` — 8 个测试 (5 PDF 5 字段 + 1 不再有汇总 + 2 实时查询)
- `tests/api/signer-contract-detail.test.ts` — 3 个新测试 (字段对齐 + SALES 隔离 + 权限)
- 删 `tests/lib/report-period.test.ts` 里 `previousPeriod` 相关测试 (函数一起删)

**生产数据**:
- 跑 `pnpm tsx scripts/shared/backfill-report-snapshots.ts --year 2026` 补全 2026 年 1-12 月快照 (36 个组合, 6 月/7 月/Q3/年 是已生成的)
- 2026-07-03 实测 5月员工业绩: 16 个签约人共 62 笔合同, 总 410,880 元 (41.09 万), 跟 PDF 数据完全一致

**版本号**: `0.7.0` → `0.8.0` (minor bump, 新功能为主, 1 个 breaking: 报表中心不再自动生成)
**部署说明**: 无 schema 变更, 无新迁移; `prisma migrate deploy` 不需要跑; `report-snapshot` cron job 已从 `runner.ts` 移除, `qt-jobs.cron` 注释同步去掉; 现有快照数据无需迁移

### v0.7.0(2026-07-03)应收账龄重设计 + 催收功能

> 在 v0.6.0 事故复盘之后,继续推进"应收侧的可控性"建设。本次以 `Invoice.dueDate` + `DunningNote` 为核心,补齐账龄 / 催收 / 跟单的全链路。

**新模型 (一) DunningNote**(8 字段催收记录):
- `server/services/dunning.ts` + `prisma/schema.prisma` 新 model:`DunningNote` (`invoiceId` FK CASCADE → `Invoice`, `actorId` FK RESTRICT → `User` 防 actor 误删)
- 字段:`status` (CONTACTED / PROMISED / DISPUTED / LEGAL) / `promisedDate` / `lastContactAt` / `channel` (PHONE / WECHAT / EMAIL / VISIT) / `remark` / `actorId`
- 索引:`(invoiceId)` / `(status)` / `(actorId, createdAt)`
- 业务语义: 单一催收动作 = 1 行 DunningNote;PROMISED 状态填 `promisedDate`(客户承诺付款日);最近一次联系 = `lastContactAt` 用于"距上次跟进 N 天"提醒

**Schema 增量 (二)**:
- `Invoice.dueDate` (TIMESTAMPTZ, nullable): 合同约定付款日,账龄 `basis=due` 用;为 null 时回退 `actualIssueDate` 计龄。`@@index([dueDate])` 加快扫描
- `Contract.owner` 反向关系补建:之前 `User.ownedContracts` 漏配(只配了 `signedContracts`),导致 `ownerUserName` 渲染走 `String` fallback 而非 `relation` join
- 迁移 `20260703_aging_redesign`(单事务): `ADD COLUMN dueDate` + `CREATE TABLE DunningNote` + 3 索引 + 1 FK + 回填(只有 ISSUED 且 dueDate 为空的发票,默认 `actualIssueDate + 30 天`,其它状态保持 NULL 等用户后续录入)
- 兼容:不动历史 migration,只新增对象,跟 `AGENTS.md` "不可变迁移" 规则一致

**API 路由 (三) 7 条**:
- `GET /api/statistics/aging/by-customer` — 按客户维度分账龄档(0-30/30-60/60-90/90+)
- `GET /api/statistics/aging/by-owner` — 按合同负责人维度(给 SALES 排行 + ADMIN 巡检)
- `GET /api/statistics/aging/trend` — 账龄趋势(对比 7/30/90 天前快照)
- `GET /api/statistics/aging/uninvoiced-contracts` — 未开票合同清单(账龄基于合同止期)
- `GET/POST /api/statistics/aging/dunning-notes` + `[id]` — 催收记录 CRUD(REST 风格)
- `GET /api/statistics/aging/dunning/summary` — 催收汇总(每张发票的最近 N 条催收)

**组件 (四) 4 个**:
- `components/aging-summary.tsx` — 4 档账龄汇总卡片(总应收 / 0-30 / 30-60 / 90+)
- `components/dashboard-aging-mini.tsx` — dashboard 嵌入的迷你账龄视图
- `components/dunning-drawer.tsx` — 催收抽屉(详情页/列表页内嵌,展示 + 新增催收记录)
- `components/authority.tsx` — `<Authority>` 通用权限包装(替换 `lib/permissions.ts` 旧 `useCanX` 系列,统一前端权限渲染)

**统计页改造 (五)**:
- `app/(app)/statistics/aging/page.tsx` — 700+ 行重写,新交互:客户 / 负责人双维度切换 + 催收入口
- `app/(app)/statistics/by-region/page.tsx` / `performance/page.tsx` — 微调联动
- `app/(app)/dashboard/page.tsx` — 加 aging mini
- `app/api/statistics/export/route.ts` / `invoice-aging/route.ts` — 导出 + invoice aging API 适配 dueDate basis

**基础设施 (六)**:
- `lib/permissions.ts` — 加 9 行新资源/动作的权限映射(STATISTICS.AGING_READ, DUNNING.*)
- `lib/i18n.ts` — 加 150+ 行 dunning / aging / authority 词条
- `components/callout.tsx` — 微调
- `server/services/statistics.ts` — 581 行重写,统一 dueDate basis 抽象

**测试 (七)**:
- `tests/api/aging.test.ts` / `aging-api.test.ts` / `dunning.test.ts` — 单测覆盖 3 大 API + 边界(dueDate null 回退 / cascade delete / force actor)
- `tests/api/statistics-aggregation.test.ts` — 加 41 行新场景
- `tests/e2e/15-aging-redesign.spec.ts` — Playwright 端到端(详情页打开催收抽屉 + 录入催收 + 列表显示)

**文档 (八)**:
- `docs/architecture/DESIGN-v3.md` — 加 59 行(账龄重设计 + DunningNote 实体 + dueDate basis 规则)
- `docs/user/USER_MANUAL.md` — 加 27 行(账龄页使用 + 催收流程 + Authority 组件用法)

**版本号**: `0.6.0` → `0.7.0`(minor bump,新功能 + 新 schema,无 breaking change)
**部署说明**: 含 1 个新迁移(`20260703_aging_redesign`),含 DunningNote 表创建 + Invoice.dueDate 加列 + 回填;首次部署后 ISSUED 发票的 dueDate 会被自动回填为 `actualIssueDate + 30 天`,财务可在开票审核时手动覆盖

### v0.6.0 (2026-06-29) cron 静默失败 9 个月事故复盘 + 运维监控 + 修复

> 2025-09 ~ 2026-06-28 期间 cron 静默失败 9 个月无人察觉,恢复后 `tryAutoCloseOnOverdue` 批量强关 209 个 overdue_terminated 合同 + 31 个 admin 误关 + 2 个 completed 异常 = 共 242 个 CLOSED 合同 269 万应收被锁死。本次发版以"修复 + 防再发"为核心。

**修复 (一) reopen + force 旁路** (`4502f182`)：

- **feat(contract)**:新增 `POST /api/contracts/[id]/reopen` 接口, admin 专属, CLOSED → ACTIVE。4 档 `reason` 枚举 (`recovered_from_fake_close` / `data_correction` / `reopen_for_payment` / `other`, `other` 必填 `reasonNote`), 完整事务 + `ContractReviewLog` (`action=MANUAL_REOPEN`) + audit log + `reviewComment` 标记 `reopened:<reason>` 便于追溯
- **feat(payment)**: `createPayment` 加 `force: true` / `forceReason` 旁路, 仅 ADMIN 可用, 仅 CLOSED 合同允许, 业务校验保留 (金额/发票), `remark` 自动追加 `[FORCE_BACKFILL:<reason>]` 审计标记
- **feat(api)**: `POST /api/payments` body 加 `force + forceReason` overlay (不进 `PaymentCreateInput` 主 schema, 避免污染前端类型)
- **docs**: postmortem `docs/history/postmortem/cron-silent-failure-postmortem.md` (完整复盘 + 鱼骨图 + 修复时间线) + `docs/history/postmortem/contract-fake-close-recovery.md` (修复方案 + 选择指南) + `scripts/migrate/contract-fake-close-recovery.{sql,ts}` (事务 + 备份 + 审计 + 回滚 SQL)
- **部署记录**: 2026-06-29 已执行恢复脚本, 242 个合同已恢复 ACTIVE, 财务可补录回款

**防再发 (二) cron 健康监控** (`af734c28`)：

- **feat(ops)**: `scripts/ops/cron-healthcheck.sh` (183 行) — 每小时第 5 分钟跑的自检脚本, 4 维度检查 (crond 服务 / qt-cron.log 最近 2h 写入 / qt-app 3000 端口 / PostgreSQL 容器 healthy), 失败写日志 + 可选飞书 webhook 告警
- **chore(ops)**: `ops/qt-jobs.cron` 加 `5 * * * * cron-healthcheck.sh` 条目 (跟 `0 * * * * run-all` 错开, 防止互相干扰)
- **feat(deploy)**: `scripts/prod/deploy.sh` 加 deploy 后自检 — `/etc/cron.d/qt-jobs` 必须含 `source .env` + 立即触发 `run-all` 验证 token + 跑一次 `cron-healthcheck.sh` (防 deploy 静默 break cron)
- **feat(events)**: `server/events/bus.ts` `CONTRACT_EXPIRED_UNPAID` 文案分档 — `daysUntilForceClose` ∈ {7, 3, 1} 红色醒目 `⚠️【强关预警】` + 立即处理指引; = 0 时 `⚠️ 今天将被系统强关`; 其它普通 `还剩 N 天`
- **docs**: `docs/user/USER_MANUAL.md` 新增 §16 运维小贴士 (30 秒自检 / 健康监控 / 强关文案规则 / deploy 报错排查 / 应急处理入口)

**选择指南 (三) postmortem 补 reopen vs force** (`c959b300`)：

- **docs(postmortem)**: `docs/history/postmortem/contract-fake-close-recovery.md` 新增 §4.4 / §4.5 — 4 档典型场景对应推荐路径 (历史批量 → SQL / 单合同误关 → reopen / CLOSED 补录 → force / DRAFT 拒绝), 关键提醒 (reopen 后 cron 仍可能再次强关, 正确流程是 reopen → 立即补录 → tryAutoComplete), 接口 curl 示例

**审查修复 (四)** (`dd3cfa29`)：

- **fix(contract)**: 合同操作日志 Timeline SUCCESS 补 `CheckCircleFilled` (`var(--ant-color-success)`) icon, 跟 FAILURE 的 `CloseCircleFilled` 对称
- **chore(contract)**: `reopen` route 文件末尾补 newline (diff 标 `\ No newline at end of file`, eslint 警告)
- **fix(statistics)**: by-region 柱状图 `groupedChartData` 加 `fullName` 字段, tooltip.title 显示完整"区 + 街道"组合 (解决跨区同名镇街在 X 轴重复条目难区分)

**代码清理 (五)** (`07324d63`)：

- **refactor(lib)**: 抽 `serviceTypeLabel(value: unknown): string` helper (lib/enum-maps.ts), 替换 5 处散落的 `SERVICE_TYPE_MAP[v] ?? v ?? "—"` 写法 (客户详情合同 tab / 付款详情 / 合同详情 / xlsx 导出 / PDF 导出), 客户端/服务端通用, 未来新增 serviceType code 不会漏改

**质量基线**：typecheck 0 错误, lint 0 warning, vitest 56 文件 / 452 测试全过, deploy smoke test 全绿, post-deploy cron-healthcheck 5 维度全 OK

**部署期特别提醒**：本次 deploy.sh 已自动跑 cron 自检, 但 `cron-healthcheck.sh` 是新加脚本, 服务器**首次安装**需要手工执行：

```bash
sudo cp /opt/qt/ops/qt-jobs.cron /etc/cron.d/qt-jobs
sudo chmod 644 /etc/cron.d/qt-jobs
sudo systemctl restart crond
/opt/qt/scripts/ops/cron-healthcheck.sh --verbose  # 验证
```

后续 deploy 会自动验证 `cron-healthcheck.sh --once`, 不会再"装完忘装"。

### v0.5.1+ (2026-06-29) 增量小修

> 本节汇总 v0.5.1 之后、HEAD 之前的所有 commit(16 个)。覆盖客户状态机下线后的清理、客户统计区间增强、系统 actor 自动状态机、合同默认负责人、证书页 bug、迁移漂移恢复、AI 团队配置。

- **feat(dashboard)**:统计区间支持月度 / 季度 / 年度切换(`StatisticsRange` 新枚举,顶部 Tab 与 URL `?range=` 同步,后端 `getOverview({ range })` 入参)
- **refactor(dashboard)**: `customers.newThisMonth` → `newInRange`(语义对齐统计区间,Top 客户与 dashboard 一致)
- **fix(customer)**:详情页 `select` 移除 v0.5.0 已删的 `status / lastAutoAppliedAt` 字段
- **fix(seed)**:seed upsert system actor(`id=system`)—— 自动状态机转换需要 `actorId`,否则 `tryAutoComplete` / `tryAutoCloseOnExpiry` 抛外键错
- **fix(contract)**:`SALES` 创建合同时 `ownerUserId` 默认 = 当前 user,与详情页 `ownerUserId` 一致;补 `tests/unit/server/contract-create.test.ts` 用例
- **chore(contract)**:合同 Timeline 切 antd 6 API(`TimelineItem dot` → `dot` 接受 ReactNode),失败状态加红 icon
- **chore(payments)**:清未使用的 `Tag` 导入(antd 6 lint 警告)
- **fix(certificates)**:到期证书页 `request` 解包错位(`response` 二层包)→ 直接读 `data.items`
- **chore(db)**:恢复漂移的 3 个迁移文件(从 git 历史找回,不能 `migrate resolve` 凭空标记),加 `docs/ops/db-bootstrap.md` + `prisma db-schema-snapshot.sql` 兜底脚本
- **chore(deps)**:`dev / test / typecheck` 加 `predev` 钩子自动 `prisma generate`,免手动 build 漏掉 client
- **feat(dev)**:登录页测试账号对齐 5 个内置角色(原 4 个,加 `expert` 用于权限矩阵测试,不进快速填充卡)
- **chore(harness)**:初始化 Mavis 团队配置(`.harness/` + `AGENTS.md`),`harness / developer / prisma-expert / backend-expert / ui-expert / code-reviewer` 6 个 rein,详见 [.harness/agent.md](.harness/agent.md)

### v0.5.1(2026-06-28)Excel 导出文件名国际化 + 合同选择器增强

小版本集中修 8 个 xlsx 导出端点(统计 4 / 合同 / 客户 / 回款 / 开票)的 `Content-Disposition` 中文文件名 + 客户端 `downloadExcel` 解析。涉及 [lib/excel.ts](lib/excel.ts) 新增 `attachmentHeader()`,[app/api/statistics/export/route.ts](app/api/statistics/export/route.ts) 等 8 个导出路由 + [app/api/files/raw/[id]/route.ts](app/api/files/raw/%5Bid%5D/route.ts) 文件下载。

- **fix(statistics)**:`区域统计` 等中文 xlsx 文件名在 Node `Headers` API 抛 `TypeError: Cannot convert argument to a ByteString`(byte 22, value 21306)→ 500。统一改 `attachmentHeader()` 走 `filename=ASCII_fallback; filename*=UTF-8''<percent-encoded>` 双形式,老 IE 拿 ASCII、现代浏览器拿 UTF-8。同步覆盖 `/api/files/raw/[id]` 文件下载(`originalName` 也是中文,同一根因)
- **feat(form)**:新建开票 / 登记回款的合同 `ProFormSelect` option label 拼接 `合同号 · 合同标题 · 合同总额`,下拉搜索时可一眼看到合同金额;`Contract` 类型补 `totalAmount: string` 字段
- **fix(payment)**:登记回款 `FormCard` headerHint 渲染 `合同：undefined(客户名)`,根因是 `onChange` 拼 `pickedContract` 时漏塞 `contractNo`。option 改成 `contract: c` 整份合同塞入,`setPickedContract(o?.contract ?? null)`,以后扩字段不会再踩
- **refactor(invoice)**:开票表单合同选择器 option 同步对齐成 `contract: c` 写法,onChange 从 `o.contract?.customerId` 取值,两张表单结构统一
- **refactor(client)**:`lib/excel-client.ts` 的 `downloadExcel` 解析 `Content-Disposition` 之前用 `/filename=([^;]+)/` 拿到 ASCII 兜底而丢掉中文,改成优先 `filename*=UTF-8''` + `decodeURIComponent`,fallback 才退到 ASCII;三个统计页(总览/Top 客户/区域/员工业绩)改用 `downloadExcel(url)`,文件名以服务端 `Content-Disposition` 为单一来源,删手写 `<a download="中文.xlsx">`
- **test(unit)**:`tests/unit/lib/excel.test.ts` 加 4 条 `attachmentHeader` 单测(中文 / 纯 ASCII / 带空格 / `encodeURIComponent` round-trip),11/11 通过;端到端验证 8 个导出端点 200,文件名均带中文

### v0.5.0(2026-06-29)客户状态机下线(硬删)

业务反馈 v0.4.0 上线的客户状态机(5 态 + 4 条自动规则 + 7 天可撤销横幅)语义不清 / 自动化规则常误判, 整体硬下线。设计: [docs/superpowers/specs/2026-06-29-customer-status-deprecation.md](docs/superpowers/specs/2026-06-29-customer-status-deprecation.md)。

- **chore(customer)**:删 `Customer.status / lastAutoAppliedAt / lastAutoRule` 3 列 + `@@index([status])` (`Customer_status_idx`); 删 `enum CustomerStatus`(5 态); migration `20260629_drop_customer_status`(`DROP INDEX IF EXISTS` + `DROP COLUMN IF EXISTS`, idempotent, 状态列 v0.4.0 起为 String 故无需 backfill)
- **chore(lib)**:删 `lib/customer-status-transitions.ts` / `lib/customer-auto-rules.ts`; `lib/{status,dict-domain,dictionary-categories,use-status-enum,validators/customer,env,customer-update}.ts` 移除 `customer` StatusDomain 引用 / 字典 / 校验字段 / 错误码 `CUSTOMER_STATUS_TRANSITION_INVALID` / `CUSTOMER_AUTO_*`
- **chore(server)**:删 `server/services/customer/{status,automation}.ts` + `server/services/customer-status.ts` + `server/jobs/customer-status-suggest.ts`; 改 `server/services/customer/{crud,index}.ts` / `server/services/contract/{crud,status}.ts` / `server/jobs/runner.ts` / `server/events/bus.ts` / `server/services/statistics.ts` 移除外发调用
- **chore(api)**:删 `POST /api/customers/[id]/revert` 路由; 改 `GET/PATCH /api/customers/[id]` / `GET /api/customers/export` / `GET /api/jobs/[job]` / `GET /api/statistics/overview` 移除外发
- **chore(ui)**:删 `components/customers/auto-status-banner.tsx`; 详情页/列表页/表单移除「变更状态」入口 + 撤销横幅; 客户 PDF 改用合同级状态
- **chore(types|events|errors)**:`MessageType` enum 3 个 `CUSTOMER_STATUS_*` 值**保留**(历史消息 fallback); `bus.ts` `default` 分支渲染为「历史消息」; `operation-log-format.ts` `CUSTOMER_STATUS_*` action 返 null
- **refactor(schema)**:跨模块校验 R-02 / R-03 / R-13 删; R-16 指向 `lib/status-machine.ts`(通用抽象, 仍 4 实体共用)
- **chore(tests)**:删 `tests/{api,unit,unit/server}/customer-status*.test.ts` + `tests/e2e/08-customer-status.spec.ts`; 修 5 个 contract-* test + `customers-patch` / `customer-update` / `validators/customer` / `events-bus` / `contract-create-validation` / `customer-contract-overview-ownership` / e2e `05-invoice-payment-flow`
- **chore(docs)**:DESIGN-v3 §5.5 → deprecation 链接; PROJECT_SUMMARY §3.3.2 → 简化为 deprecation 总结; USER_MANUAL §5.1 状态表 / §5.6 客户状态自动联动 / FAQ Q5 全删; README 删 §3 客户状态机节 + 删 R-02/R-13; v0.4.0 spec `2026-06-28-customer-status-automation.md` 移入 `docs/superpowers/specs/_archive/`
- **test**:vitest 425/425(54 files, -14 customer-status 用例); typecheck 0 error; eslint 0 warning; 后续 e2e(跳过 08-customer-status)待 commit 前跑

提交 `BREAKING CHANGE` 一次性合并(单 commit, 涵盖所有 schema/lib/server/api/ui/types/tests/docs 改动)。

### v0.3.1(2026-06-26)员工档案 + 证书到期 cron + 资产下线 + 导航重构

- **feat(employee-profile)**:`EmployeeProfile` 表 + 5 张子表(教育/证书/工作经历/合同/家庭成员),`Attachment.category` 字段,`MessageType.CERTIFICATE_EXPIRING` 枚举值
- **feat(employee-profile)**:PR7-PR11 五批 — 批量操作 + 向导/子表打磨 + E2E 覆盖 + P0 阻塞修复 12 项 + 用户手册 v0.4 重做
- **feat(certificate)**:证书到期 cron 30/15/7 档(`certificate-expiry-check`)+ 列表页 + 用户列表 badge
- **chore(refactor)**:下线公司资产库(CompanyAsset)模块 — DROP CompanyAsset + DROP Attachment.assetId/isPrimary + DROP POLICY + DELETE 字典 ASSET_TAG(资产模块生命周期 13 天)
- **feat(message)**:Message.type 从 text 收紧到 enum MessageType(7 枚举值),加 type+receiverUserId+createdAt 复合索引
- **refactor(nav)**:统一返回按钮走 `useGoBack()` hook(浏览器历史优先 + fallback 兜底),删 30+ 处硬编码 `router.push('/x')`;详情页 5 分组合并为 ProfileHero + 卡片网格
- **fix(nav)**:消息中心 PageHeader 加 type='navigation' 提示
- **fix(lint)**:antd 新 API — `Space direction='vertical'` → `orientation='vertical'`
- **fix(dashboard)**:summary 接口把 range 塞进 overview 返回
- **fix(statistics)**:员工业绩页默认本月区间(与 dashboard 一致)
- **fix(invoice)**:开票保存 applyDate 改用 dayjs().toISOString() 兼容 string/dayjs
- **fix(invoice-new)**:合同下拉 pageSize 100 → 1000
- **fix(contract-export)**:新增项目负责人列,签订人/负责人只显示姓名
- **fix(users)**:详情页删右侧 Anchor 解决 active 不同步;SWR 多解一层;修 DepartmentTreeSelect 集成;加保存按钮;skeleton 永远卡死
- **test(e2e)**:场景 14 - 员工档案 CRUD + 附件上传端到端覆盖
- **chore(test)**:删 `tests/e2e/13-employee-batch-ops.spec.ts`(多选链路已移除)

**部署期观察**:6 个新迁移在 v0.3.0 → v0.3.1 之间手工应用(`20260630_message_type_enum_index` 试 3 次才成功),本次 1 commit `b2e9f1bdf` 是纯 refactor,deploy.sh 一键跑。详见 `docs/部署记录 — qt-biz v0.1.0 — Aliyun ECS.md` v0.3.1 节

**已知问题**:`contract-auto-complete` job 偶发 `TransactionWriteConflict`(PostgreSQL 40001,单实例 3.5G 机器无分布式锁,193 行扫描里 1 条失败);job 缺 retry loop,v0.3.2 / v0.4.0 跟进

### v0.3.0(2026-06-24)企业资产库模块下线

> 沿用 `20260623_drop_project_and_workflow` 的硬下线模式:删表 + 删代码 + 删权限 + 删菜单。详见 `prisma/migrations/20260628_drop_company_assets/`、`lib/permissions.ts`、`components/dashboard-shell.tsx`。

- **chore(asset)**:`CompanyAsset` 表 + `Attachment.assetId/isPrimary` 列 DROP,`RESOURCE.ASSET` 与 5 角色 ASSET 权限矩阵回收,`asset-expiring` 定时任务 / `ASSET_EXPIRING` 消息链路拆除
- `app/(app)/assets/`、`app/api/assets/`、`components/assets/`、`server/services/asset{,-stats,-expiry-job}.ts`、`lib/{assets,validators/asset}.ts`、`prisma/seed-assets.ts` 整目录/文件移除
- `ASSET_TYPE` / `ASSET_STATUS` / `ASSET_TYPE_MAP` / `ASSET_STATUS_MAP` / `ASSET_*` 错误码 / `menu.assets` / `asset.*` i18n 全部清掉
- 3 个 `seed:assets` / `migrate:asset-primary-attachments[:dry]` npm script 移除
- `ASSET_TAG` 字典白名单与 seed 同步清掉

### v0.3.0(2026-06-24)统计分析 round-2 收尾

详见 [docs/history/code-review/phase-review.md](docs/history/code-review/phase-review.md) 末尾 Round-2 修复节、[docs/architecture/DESIGN-v3.md](docs/architecture/DESIGN-v3.md) §8 / §9.7、[docs/user/USER_MANUAL.md](docs/user/USER_MANUAL.md) §11。

- **chore(statistics)**:round-2 工具与脚本入库 — `lib/date-range.ts` 统一前后端日期范围,`scripts/dev/seed-customers-contracts.ts` dev 测试数据,`scripts/shared/cleanup-minio-objects.ts` MinIO 桶清理
- **test(statistics)**:`tests/api/statistics-aggregation.test.ts` 4 条真实 DB 集成断言(账龄 total / REFUNDED 抵消 / unpaidAmount clamp / SALES short-circuit)
- **fix(statistics)**:修复 `unpaidAmount === 0` 断言(改用 delta 法验证 clamp 行为)
- **chore**:删除 `tests/e2e/99-debug-spacing.spec.ts`(引用已下线的 `/assets/new?type=PERFORMANCE`)

### v0.3.0(2026-06-23)合同 7→3 状态机 + 项目/工作流模块删除

- **chore(workflow)**:彻底删除项目管理和工作流引擎模块 — Project / WorkflowTemplate / WorkflowStage / WorkflowTask / WorkflowTaskInstance 五张表 DROP,5 个 dict 类别 `PROJECT_STATUS` 移除,12 个 dead 路由改 410 Gone,`action` 8→5,清掉 ~50 个 dead 字段/路由/文件
- **refactor(contract)**:合同状态机 7 态 → 3 态(DRAFT / ACTIVE / CLOSED)。SQL 迁移带断言(失败会回滚)+ 备份到 `_Contract_status_simplify_bak`;`migrate:contract-status-dict` 软停用 6 旧 code + upsert 3 新 code。4668 合同一次性收敛(524 ACTIVE / 4109 CLOSED / 35 DRAFT)
- **feat(contract)**:合同自动状态机 — `contract-auto-publish`(DRAFT 字段完整+附件 → ACTIVE)和 `contract-auto-complete`(ACTIVE 开票足额 → CLOSED)两个 cron job 落地
- **feat(customer)**:客户状态机 — 字段 `status` (ACTIVE / INACTIVE / PENDING) + 服务层规则(v0.4.0 升级为 5 态, v0.5.0 整体下线)
- **feat(announcement,message)**:公告详情页 + 消息未读计数 + 事件总线收敛
- **feat(invoice,payment)**:发票/回款详情页用 enum map 显示中文标签
- **feat(jobs)**:加 `/api/jobs/contract-expiry` 单跑端点
- **fix(invoice)**:R-08 累计开票包含 DRAFT,避免超额创建草稿
- **chore(refactor)**:6 月业务收紧 — 删 `Project.budgetAmount` + `PaymentAllocation` + OperationLog 审计字段;6 个 ts-nocheck 全部清退
- **feat(data)**:旧 FineUI MySQL 数据迁移 CLI 落盘

部署期 hotfix(`6c3cd090`):Zod v4 `.partial()` 不允许在含 `.refine()` 的 schema 上 — `lib/validators/announcement.ts` 拆出 `announcementFields` 单点真理;`20260626_invoice_attachments_json` 加 `IF NOT EXISTS` 幂等。

### v0.2.0(2026-06-22)合同/项目收紧 + 业务纯化

> 注:v0.3.0 之后此版本引入的"项目"功能已被删除,以下记录保留作历史参考。

- **feat(contract)**:合同管理新增「负责人」字段,创建/编辑可从员工列表选任意 ACTIVE 员工,默认继承 `customer.ownerUserId`
- **feat(project)**:项目详情页 admin-only 删除按钮(状态门控 `PLANNED / CANCELLED`,级联软删 `WorkflowTaskInstance` + `ProjectProgressLog`)。v0.3.0 后随项目模块整体下线
- **feat(payment)**:回款列表关键字搜索扩到「客户名称」
- **refactor(clean-up)**:项目回归纯业务 —— 移除「项目预算」+「回款分配明细」两个非核心横切功能
- **feat(audit)**:`OperationLog` 补 6 字段 `userAgent / requestId / method / path / status / errorMessage` + 配套索引 + 500 字符 `userAgent` CHECK 约束
- **feat(api)**:`GET /api/operation-logs` 增 6 字段与 `ip(contains) / status` 过滤;新增详情接口 `GET /api/operation-logs/[id]` 含 entity 名称 best-effort 反查
- **feat(ui)**:`/admin/operation-logs` 重写 — 状态 / IP 列、6 档快速时间区间、系统用户紫色徽标、动作中文标签、CSV 导出(带 BOM),行点击打开抽屉
- **feat(contract)**:合同状态机自动转换落地 — `tryAutoExecuteContract` / `tryAutoCompleteContract` / `tryAutoExpireContract` 三个钩子 + `runContractExpiryJob` 每日 01:00 扫过期合同
- **feat(schema)**:`User.isSystem Boolean @default(false)` + 迁移创建 `system` 占位用户(不可登录)
