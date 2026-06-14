# 部署记录 — qt-biz v0.1.0 — Aliyun ECS 杭州

> **首部署时间**: 2026-06-12 (Asia/Shanghai)
> **服务器**: Aliyun Linux 3.2104 U13 / 2 vCPU / 3.5GB RAM / 49GB SSD
> **IP**: 116.62.160.24 (公网) / 172.25.32.245 (内网 eth0)
> **架构**: 同机 Docker 跑 PG/MinIO,native Node 跑 Next,systemd 托管,nginx 反代
> **域**: 无,IP+HTTP 直连

## 一、最终状态

| 项 | 结果 |
|---|---|
| Git HEAD | `46a274b` (含本次部署期发现的 3 个修复 commit) |
| Next.js | 16.2.7 在 127.0.0.1:3000,systemd 托管(`qt-app.service`),已 enable |
| PostgreSQL | 16-alpine Docker,`qt-postgres` 容器,9 migrations applied,无 pending |
| MinIO | latest Docker,`qt-minio` 容器,2 桶 (`qt-biz-attachments`, `qt-backups`) |
| nginx | 80 反代 → 3000,已 enable;默认 server 已从主 conf 清掉 |
| Cron | `/etc/cron.d/qt-jobs`(01:00 jobs,03:00 backup) |
| admin 用户 | `employeeNo=admin`(id=cmqahx56n0000tfmv4qe2fusl),已建,**首登后改密** |
| 4 system roles | ADMIN/SALES/FINANCE/OPS,均带 `ROLE_PERMISSIONS` 完整权限矩阵 |

## 二、烟测通过

```
$ curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/jobs/run-all
{"code":0,"data":{"at":"...","results":[
  {"job":"contract-expiring","created":0,"scanned":0,"durationMs":38},
  {"job":"invoice-overdue","created":0,"scanned":0,"durationMs":70},
  {"job":"project-due","created":0,"scanned":0,"durationMs":73},
  {"job":"customer-inactive","created":0,"scanned":0,"durationMs":71}
],"source":"cron"}}

$ curl -sS -X POST http://127.0.0.1:3000/api/jobs/run-all       # 401
$ curl -sS -X POST -H "Authorization: Bearer wrong" ...        # 401
$ curl -sS http://116.62.160.24/login                          # 200
$ curl -sS http://116.62.160.24/dashboard                      # 307 → /login
$ curl -sS http://116.62.160.24/api/customers                  # 401
$ curl -sS http://116.62.160.24/api/messages                   # 401
```

资源:1.4GB / 3.5GB 内存(40%),12GB / 49GB 盘(24%)。PG 41MB / MinIO 86MB。

## 三、部署期发现并修复的 3 个真实生产问题(已 commit)

### F1. 迁移文件夹名排序导致 fresh DB 必失败 (`bfeecc3`)

`prisma/migrations/20260610163019_invoice_attachments/` 时间戳前缀 14 位
(`20260610163019`)字母序排在 `20260610_departments` 之前,但 SQL 引用
`ALTER TABLE "Attachment"` 又依赖后面 `20260611_attachments` 才创建的
Attachment 表,导致 fresh DB 必报 `'relation "Attachment" does not exist'`。

**修复**: 文件夹改名 `20260611_invoice_attachments`(字母序落在
`20260611_attachments` 之后,依赖关系正确)。

**已部署**: 服务端用 `prisma migrate resolve --rolled-back` 标旧名 rolled
back,再重 deploy 应用新名,DB 现在 9 migrations 全部 applied。

### F2. `remove_customer_level` 迁移不幂等 (`bfeecc3`)

`ALTER TABLE "Customer" DROP COLUMN "level"` 和 `DROP INDEX
"Customer_level_idx"` 不带 `IF EXISTS`,在已经用 `db push` 提前删过
`level` 的环境会报 `'index "Customer_level_idx" does not exist'`。

**修复**: 两个语句都加 `IF EXISTS`,迁移即可在 db push 和 migrate deploy
两条路径上幂等。

