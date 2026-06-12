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

**修复**: 新建 `scripts/seed-roles.ts`,只 upsert 4 个 system roles,
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
/opt/qt/scripts/deploy.sh
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
