# 业务 demo 种子脚本

`scripts/seed-business-demo.ts` — 5 套完整业务数据链(每套 = Customer → Contract → Project → Invoice → Payment),覆盖 5 个典型业务阶段。

## 5 套链一览

| # | 场景 | 客户 | 合同 | 项目 | 发票 | 回款 |
|---|---|---|---|---|---|---|
| 1 | 早期 | 杭州捷旭科技 (SIGNED) | 隐患排查 ¥18万 [EFFECTIVE] | IN_PROGRESS | ¥9万 [DRAFT] | - |
| 2 | 中期 | 杭州川泽电子 (SIGNED) | 安全管理咨询 ¥8万 [EFFECTIVE] | IN_PROGRESS | ¥4万 [ISSUED] | ¥2万 |
| 3 | 后期 | 杭州宏远印刷 (SIGNED) | 应急预案 ¥5万 [COMPLETED] | DELIVERED | ¥5万 [ISSUED] | ¥5万 |
| 4 | 长期 | 杭州军途重卡 (SIGNED) | 安全评估 ¥28万 [COMPLETED] | CLOSED | ¥28万 [ISSUED] | ¥28万 |
| 5 | 流失 | 杭州浩润电气 (LOST) | - | - | - | - |

## 用法

```bash
# 默认: dry-run, 只打印会创建什么
pnpm tsx scripts/seed-business-demo.ts

# 真写库
pnpm tsx scripts/seed-business-demo.ts --apply

# 清掉所有 demo 数据(只删 DEMO- 业务号, 不动用户/角色/字典)
pnpm tsx scripts/seed-business-demo.ts --clean
```

## 关键约定

- **业务号前缀 `DEMO-`**: 不走 `nextBusinessNo`, 不污染 Sequence, 一眼辨识
- **复用现有 ADMIN 用户** 当 owner / createdBy / updatedBy(脚本会查 `role.code = 'ADMIN'`, 找不到就报错)
- **绕过 SALES 行级隔离**: 用 `prisma.$transaction` + `SET LOCAL app.bypass_rls = 'on'`
- **不写副作用**: 不写 Attachment(MinIO 副作用), 不写 WorkflowTaskInstance(避免触发 9 阶段模板), 不写 FollowUp(避免污染跟进 360 行级视图), 不写 Sequence

## 适用场景

- dev / staging 环境页面演示
- 业务培训(给销售/财务看典型流转)
- 端到端测试的初始 fixture(用 `--clean --apply` 配合做 beforeEach 重置)
- 客户拜访前的"页面感受"演示

## 注意事项

- 脚本会读 `DATABASE_URL` 环境变量, 默认走 `.env` 里的库
- 跑 `--apply` 前建议先 dry-run 看输出, 确认 ADMIN 存在
- 跑 `--apply` 后想撤回, 直接 `--clean`, 不留痕迹
- 真生产库(`/opt/qt` 上的 `qt_biz`)**不建议**跑 `--apply` — demo 数据会让客户列表/合同列表/回款统计出现干扰行, 影响业务判断
- 5 条链总写入约 20 个实体(链 5 只 1 个, 其余各 5 个), 单次事务, 失败回滚