**已部署**: 服务端标 `--applied`(DB 状态已对),`prisma migrate deploy`
后续 run 报 "9 migrations found, no pending"。

### F3. `seed.ts` 必须跑污染空库 → 新建 `seed-roles.ts` (`ad0ffb2`)

`seed.ts` 511 行,跑一次会塞 4 个 test 账号 + 12 个 demo 客户 + 大量
follow-up。生产空库想建首 admin 时根本不能用,只能手 SQL。

**修复**: 新建 `scripts/shared/seed-roles.ts`,只 upsert 4 个 system roles,
permissions 从 `lib/permissions.ROLE_PERMISSIONS` 拿(与 seed 里的硬编码
同源,单点真理),`pnpm seed-roles` 一行命令。

**用法**: 部署时 `pnpm seed-roles && pnpm create-admin --employeeNo admin --name ... --email ...`

### F4. `backup-prod.sh` pg_dump 13 vs server PG 16 (`46a274b`)

主机自带的 `postgresql` 13 客户端 pg_dump 与服务器 PG 16 不匹配,会
refuse 导出 ("server version: 16.14; pg_dump version: 13.23")。

**修复**: 改用 `docker exec qt-postgres pg_dump -U qitai -d qt_biz ...`
走容器内 PG 16;SUPER_PW 从 MIGRATION_DATABASE_URL 解析后走 PGPASSWORD
环境变量传入。

## 四、密码 / 密钥 (root + ADMIN)

部署完后只有 root 用户能登服务器(密码不变),以及一个 admin 业务账号。
其他密钥(数据库密码、MinIO 密钥、NextAuth secret、APP_ENC_KEY、
CRON_SECRET)都在服务端 `/opt/qt/.env` 里,`chmod 600` 仅 root 可读。
**不要把 `.env` 提交到 git**。

| 项 | 值 / 位置 |
|---|---|
| 服务器 root 密码 | 未变(用户原始) |
| 业务 admin employeeNo | `admin` |
| 业务 admin 初始密码 | **部署消息里单独发**,首登后立刻改 |
| `DATABASE_URL` (qt_app, BYPASSRLS) | `/opt/qt/.env`,32 字符密码 |
| `MIGRATION_DATABASE_URL` (qitai 超级) | `/opt/qt/.env`,32 字符密码 |
| `MINIO_*` | `/opt/qt/.env` |
| `NEXTAUTH_SECRET` | `/opt/qt/.env`,43 字符 base64 |
| `APP_ENC_KEY_HEX` | `/opt/qt/.env`,64 字符 hex |
| `CRON_SECRET` | `/opt/qt/.env`,32 字符 base64 |

## 五、运维手册

### 日常更新部署
```bash
ssh root@116.62.160.24
cd /opt/qt
/opt/qt/scripts/prod/deploy.sh
# (git pull + pnpm install --frozen-lockfile + prisma migrate deploy + pnpm build + systemctl restart qt-app + 3 个 curl 烟测)
```

### 查看日志
```bash
journalctl -u qt-app -f                  # 应用
docker logs -f qt-postgres               # 数据库
docker logs -f qt-minio                  # 对象存储
tail -f /var/log/qt-cron.log             # 定时任务 + 备份
```

### 新建业务用户
```bash
cd /opt/qt
set -a; . ./.env; set +a
CREATE_ADMIN_PASSWORD='<strong>' pnpm create-admin \
  --employeeNo sales01 --name "张三" --email zhangsan@example.com --role SALES
```

### 备份 + 恢复
```bash
# 备份: 每天 03:00 cron 自动跑
/opt/qt/scripts/backup-prod.sh          # 手动跑, dump 到 /opt/qt/backups + MinIO qt-backups 桶

# 恢复
docker exec -i -e PGPASSWORD="$SUPER_PW" qt-postgres \
  pg_restore --clean --if-exists -U qitai -d qt_biz \
  < /opt/qt/backups/qt_biz_YYYYMMDD_HHMMSS.dump
```

