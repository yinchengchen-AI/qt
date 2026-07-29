# 更新日志(AppRelease)自动发布 — 设计

日期: 2026-07-29
状态: 已批准(用户指令: 重新设计更新日志功能,要求可以自动发布)

## 背景与问题

应用内"更新日志"(AppRelease)功能闭环完整(模型 → service → API → admin 管理页 → 用户时间线 → 登录弹窗 → 已读追踪),但**发布全靠管理员手敲**:

- `/admin/releases` 表单手动填 version/title/summary/content;
- "从 git 自动填充"按钮(`preview-from-git` API → `lib/git.ts` + `lib/git-format.ts`)只生成草稿文本,不落 git 元数据,仍需人工点发布;
- schema 里的 `source / gitFrom / gitTo / gitCommitCount` 字段(prisma/migrations/20260706_app_release_git_source)以及注释引用的 `scripts/release/generate.ts` 是从未落地的遗留设计,`createRelease` 恒写 `source: "MANUAL"`;
- 无 CI/CD,发版流程是本地 `npm version patch` → push → 服务器 `scripts/prod/deploy.sh`(git pull + migrate + build + restart)。

目标:**版本 bump 后随部署自动发布更新日志**,用户登录即看到弹窗,零人工操作;admin 手工入口保留作兜底。

## 方案选型

| 方案 | 说明 | 取舍 |
|---|---|---|
| A. 部署时在服务器生成并写库(选用) | `deploy.sh` 增加一步 `npm run release:publish`,脚本读 git log → 写 AppRelease | 服务器本来就有 .git(git pull)和 DB;与 deploy 流程天然同步;幂等 |
| B. 本地 `postversion` 钩子直连生产库 | `npm version` 后直接写生产 DB | 生产 PG 绑 127.0.0.1,本地不可达,否决 |
| C. version 钩子生成 JSON 提交进仓库,部署时导入 | 两段式 | 服务器有 git,等价于 A 但多一层文件搬运,否决 |

## 设计

### 流程

```
npm version patch   (本地: bump + commit + tag vX.Y.Z)
git push --follow-tags
deploy.sh (服务器):
  git pull → install → migrate deploy → prisma generate → build
  → npm run release:publish        ← 新增,build 成功后、restart 前
  → systemctl restart → smoke
```

### scripts/release/publish.ts(新)

幂等发布脚本,步骤:

1. `version = "v" + readPackageVersion()`;
2. 查重:`AppRelease { version, deletedAt: null }` 已存在 → 打印 skip,exit 0(保护人工编辑;想重新生成需先在 /admin/releases 删除旧的,与 createRelease 语义一致);
3. `tags = listReleaseTags()`(v* 按创建时间新→旧);`fromRef = planFromTag(tags, version)`:当前版本 tag 的前一个 tag;当前版本还没 tag 时取最新 tag;一个 tag 都没有时 from=null,用 maxCount 兜底(30 条)防全量历史;
4. `from = resolveGitRef(fromRef)`,`to = getHeadSha()`(安全:先解析成 SHA 再拼 range,与 preview-from-git 同一防注入层);
5. `commits = filterReleaseNoise(getCommitsInRange(...))` — 过滤 `chore(release)`/`docs(release)` 等发版噪音 commit(bump、版本同步),否则每版更新日志都有"bump to vX";
6. `formatReleaseContent({ version, commits })` 生成 title/summary/content(复用现有大白话分节逻辑);
7. `important = shouldMarkImportant(commits)` — 任一 commit 带 breaking 标记(`!`)则置重要(弹窗红色、不可点遮罩关闭);
8. 发布人:`RELEASE_PUBLISHER_EMPLOYEE_NO`(默认 `admin`)查 ACTIVE 用户;查不到回落第一个 ACTIVE 的 ADMIN 角色用户;都没有 → 报错 exit 1;
9. 创建 AppRelease:`source="GIT_COMMITS"`,gitFrom/gitTo/gitCommitCount 补齐,写 audit 日志;
10. 打印分类统计(categoryCounts)便于部署日志排查。

### lib 层改动

- `lib/git.ts` 新增 `listReleaseTags(): string[]`(新→旧);`getLastReleaseTag` 保持不动。
- 新增 `lib/release-plan.ts`(纯函数,可单测):
  - `isReleaseNoise(subject)` / `filterReleaseNoise(commits)`;
  - `shouldMarkImportant(commits)`;
  - `planFromTag(tags, currentVersionTag)`。

### deploy.sh 挂接

build 成功、被临时停止的容器已拉起之后,`systemctl restart` 之前插入:

```bash
npm run release:publish
# 失败: 打 [WARN] 不阻断部署(发布日志失败不应拖垮发版;
# 可稍后手动 npm run release:publish 或在 /admin/releases 手工发布)
```

### admin 页面

`/admin/releases` ProTable 加"来源"列:`GIT_COMMITS` → 蓝色 Tag "自动生成"(tooltip 显示 "基于 N 个 commit"),`MANUAL` → 默认 Tag "手动"。i18n 加 `releases.column.source` / `releases.sourceAuto` / `releases.sourceManual` / `releases.sourceAutoHint`(zh+en 镜像)。

### package.json

加 `"release:publish": "tsx scripts/release/publish.ts"`。

## 错误处理

- DB 不可达 / 无发布人:脚本 exit 1,deploy.sh 打 [WARN] 继续;
- git 不可用(如无 .git 的 CI 容器):`listReleaseTags` 返回 [] → from=null → maxCount 兜底;`resolveGitRef` 失败抛错 exit 1;
- 重复执行:version 查重 skip,幂等。

## 测试

- `tests/lib/release-plan.test.ts`(新):噪音过滤、important 判定、tag 区间选择三种场景;
- `listReleaseTags` 归并进现有 `tests/lib/git-format.test.ts` 风格,不依赖真实 git 仓库的部分只测纯函数;
- 现有 `tests/lib/app-release-schema.test.ts` / `tests/api/app-release.test.ts` 不受影响(service 不变)。

## 非目标(YAGNI)

- CHANGELOG.md 自动同步(仓库根目录手工文件,与应用内更新日志是两套流程,本次不动);
- CI/CD 流水线(项目明确无 CI,deploy.sh 手跑);
- 用户时间线页 UI 改版;
- 自动发布后撤销/重写已发布内容(走现有删除+重发人工路径)。