### 回滚代码
```bash
cd /opt/qt
git checkout <good-sha>
pnpm install --frozen-lockfile
pnpm build
systemctl restart qt-app
# DB 回滚优先用备份恢复, 不推荐 prisma migrate resolve --rolled-back (复杂)
```

## 六、v0.1.0 安全建议 (deploy 完需要你做的)

1. **改 SSH 密码 + 换 SSH 密钥**: 当前 root 密码在聊天里传过,生产强烈建议
   - `ssh-keygen -t ed25519` 本地生成
   - `ssh-copy-id root@116.62.160.24`
   - 改 `/etc/ssh/sshd_config.d/00-disable-password.conf` 禁密码登录
2. **改 admin 业务密码**: 首登 `http://116.62.160.24/login` 后改密
3. **加 HTTPS**: 域名就绪后用 Caddy + 阿里云 DNS-01 一键签证书
4. **加 Sentry / 错误追踪**: 当前无 error tracking
5. **加 rate limit**: nginx `limit_req_zone` 防爆破
6. **关 host firewalld 兜底**: 装 `firewalld` + 内层规则(目前依赖 Aliyun 安全组)

## 七、当前 6 个 commit 序列(从远端拉下来后)

```
46a274b fix(backup-prod): 用 docker exec 跑容器内 PG 16 pg_dump
ad0ffb2 feat(scripts): 新增 seed-roles CLI,只插 4 个 system roles
bfeecc3 fix(migrations): 修两个部署期发现的迁移 bug
f28459d feat(scripts): 新增生产部署配套脚本
ff6ef4d docs(review): 同步部署前审查,原 3 P0 与 2/4 P1 已修复,可上线
55ed8d2 refactor(services)+fix(dashboard-isolation)+perf(stats): 落盘 v0.1.0 后续硬化
```

`ff6ef4d` 之前是更早的 v0.1.0 收尾;本次部署 4 个新 commit (`f28459d`,
`bfeecc3`, `ad0ffb2`, `46a274b`) 全部因部署期发现而写。

---

# 部署记录 — qt-biz v0.2.0 — Aliyun ECS 杭州 (增量更新)

> **首部署**: 2026-06-12(v0.1.0, `46a274b`)
> **本次更新部署**: 2026-06-14 01:24-01:40 CST(Asia/Shanghai)
> **服务器**: 同 v0.1.0(116.62.160.24,Aliyun Linux 3,2 vCPU / 3.5 GB RAM)
> **HEAD 起点**: `b448e6a` / **HEAD 终点**: `cdcb872`
> **commit 增量**: 6 个(`9d7ce55` → `9a6a157` → `fe1c050` → `98f2a9a` → `7af5edf` → `cdcb872`)
> **服务模式**: 日常更新,无停机迁移(仅一次 systemctl restart 切到新 build)

## 一、本次部署内容

```
cdcb872 chore(deploy): 兼容 14→1 迁移 squash, deploy.sh 自助标记 20260614_init 已应用
7af5edf feat(pdf): 详情页 PDF 导出 — 客户/合同/项目/发票/回款 5 路由
98f2a9a chore(seed+migrations+docs): 合并 14 个迁移为 1, seed 只插系统管理数据
fe1c050 feat(file): 放宽 MIME 白名单 + Office/text/csv 预览 + 任务抽屉统一附件组件
9a6a157 chore: 合批 8 个本地未推送提交
9d7ce55 refactor(workflow): 收敛引擎读路径 — 修 reviewTask 死代码 + 抽共享 view helper
```

**业务影响**:
- 新增 5 个 PDF 导出路由(`/api/{customers,contracts,projects,invoices,payments}/[id]/pdf`),详情页加导出按钮
- 字典/枚举映射重整(`lib/enum-maps.ts` 增 `INVOICE_STATUS_MAP` / `PAYMENT_STATUS_MAP` 等供 PDF 用)
- 14 个旧 Prisma 迁移物理合并为 1 个 `20260614_init`(839 行 SQL)
- 旧 `seed.ts` 移除 4 个测试账号(业务层不 seed,改用 `pnpm create-admin`)
- 工作流引擎读路径收敛(`readAttachments` 从 internal → `export`,供 projects pdf 路由复用)

**对生产数据影响**:**0 行业务数据被改**。Seed 走 lock-if-in-use 护栏,只更新 9 份 workflow 模板的 name/description 元数据,52 个 in-flight task 未受影响。

## 二、踩坑与解决(本次部署期发现)

### G1. 迁移 squash 与 `migrate deploy` 直撞表已存在 (c1 → c2)

服务器 `_prisma_migrations` 表里登记的还是 14 个旧名字(20260609_*/20260610_*/.../20260614_align_workflow_role),且 DB 终态与 squash 后的 SQL 等价;`git pull` 后旧 14 目录被删、新 `20260614_init` 落位,直接跑 `pnpm seed && npx prisma migrate deploy` 时 Prisma 试图 `CREATE TABLE "Role"` 撞 `42P07 relation "Role" already exists`。

**首次 deploy.sh 调用**:`migrate status | grep` 用的 `OLD_NAMES` 没匹配上(`migrate status` 在 broken state 下只报 "1 migration in folder / not in DB",不列旧名),detect 块静默跳过 → deploy 失败,系统仍跑 b448e6a,0 数据损失。

**修复**:
1. 手工 `prisma migrate resolve --applied 20260614_init`(把新名字登记为"已应用",跳过 SQL 执行 — 因为 DB 终态已等价)
2. 重新跑 `migrate deploy` → "No pending migrations to apply"
3. 在 `scripts/prod/deploy.sh` 改用更稳的 detect 方式:用 `docker exec qt-postgres psql` 直接查 `_prisma_migrations` 表,而不是依赖 `migrate status` 输出
4. 该 fix 已 commit 在 `cdcb872`,下次 deploy 自助

### G2. `pnpm build | tail -20` 被 SIGPIPE 杀掉 (c3)

首轮 `pnpm build` 看起来"Compiled successfully in 55s",但下游 `| tail -20` 读满 20 行后退 0,管道关闭,`pnpm build` 收到 SIGPIPE 中断,`.next/BUILD_ID` 没写完就挂了。`next start` 报 "Could not find a production build in the '.next' directory"。

**特征**:Turbopack 编译产物(`.next/server/`、`.next/static/<hash>/`、`turbopack/`)都写出来了,但缺 BUILD_ID 和 `required-server-files.json` — `next start` 不认。

**修复**:`rm -rf .next && pnpm build > /tmp/rebuild.log 2>&1`(用 redirect 到文件,不用 `| tail` 收窄管道)。第二次 BUILD_EXIT=0,`BUILD_ID=kBLVSYl4nuAOwv8_vBC_h_`,重启通过。

**为什么 deploy.sh 没踩这个坑**:`deploy.sh` 里 `pnpm build` 不带任何管道,是 `pnpm build` 直接一行。本次是 ad-hoc 的 `| tee /tmp/rebuild.log | tail -20` 触发。后续若要在 deploy.sh 里加 build log 截取,务必用 `tee` 而不是 `| tail`,且 `set -o pipefail` 已在脚本里默认开。

### G3. systemd 重启循环掩盖 build 失败信号

`deploy.sh` 一开始跑 `systemctl restart qt-app`,而 build 失败后 `next start` 退 1,`RestartSec=5s` 让 systemd 每 5s 重启一次,日志噪音很大,不容易定位 BUILD_ID 缺失。

**根因**:restart 应该在 build 成功之后。`deploy.sh` 顺序已是 `build → seed → restart`,实际位置正确;本次混乱来自 ad-hoc 部署脚本把 restart 提到了 build 之前。**没有动 deploy.sh**。

## 三、烟测通过

```
$ curl -fsS -o /dev/null -w 'login  : %{http_code}\n' http://127.0.0.1:3000/login
login  : 200

$ curl -fsS -o /dev/null -w 'dashboard: %{http_code} (expect 307)\n' http://127.0.0.1:3000/dashboard
dashboard: 307 (expect 307)

$ curl -fsS -o /dev/null -w 'api/customers: %{http_code} (expect 401)\n' http://127.0.0.1:3000/api/customers
api/customers: 401 (expect 401)

$ curl -sS -o /dev/null -w 'no-bearer: %{http_code} (expect 401)\n' -X POST http://127.0.0.1:3000/api/jobs/run-all
no-bearer: 401 (expect 401)

$ curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/jobs/run-all
{"code":0,"data":{"at":"2026-06-13T17:35:27.707Z","results":[
  {"job":"contract-expiring","created":0,"scanned":0,"durationMs":11},
  {"job":"invoice-overdue","created":0,"scanned":5,"durationMs":54},
  {"job":"project-due","created":0,"scanned":0,"durationMs":33},
  {"job":"customer-inactive","created":0,"scanned":11,"durationMs":45},
  {"job":"recurring-tasks","created":0,"scanned":7,"durationMs":40}
],"source":"cron"}}

# 公网 IP(走 nginx :80 反代)
$ curl -sS -o /dev/null -w '%{http_code}\n' http://116.62.160.24/login
200
$ curl -sS -o /dev/null -w '%{http_code}\n' http://116.62.160.24/api/customers
401
```

**PDF 路由已注册**(无 auth 时 401,不是 404):

```
GET /api/customers/{cmqb9v4jk001xj6mvmttgm3gl}/pdf   -> 401
GET /api/contracts/{cmqb9v4qr0036j6mv4o52qiqp}/pdf   -> 401
```

## 四、迁移表终态(清理后)

```
$ docker exec qt-postgres psql -U qitai -d qt_biz -c \
    "SELECT migration_name, finished_at IS NOT NULL AS done FROM _prisma_migrations WHERE migration_name LIKE '20260614%';"
 migration_name | done
----------------+------
 20260614_init  | t
(1 row)
```

**说明**:`resolve --applied` 写入了 1 行 `done=t`,首次失败那次自动写的 `done=f` 行已手工 `DELETE` 清掉,保持迁移表干净。

## 五、最终状态

| 项 | 结果 |
|---|---|
| 服务端 HEAD | `cdcb872` |
| Next.js | 16.2.7 在 127.0.0.1:3000,systemd 托管,`active` |
| PostgreSQL | 16-alpine Docker,9→1 migrations 落地,squash 后 `20260614_init done=t` |
| MinIO | latest Docker,无变化,`Up 36h+ (healthy)` |
| 业务表行数 | 100% 保留,0 改动(12 客户 / 13 合同 / 10 项目 / 10 发票 / 12 回款) |
| 系统管理 seed | 5 角色 / 5 部门 / 61 字典 / 9 工作流模板(lock-if-in-use 保护 52 个 in-flight task) |
| 内存 | 1.3 GB / 3.5 GB(37%) |
| 盘 | 15 GB / 49 GB(31%) |

## 六、未做但建议跟进

- **6 个软删账号硬清**:v0.1.0 部署期 4 个测试账号 + 1 个端到端测试的 `prod_admin`,已 `status=DISABLED` + `deletedAt` 设值。数据保留完整,可导出归档后清。
- **PDF 路由浏览器端真实验证**:curl 烟测确认路由存在(401),详情页 PDF 按钮需要在浏览器点开,确认中文/数字/日期渲染正常。
- **Turbopack build 输出与 `next start` 兼容性**:Next.js 16 默认 `next build` 走 Turbopack。本次成功但属于"刚好兼容",若 Next.js 后续 minor 升级打破,需关注。
- **v0.1.0 章节 6 的安全建议**(改 SSH 密钥、加 HTTPS、加 Sentry、加 rate limit)仍未落实,优先级随业务量走。
