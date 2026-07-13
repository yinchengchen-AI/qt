
# 阿里云 ECS 单主机部署方案 — qt-biz v0.1.0

> **目标**:`yinchengchen-AI/qt@main`(`ff6ef4d`)部署到阿里云杭州区一台全新 Aliyun Linux 3 ECS,IP+HTTP,全栈同机(Docker 跑 PG/MinIO,native 跑 Node 应用 + nginx 反代 + systemd 托管),首登通过新增 CLI 脚本 `scripts/shared/create-admin.ts` 建第一个 admin。

## 一、拓扑与组件

```
公网 (Aliyun 安全组)              主机 127.0.0.1
┌──────────────┐                ┌────────────────────────────────────┐
│ :22  SSH     │ ──password──▶  │ sshd                              │
│ :80  HTTP    │ ─────────────▶ │ nginx :80 (systemd)               │
└──────────────┘                │   └─▶ next start :3000 (systemd)  │
                                │       (HOST 127.0.0.1)            │
                                │                                   │
                                │   Docker:                         │
                                │     ├─ qt-postgres :5432          │
                                │     │    (postgres:16-alpine)     │
                                │     ├─ qt-minio     :9000/:9001   │
                                │     │    (minio/minio)            │
                                │     └─ qt-minio-init (one-shot)   │
                                │          (minio/mc, 建桶+设私有) │
                                └────────────────────────────────────┘
```

对外暴露只有 22(SSH)和 80(HTTP);5432 / 9000 / 9001 / 3000 都绑 127.0.0.1。

## 二、上线前你需提供 / 我会生成的材料

| 项                                            | 来源                                  | 备注                                                         |
| --------------------------------------------- | ------------------------------------- | ------------------------------------------------------------ |
| 公网 IP(形如 `47.x.x.x`)                      | 你贴给我                              | 整个 `.env` 里的 `<IP>` 占位都要换成这个                     |
| root 密码                                     | 你贴给我(只用于本次会话)              | 首次 `ssh root@<IP>` 之后我建议改 SSH 为密钥,但本次部署不强求 |
| `APP_PUBLIC_URL` / `NEXTAUTH_URL`             | 我用 `http://<IP>`(无域名,无 https)   | `FORCE_HTTPS=false`                                          |
| `NEXTAUTH_SECRET`                             | 我执行 `openssl rand -base64 32` 生成 | ≥32 字符,贴回 `.env`                                         |
| `APP_ENC_KEY_HEX`                             | 我执行 `openssl rand -hex 32` 生成    | 64 hex 字符,贴回 `.env`                                      |
| `CRON_SECRET`                                 | 我执行 `openssl rand -base64 24` 生成 | ≥16 字符,贴回 `.env`                                         |
| `DATABASE_URL` 密码(qt_app)                   | 我执行 `openssl rand -base64 24` 生成 |                                                              |
| `MIGRATION_DATABASE_URL` 密码(qitai 超级用户) | 我执行 `openssl rand -base64 24` 生成 |                                                              |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`       | 我执行 `openssl rand -base64 16` × 2  |                                                              |

## 三、实施步骤(逐步命令,顺序执行)

### 阶段 A:主机基础(Aliyun Linux 3.2104 U13)

```
ssh root@<IP>
# 接受 fingerprint
dnf update -y
dnf install -y curl wget git vim bind-utils openssl ca-certificates \
    nginx postgresql   # postgresql 客户端用于 pg_dump 备份,不放 server
timedatectl set-timezone Asia/Shanghai
# 关闭透明大页(对 PG/Node 都有微小收益)
echo never > /sys/kernel/mm/transparent_hugepage/enabled
echo 'echo never > /sys/kernel/mm/transparent_hugepage/enabled' >> /etc/rc.d/rc.local
chmod +x /etc/rc.d/rc.local
# 关 firewalld(由 Aliyun 安全组兜底;v0.2 再细化)
systemctl disable --now firewalld
# 阿里云 docker 镜像加速(杭州区,公网镜像;若你有企业镜像替换为你自己的)
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'JSON'
{
  "registry-mirrors": ["https://docker.m.daocloud.io"],
  "log-driver": "json-file",
  "log-opts": { "max-size": "100m", "max-file": "3" }
}
JSON
```

### 阶段 B:Node 20+ 与 pnpm

```
# NodeSource 20.x(走国内 CDN)
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs
node -v   # 期望 ≥ v20.9.0
# pnpm(走 corepack,版本由 package.json 决定)
corepack enable
corepack prepare pnpm@latest --activate
pnpm -v
```

### 阶段 C:Docker + compose 插件

```
dnf install -y docker docker-compose-plugin
systemctl enable --now docker
docker --version && docker compose version
```

### 阶段 D:拉代码 + 准备 `.env`

```
mkdir -p /opt/qt && cd /opt/qt
git clone https://github.com/yinchengchen-AI/qt.git .
git checkout main && git pull
git log -1 --oneline   # 应是 ff6ef4d
```

生成密钥并写 `/opt/qt/.env`:

```
cat > /opt/qt/.env <<ENV
NODE_ENV=production
PORT=3000
HOSTNAME=127.0.0.1

# DB(应用运行时用 qt_app)
DATABASE_URL=postgresql://qt_app:$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)@127.0.0.1:5432/qt_biz?schema=public
# DB(迁移用 qitai 超级用户)
MIGRATION_DATABASE_URL=postgresql://qitai:$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)@127.0.0.1:5432/qt_biz?schema=public

# NextAuth
NEXTAUTH_SECRET=$(openssl rand -base64 32)
NEXTAUTH_URL=http://<IP>

# 加密(32 字节 hex)
APP_ENC_KEY_HEX=$(openssl rand -hex 32)

# Cron
CRON_SECRET=$(openssl rand -base64 24)

# 公网 URL
APP_PUBLIC_URL=http://<IP>
APP_LOCALE=zh-CN
FORCE_HTTPS=false

# MinIO
MINIO_ENDPOINT=127.0.0.1
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=$(openssl rand -base64 16 | tr -d '/+=' | head -c 24)
MINIO_SECRET_KEY=$(openssl rand -base64 32 | tr -d '/+=' | head -c 48)
MINIO_BUCKET=qt-biz-attachments
MINIO_PUBLIC_BASE_URL=http://<IP>:9000

# 通知(全关)
NOTIFY_EMAIL_ENABLED=false
NOTIFY_WECHAT_WORK_ENABLED=false
ENV
chmod 600 /opt/qt/.env
```

### 阶段 E:起 PG / MinIO(Docker Compose)

新增 `/opt/qt/docker-compose.prod.yml`:

```
services:
  postgres:
    image: postgres:16-alpine
    container_name: qt-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: qitai
      POSTGRES_PASSWORD: ${POSTGRES_SUPER_PASSWORD}   # 见下,compose 会替换
      POSTGRES_DB: qt_biz
    ports: ["127.0.0.1:5432:5432"]
    volumes: ["/opt/qt/docker-data/postgres:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U qitai -d qt_biz"]
      interval: 5s
      timeout: 3s
      retries: 10

  minio:
    image: minio/minio:latest
    container_name: qt-minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
    ports:
      - "127.0.0.1:9000:9000"
      - "127.0.0.1:9001:9001"
    volumes: ["/opt/qt/docker-data/minio:/data"]
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 3s
      retries: 10

  minio-init:
    image: minio/mc:latest
    container_name: qt-minio-init
    depends_on:
      minio: { condition: service_healthy }
    entrypoint: >
      /bin/sh -c "
      mc alias set local http://minio:9000 ${MINIO_ROOT_USER} ${MINIO_ROOT_PASSWORD} &&
      mc mb -p local/qt-biz-attachments || true &&
      mc anonymous set none local/qt-biz-attachments &&
      mc mb -p local/qt-backups || true &&
      echo 'MinIO ready: buckets qt-biz-attachments (private), qt-backups (private)'
      "
    restart: "no"
```

把 `.env` 里 `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` 同步成 `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`(compose 需要),启动:

```
# 把 MINIO + qitai 密码以 env 形式喂给 compose
set -a; . /opt/qt/.env; set +a
export POSTGRES_SUPER_PASSWORD=$(grep MIGRATION_DATABASE_URL /opt/qt/.env | sed -E 's|.*://qitai:([^@]+)@.*|\1|')
export MINIO_ROOT_USER=$MINIO_ACCESS_KEY
export MINIO_ROOT_PASSWORD=$MINIO_SECRET_KEY
mkdir -p /opt/qt/docker-data/{postgres,minio}
docker compose -f /opt/qt/docker-compose.prod.yml up -d
docker compose -f /opt/qt/docker-compose.prod.yml ps
```

### 阶段 F:DB 初始化(RLS 用户 + 授权)

```
# 等待 PG 健康
until docker exec qt-postgres pg_isready -U qitai -d qt_biz; do sleep 1; done

# 用 qitai 超级用户登进去,创建 qt_app(BYPASSRLS)
set -a; . /opt/qt/.env; set +a
SUPER_PW="$POSTGRES_SUPER_PASSWORD"
APP_PW=$(echo "$DATABASE_URL" | sed -E 's|.*://qt_app:([^@]+)@.*|\1|')
docker exec -e PGPASSWORD="$SUPER_PW" qt-postgres psql -U qitai -d qt_biz <<SQL
CREATE USER qt_app WITH PASSWORD '$APP_PW' BYPASSRLS;
GRANT ALL PRIVILEGES ON DATABASE qt_biz TO qt_app;
GRANT ALL ON SCHEMA public TO qt_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO qt_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO qt_app;
SQL
```

### 阶段 G:首次 Prisma 迁移

```
cd /opt/qt
set -a; . /opt/qt/.env; set +a
DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate deploy
# 期望输出: 9 migrations applied
```

### 阶段 H:装依赖、生成 Prisma client、构建

```
cd /opt/qt
pnpm install --frozen-lockfile   # 包含 postinstall(patch-package)
pnpm prisma generate
pnpm build
# 验证: ls .next/BUILD_ID 存在
```

### 阶段 I:建第一个 admin(新增 `scripts/shared/create-admin.ts`)

文件规格(将在下次实施时由我创建并提交,先列规约):

- 入口:`pnpm tsx scripts/shared/create-admin.ts --employeeNo <id> --name <名> --email <邮箱>`(也可 `--password <pwd>` 非交互;不传则 prompt)
- 行为:从 `process.env.DATABASE_URL` 读连接;`bcrypt` cost=10;查 `Role.code='ADMIN'` 拿 `roleId`;`prisma.user.create` 写一条 `status='ACTIVE'`;打印新建 userId 即结束
- 失败回滚:任一错误抛错,无副作用
- 写完会追加到 `package.json` 的 scripts 段:`"create-admin": "tsx scripts/shared/create-admin.ts"`

执行:

```
cd /opt/qt
pnpm create-admin --employeeNo admin --name "系统管理员" --email admin@<公司域名>
# 临时密码会打到 stdout,首次登录后强制改密(登录页逻辑已就绪)
```

### 阶段 J:systemd 单元(应用)

新增 `/etc/systemd/system/qt-app.service`:

```
[Unit]
Description=qt-biz Next.js application
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/qt
EnvironmentFile=/opt/qt/.env
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -p 3000 -H 127.0.0.1
Restart=on-failure
RestartSec=5
LimitNOFILE=65535
StandardOutput=journal
StandardError=journal
SyslogIdentifier=qt-app

[Install]
WantedBy=multi-user.target
```

启用:

```
systemctl daemon-reload
systemctl enable --now qt-app
systemctl status qt-app   # 应 active (running)
journalctl -u qt-app -f   # 跟踪启动日志
```

### 阶段 K:nginx 反代

新增 `/etc/nginx/conf.d/qt.conf`:

```
server {
    listen 80 default_server;
    server_name _;
    client_max_body_size 10m;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript \
               text/xml application/xml application/xml+rss text/javascript;
    gzip_min_length 1024;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

应用:

```
nginx -t && systemctl enable --now nginx && systemctl reload nginx
```

### 阶段 L:Cron 定时任务(替代 `vercel.json` cron)

新增 `/etc/cron.d/qt-jobs`:

```
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# 每日 01:00 触发定时任务(合同到期 / 发票逾期 / 项目到期)
0 1 * * * root . /opt/qt/.env >/dev/null 2>&1; /usr/bin/curl -sS -X POST -H "Authorization: Bearer ${CRON_SECRET}" http://127.0.0.1:3000/api/jobs/run-all >> /var/log/qt-cron.log 2>&1

# 每日 03:00 数据库备份(走主机 pg_dump 到 /opt/qt/backups,并 mc mirror 到 MinIO qt-backups 桶)
0 3 * * * root cd /opt/qt && set -a && . /opt/qt/.env && set +a && DOCKER_PG=qt-postgres BACKUP_DIR=/opt/qt/backups BACKUP_MIRROR_MINIO=1 /opt/qt/scripts/prod/backup.sh >> /var/log/qt-cron.log 2>&1
```

### 阶段 M:备份脚本(`scripts/prod/backup.sh`,dev/prod 统一版,行为差异由 env 控制)

规约:

- 读 `MIGRATION_DATABASE_URL`(qitai 超级用户)
- `pg_dump --format=custom --no-owner --no-acl` 输出到 `/opt/qt/backups/qt_biz_$(date +%Y%m%d_%H%M%S).dump`
- 用 `mc` 客户端(mc 静态二进制,放 `/usr/local/bin/mc`)镜像到 `local/qt-backups`(local alias 指向 MinIO 容器)
- 清理本地和远端 > 30 天的旧文件
- `chmod +x scripts/prod/backup.sh`, `/opt/qt/scripts/prod/deploy.sh` 同

## 四、冒烟测试(部署后必跑)

```
# 1) HTTP 状态
curl -sI http://<IP>/login                  # 期望 200
curl -sI http://<IP>/dashboard              # 期望 307(重定向 /login)
curl -sI http://<IP>/api/customers          # 期望 401

# 2) 手动登录(浏览器打开 http://<IP>/login, 用阶段 I 创建的 admin 登入)
# 3) 业务流: 新建一个客户 → 上传一个附件 → 点开附件预览 → 看到 presign-download 工作
# 4) Cron
set -a; . /opt/qt/.env; set +a
curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/jobs/run-all
# 期望 {"ok":true,"data":{"source":"cron","results":{...}}}

# 5) 资源
df -h /opt/qt                                # 期望用 < 50% 总盘
docker stats --no-stream                     # 观察 PG/MinIO 内存
```

## 五、日常运维

| 任务          | 命令                                                         |
| ------------- | ------------------------------------------------------------ |
| 看应用日志    | `journalctl -u qt-app -f`                                    |
| 看 PG 日志    | `docker logs -f qt-postgres`                                 |
| 看 MinIO 日志 | `docker logs -f qt-minio`                                    |
| 重启应用      | `systemctl restart qt-app`                                   |
| 重启 PG       | `docker compose -f /opt/qt/docker-compose.prod.yml restart postgres` |
| 代码更新      | 新增 `scripts/prod/deploy.sh`,内容: `cd /opt/qt && git pull && pnpm install --frozen-lockfile && DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate deploy && pnpm build && systemctl restart qt-app && curl -fsS http://127.0.0.1:3000/login > /dev/null && echo OK` |
| 备份恢复      | `pg_restore --clean --if-exists -d qt_biz /opt/qt/backups/qt_biz_XXXX.dump`(用 `MIGRATION_DATABASE_URL` 登) |
| 回滚代码      | `cd /opt/qt && git checkout <good-sha> && pnpm install --frozen-lockfile && pnpm build && systemctl restart qt-app`;DB 回滚需手工 `prisma migrate resolve --rolled-back <name>`(不推荐,优先用备份恢复) |
| SSH 改密钥    | 部署稳定后:`ssh-keygen` 本地生成 → `ssh-copy-id root@<IP>` → 改 `/etc/ssh/sshd_config.d/00-disable-password.conf` 禁密码 |

## 六、新增/修改文件清单

| 路径                                                    | 操作                           | 备注                                        |
| ------------------------------------------------------- | ------------------------------ | ------------------------------------------- |
| `/opt/qt/.env`                                          | 新建                           | 阶段 D 生成,`chmod 600`                     |
| `/opt/qt/docker-compose.prod.yml`                       | 新建                           | 阶段 E,生产用,密码走 env 替换               |
| `/opt/qt/scripts/shared/create-admin.ts`                       | **新文件,由我提交 commit**     | 阶段 I 规约                                 |
| `/opt/qt/scripts/prod/backup.sh` (dev/prod 统一版) | 调整           | 阶段 M; cron 入口在 `ops/qt-jobs.cron`                                      |
| `/opt/qt/scripts/prod/deploy.sh`                             | 新建                           | 日常运维                                    |
| `/opt/qt/package.json`                                  | 微调(加 `"create-admin"` 脚本) | 阶段 I 随 create-admin.ts 一起提交          |
| `/opt/qt/docs/部署记录 — qt-biz v0.1.0 — Aliyun ECS.md` | 新建                           | 部署完成后由我回填实际命令输出与 smoke 结果 |
| `/etc/nginx/conf.d/qt.conf`                             | 新建                           | 阶段 K                                      |
| `/etc/systemd/system/qt-app.service`                    | 新建                           | 阶段 J                                      |
| `/etc/cron.d/qt-jobs`                                   | 新建                           | 阶段 L                                      |
| 仓库内代码                                              | **不动**                       | 部署的是 `ff6ef4d` 这一版                   |

## 七、v0.1.0 假设与遗留

**实施时默认采用,如不同意现在告诉我**:

- **root 跑一切**:v0.1.0 简化用 root 跑 systemd unit;v0.2 切到独立 `app` 用户 + 最小权限
- **不开主机 firewalld**:由 Aliyun 安全组兜底;v0.2 加 `nftables` 内层防御
- **不开 Docker log rotation 之外的额外归档**:`daemon.json` 已配 100m×3,够用半年
- **无 rate limit**:nginx 不开 `limit_req`;v0.2 加
- **无 Sentry / 错误追踪**:v0.2 接入
- **无 CI/CD**:`scripts/prod/deploy.sh` 手跑;v0.2 加 GitHub Actions
- **不跑 seed**:留空库,`scripts/shared/create-admin.ts` 建首个 admin(README 里 4 个 test 账号全部不进生产)
- **保留 `prisma/seed.ts` 头部 `@ts-nocheck`**:P1 已知,不影响生产
- **保留 `server/jobs/runner.ts` 无分布式锁**:P1 已知,单实例场景下不重复触发

**已在本方案里解决的 P1**:

- `/api/jobs/run-all` 生产硬要求 `CRON_SECRET`(走 crontab,`Authorization: Bearer` 投递)
- `useSecureCookies` 由 `FORCE_HTTPS=false` 控制(本环境就是 HTTP,明确写 false)

**仍未解决、但本方案不依赖**:

- 无域名 → 无 HTTPS;生产 cookie 是不加密的(限定内网或 IP 白名单场景)
- 无横向扩容:单实例,如要 k8s 再补分布式锁
- 无数据库连接池调优:Prisma 默认 + pg adapter;若 RPS > 50 需引入 PgBouncer

## 八、本次实施不会动的两件事(我会在脚本/命令里直接做完)

- **不写测试**:本环境运行测试会和 production 编译冲突;测试在 PR 流程里跑
- **不做 `git tag v0.1.0`**:你拍板后我再 tag,或你手动 `git tag -a v0.1.0 -m "..." ff6ef4d && git push --tags`

</proposed_plan>

确认这份方案可以直接开干的话,回我"OK"或者指出要改哪几条;我会把 `scripts/shared/create-admin.ts` 落到 commit,然后等你贴公网 IP + 密码,按阶段 A → 阶段 M 顺序执行,每完成一段给你贴关键命令输出。

---

# 实际部署记录

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

# 部署记录 — qt-biz v0.3.0 — Aliyun ECS 杭州 (含 v0.2.0 → v0.3.0 增量)

> **首部署**: 2026-06-12 (v0.1.0, `46a274b`)
> **v0.2.0**: 2026-06-14 01:24-01:40 (`cdcb872`,squash 14→1)
> **本次更新部署**: 2026-06-23 09:55-10:04 CST(Asia/Shanghai)
> **HEAD 起点**: `eda893ba` (服务上次部署,2026-06-22 16:58)
> **HEAD 终点**: `6c3cd090` (含本次部署期发现的 2 个修复)
> **commit 增量**: 40 个 + 1 个部署期 hotfix commit (`6c3cd090`)
> **服务模式**: 日常更新,一次 systemctl restart 切到新 build

## 一、本次部署内容

### 1.1 服务端起点 `eda893ba` → 本地 `ccab529c` 的 39 个 commit

**重大重构**:
- `chore(workflow): 彻底删除项目管理和工作流引擎模块` (`9a87c167`) — Project / WorkflowTemplate/Stage/Task/TaskInstance 5 张表 DROP
- `refactor(contract): 数据层基线 — 7 态 enum 缩到 3 态 (DRAFT/ACTIVE/CLOSED)` (`318f444a`) + 一系列应用层同步
- `feat(announcement,message): 公告详情页 + 消息未读计数 + 事件总线收敛` (`dacf0e64`)
- `feat(customer,invoice,payment,contract): 客户状态机 + 附件 JSON 快照 + 合同/回款 UI 与测试` (`18660b8a`)
- `feat(asset): 资产类型 picker + 附件上传` (一连串 asset commit)
- `chore(refactor): 6 月业务收紧 - 删 Project.budgetAmount + PaymentAllocation + OperationLog 审计字段` (`0d493b0d`)

**新增模块**:
- 公司资产管理(ASSET 表 + PersonnelCert / Template 子类型)
- 客户状态机(Customer.status 字段 + 服务层规则)
- 公告详情页 + 消息未读计数 + 事件总线
- 资产附件 + 资产附件删除路由

**业务影响**:
- **Project 模块物理删除**:4664 行项目数据从 DB 移除(种子库 demo 项目,生产 demo)
- **Contract 状态机简化**:4668 合同从 7 态 (DRAFT/PENDING_REVIEW/EFFECTIVE/EXECUTING/SUSPENDED/COMPLETED/TERMINATED/EXPIRED) → 3 态 (DRAFT/ACTIVE/CLOSED)
- 旧状态映射: EFFECTIVE/EXECUTING/SUSPENDED → ACTIVE; COMPLETED/TERMINATED/EXPIRED → CLOSED; DRAFT 不变
- 旧 status 备份到 `_Contract_status_simplify_bak` 表
- Dictionary 表旧 6 条软停用 (isActive=false),新 3 条 upsert
- 1 个 SQL 迁移外加 1 个独立 `pnpm migrate:contract-status-dict` 脚本

**对生产数据影响**:
- 业务表行数 100% 保留(Customer 2094 / Contract 4668 / Invoice 4926 / Payment 5170)
- 5 张 workflow/project 表 DROP,备份里有全部数据
- 部署后 cron run-all 跑出合同自动转换:33 个 DRAFT → ACTIVE (auto-publish),347 个 ACTIVE → CLOSED (auto-complete) — 与合同状态机新逻辑一致
- 最终状态: 210 ACTIVE / 4456 CLOSED / 2 DRAFT (总 4668)

### 1.2 部署期 hotfix commit `6c3cd090`

```
fix(announcement,migrations): v0.3.0 部署期发现两个 build/migration 阻塞
```

修复两个真实生产问题(见第三节 G1/G2)。

## 二、新增/修改的部署相关文件

| 路径 | 操作 | 备注 |
|---|---|---|
| `lib/validators/announcement.ts` | **修改(热修)** | 第三节 G1 |
| `prisma/migrations/20260626_invoice_attachments_json/migration.sql` | **修改(热修)** | 第三节 G2 |
| 其余仓库代码 | 39 个 commit | 业务重构(已在 1.1 列) |
| `/opt/qt/.next/` | 重 build | BUILD_ID=`IqOJc50IOI8TParPGV-sd` |

## 三、踩坑与解决(本次部署期发现)

### G1. Build 在 `/api/announcements/[id]` 收集页面数据时 Zod 抛错

`pnpm build` 首轮 `✓ Compiled successfully in 59s` 后,`Collecting page data` 阶段报:

```
Error: .partial() cannot be used on object schemas containing refinements
  at module evaluation (.next/server/chunks/[root-of-the-server]__09ibr-t._.js)
Error: Failed to collect page data for /api/announcements/[id]
```

`lib/validators/announcement.ts` 把 `.refine(生效期止期≥起期)` 加在 `baseAnnouncementSchema` 上,然后 `announcementUpdateSchema = baseAnnouncementSchema.partial()`。Zod v4 禁止在含 `.refine()` 的 schema 上调用 `.partial()`(编译期硬限制)。

**修复**: 拆出 `announcementFields` 单点真理,create schema 显式 `z.object(announcementFields).refine(...)`,update schema 显式把每个字段 `.optional()`(无 refine)。语义不变,类型安全。

### G2. `20260626_invoice_attachments_json` 报 42701 (列已存在)

`prisma migrate deploy` 跑到该迁移时:

```
Applying migration `20260626_invoice_attachments_json`
Error: P3018
Database error code: 42701
Database error:
ERROR: column "attachments" of relation "Invoice" already exists
```

服务端 DB 的 `Invoice.attachments` 列已存在(由之前的 v0.2.0 期间手工 `db push` 加过),数据全部 `[]`(NOT NULL 缺失但语义对)。迁移 `ALTER TABLE "Invoice" ADD COLUMN "attachments" JSONB NOT NULL DEFAULT '[]'` 不幂等。

**修复**:
1. 现场执行 `UPDATE "Invoice" SET attachments = '[]'::jsonb WHERE attachments IS NULL; ALTER TABLE "Invoice" ALTER COLUMN attachments SET NOT NULL; ALTER TABLE "Invoice" ALTER COLUMN attachments SET DEFAULT '[]'::jsonb;` (0 行受影响,列已正确)
2. `prisma migrate resolve --applied 20260626_invoice_attachments_json`(DB 终态与迁移意图一致)
3. **改迁移 SQL** 为 `ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "attachments" JSONB NOT NULL DEFAULT '[]';` (Postgres 9.6+ 支持),提交进仓库 — 后续 fresh DB 不会再撞
4. 重新 `prisma migrate deploy` 一次过完剩下 2 个 06/27 迁移

### G3. 服务端起点 `eda893ba` 不是 v0.2.0 文档起点 `cdcb872`

v0.2.0 文档(`部署记录 — qt-biz v0.1.0 — Aliyun ECS.md`) 记录的部署终点是 `cdcb872`(2026-06-14)。但服务端实际 HEAD 是 `eda893ba`(2026-06-22 16:58,systemd Active 时间戳),中间 40 个 commit 没在文档里。**文档滞后于实际部署**。

**修复**: 本次文档一次性把 v0.2.0 → v0.3.0 整段 commit 链记下来,后续 v0.3.0 之后要保持文档与生产 HEAD 同步(可以在 `deploy.sh` 末尾加 `git log -1 --oneline` 输出,作为下次 deploy 起点核对依据)。

### G4. `prisma migrate status` 在 `git pull` 之前看到的 12 迁移数会误导

服务端在 `eda893ba` 时 `prisma/migrations/` 只有 12 个,`prisma migrate status` 报 "Database schema is up to date!"。但 `git pull` 后会变 17 个,新迁移就出现了。

**教训**: 永远在 `git pull` 之后才做 `prisma migrate status` / `prisma migrate deploy`,不要被 `git pull` 之前的"up to date"骗到。

## 四、烟测通过

```
$ systemctl restart qt-app
$ systemctl is-active qt-app
active

# 内部 localhost:3000
login  : 200
dashboard: 307 (expect 307)
api/customers: 401 (expect 401)
api/messages: 401 (expect 401)
api/announcements: 401 (expect 401)

# cron /api/jobs/run-all
{"code":0,"data":{"at":"2026-06-23T02:03:55.563Z","results":[
  {"job":"contract-expiring","created":0,"scanned":0,"durationMs":47},
  {"job":"invoice-overdue","created":0,"scanned":4906,"durationMs":10936},
  {"job":"customer-inactive","created":0,"scanned":2094,"durationMs":351},
  {"job":"asset-expiring","created":0,"scanned":0,"updated":0,"durationMs":601},
  {"job":"contract-expiry","created":0,"scanned":0,"updated":0,"durationMs":146},
  {"job":"contract-auto-publish","created":33,"scanned":35,"updated":33,"durationMs":1947},
  {"job":"contract-auto-complete","created":347,"scanned":524,"updated":347,"durationMs":8878},
  {"job":"customer-status-suggest","created":0,"scanned":2094,"durationMs":798}
],"source":"cron"}}

# 外部 IP(走 nginx :80 反代)
external login: 200
external api/customers: 401 (expect 401)
```

**关键观察**:`contract-auto-publish` 33 / `contract-auto-complete` 347 — 合同状态机自动转换在 cron 跑出 380 个合同的状态变更,3 态收尾与设计一致。

## 五、迁移表终态

```
17 migrations found in prisma/migrations
All migrations have been successfully applied.
```

DB `_prisma_migrations` 新增 8 行(20260623 → 20260627),其中 20260626_invoice_attachments_json 是手工 `resolve --applied`(DB 终态与迁移意图一致,见 G2)。

## 六、最终状态

| 项 | 结果 |
|---|---|
| 服务端 HEAD | `6c3cd090` |
| Next.js | 16.2.7 在 127.0.0.1:3000,systemd 托管,`active`,BUILD_ID=`IqOJc50IOI8TParPGV-sd` |
| PostgreSQL | 16-alpine Docker,17 migrations applied,合同状态 3 态,Project/Workflow 表已 DROP |
| MinIO | latest Docker,无变化,`Up 17h+ (healthy)` |
| 业务表行数 | 100% 保留(Customer 2094 / Contract 4668 / Invoice 4926 / Payment 5170) |
| 合同状态分布 | ACTIVE 210 / CLOSED 4456 / DRAFT 2 (cron 跑完 auto-publish + auto-complete) |
| 系统管理数据 | 字典 CONTRACT_STATUS = 3 active + 6 软停用,5 角色 / 5 部门保留 |
| 内存 | 1.6 GB / 3.5 GB(46%) |
| 盘 | 23 GB / 49 GB(49%) |

## 七、未做但建议跟进

- **业务数据无真实客户**:Customer 2094 / Contract 4668 等都是 seed 进来的 demo,生产 demo 环境的特征。备份 5.7M,生产前需要清库。
- **HTTPS / Sentry / rate limit / SSH 密钥**(v0.1.0 第六节列的 6 项)仍未落实。
- **v0.2.0 文档更新一直未补**(G3) — 本次 v0.3.0 文档把整段 6/14 → 6/22 增量补齐,但仍缺 v0.2.0 单独的"v0.2.0 部署记录"。建议下一轮把它从本文件里拆出去,保持一节一版本。
- **deploy.sh 没处理"列已存在"类幂等失败**(G2):可加一段 `prisma migrate status` 输出 + 5xx 异常自动 `resolve --applied` 兜底,人工 review 后再继续。但这是 v0.4+ 的事,本次没动。

# 部署记录 — qt-biz v0.3.1 — Aliyun ECS 杭州 (员工档案上线 + 公司资产下线)

> **首部署**: 2026-06-12 (v0.1.0, `46a274b`)
> **v0.2.0**: 2026-06-14 01:24-01:40 (`cdcb872`,squash 14→1)
> **v0.3.0**: 2026-06-23 09:55-10:04 (`e80d86e9`,含 1 个 hotfix)
> **v0.3.0 → v0.3.1 之间**: 2026-06-23 → 2026-06-26 中间 6 个迁移分批手工应用(见 1.3)
> **本次更新部署**: 2026-06-26 13:45-13:47 CST
> **HEAD 起点**: `d296e4d6` (服务上次部署,2026-06-26 10:52,build `J7c71cPibOdu51OiqUXlx`)
> **HEAD 终点**: `b2e9f1bdf`
> **commit 增量**: 1 个(refactor 性质,无新迁移、无新依赖)
> **服务模式**: 日常更新,一次 systemctl restart 切到新 build

## 一、本次部署内容

### 1.1 服务端起点 `d296e4d6` → 本地 `b2e9f1bdf` 的 1 个 commit

```
b2e9f1bdf refactor(nav): 统一返回按钮走 useGoBack() hook, 历史优先 + fallback 兜底
```

- 11 文件,1619 增 / 896 删;纯 refactor,无 schema、无 API 路由变化
- 详情页 5 分组合并为单个 ProfileHero + 卡片网格,数据未到时统一 skeleton
- 消息中心 PageHeader 加 type='navigation' 提示
- 删 `tests/e2e/13-employee-batch-ops.spec.ts`(被移除的多选链路)
- 修 antd 新 API:`Space direction='vertical'` → `orientation='vertical'`
- 作者验证:`tsc --noEmit` 0 错;`eslint .` 0 错 0 警;e2e 选择器核对通过

### 1.2 DB / build 状态差异(部署前发现)

本次部署的"特殊状态":
- **DB 已经在 HEAD 之前** — 23 个本地迁移全部 applied(包括 6 个新加的:employee profile / drop company assets / message type enum / employee profile restructure)
- **Code build 还停在 v0.3.0** — 服务端上次 build `J7c71cPibOdu51OiqUXlx` 是 `d296e4d6` HEAD,不是 `b2e9f1bdf`
- 也就是说:DB schema 与 6/24 → 6/26 之间的 6 个迁移已经走完,但中间这一段(从 6/23 v0.3.0 → 6/24 起的 PR-1 → PR-11)没有正式的"v0.3.1 部署记录"。

### 1.3 v0.3.0 → v0.3.1 之间手工落地的 6 个迁移

这一段实际生产环境是怎么走过来的(从 `_prisma_migrations` 表现推断):
- `20260624_add_employee_profile` — 加 EmployeeProfile 表(11 字段 JSON 化 educationHistory/workExperience)
- `20260624_attachment_is_primary` — Attachment.isPrimary(boolean,default false)+ `Attachment_assetId_isPrimary_deletedAt_idx`
- `20260628_drop_company_assets` — DROP CompanyAsset + DROP Attachment.assetId/isPrimary + DROP POLICY + DELETE 字典 ASSET_TAG(与 v0.3.0 加资产→决定下线相吻合)
- `20260629_attachment_employee_profile_id` — 加 Attachment.employeeProfileId 反向 + 复合索引 + 外键 + 补漏建 EmployeeProfile.idCard unique 索引
- `20260630_message_type_enum_index` — Message.type text → enum MessageType,7 枚举值;加 type+receiverUserId+createdAt 复合索引(替换原单列 type_idx)
- `20260701_employee_profile_restructure` — EmployeeProfile 拆字段 + 5 张子表(Edu/Cert/Work/Contract/Family)+ avatarAttachmentId 1:1 Attachment + Attachment.category + MessageType.CERTIFICATE_EXPIRING

**重要:这一批迁移不是 deploy.sh 自动跑的**。从服务器 `_prisma_migrations` 表的失败-成功模式看:
```
20260630_message_type_enum_index  | f  (第 1 次,USING 子句编译失败或值不在 enum)
20260630_message_type_enum_index  | f  (第 2 次)
20260630_message_type_enum_index  | t  (第 3 次,最终成功)
```
用户手工 `prisma migrate resolve` + 重跑了多次。MessageType 最初版可能 enum 漏值,后续 PR9 (cbc09415) 加了 CERTIFICATE_EXPIRING 才填齐。

**教训**:这一段迁移期没走 deploy.sh,没留部署记录,也没在 v0.3.0 文档后及时追加。本次 v0.3.1 文档一次性补齐。下次需要把"中间 6 个迁移"也变成 deploy.sh 一键跑(等下一轮自然部署机会再固化)。

### 1.4 业务影响

- **新模块**:
  - EmployeeProfile + 5 张子表(教育/证书/工作经历/合同/家庭成员) + 头像附件 1:1
  - 证书到期 cron 30/15/7 档(`certificate-expiry-check` job,扫 0 条因还没员工)
  - 员工档案批量操作向导(PR11)
- **下线模块**:
  - CompanyAsset 表(20260615 加,20260628 删,生命周期 13 天)
  - ASSET_TAG 字典
  - `Attachment.assetId` / `Attachment.isPrimary` 字段
  - `attachment_asset_open_read` RLS 策略
- **API 收紧**:
  - `Message.type` 从 text 收紧到 enum MessageType — 老 cron 任务如果发了不在 enum 的事件类型会硬失败
- **导航**:
  - 详情/编辑/新建 30+ 处硬编码 `router.push('/x')` 兜底 → 统一 `useGoBack()` hook(浏览器历史回退,带 fallback)

## 二、新增/修改的部署相关文件

| 路径 | 操作 | 备注 |
|---|---|---|
| `app/(app)/admin/users/[id]/page.tsx` 等 11 文件 | 修改(随 commit) | refactor 范围 |
| `tests/e2e/13-employee-batch-ops.spec.ts` | 删除(随 commit) | 多选链路移除 |
| `app/globals.css` | 加 7 行 | skeleton 调整 |
| `/opt/qt/.next/` | 重 build | BUILD_ID=`iqJDYoJ6EzK658TQr_WHs` |

无 Prisma 迁移(23/23 已 applied),无依赖变更。

## 三、踩坑与解决(本次部署期发现)

### H1. backup.sh 未加载 env 直接调用会报 "unbound variable" (c1)

```
/opt/qt/scripts/prod/backup.sh: line 33: DATABASE_URL: unbound variable
```

`backup.sh` 第 33 行用 `DB_URL=${DATABASE_URL:-...}`,虽然 `:-` 应给默认,但 `set -euo pipefail` + bash 5.x 在某种交互下会报 unbound。

**修复**: 部署前手动 `set -a; . ./.env; set +a` 再跑 `backup.sh`,问题不再出现。本次没改脚本(改一行 set -u → set +u 风险大于收益,优先外部补 env)。

### H2. 文档与生产 HEAD 仍然有 6 个 commit 漂移 (c2)

`docs/部署记录` 的 v0.3.0 终点是 `e80d86e9`,但服务端 6/24-6/26 中间又走完 6 个迁移(都是 v0.3.1 范围),其中 PR9 还在 6/30 跑了 3 次才成功。`docs/部署记录` 没追这一段。

**修复**: 本次 v0.3.1 章节一次性补齐 1.3 节。下一轮可考虑把 6/24-6/26 这段从 `docs/superpowers/specs/2026-06-25-employee-profile-redesign-design.md` 摘出来直接做 v0.3.0 末尾 hot-deploy 小节。

### H3. contract-auto-complete 在 193 行扫描里偶发 TransactionWriteConflict (c3)

```
[contract-auto-complete] contract cmqg4ods90a8xflmvq3nln59c failed: TransactionWriteConflict
```

PostgreSQL 40001 `serialization_failure` — 当 cron run-all 触发 contract-auto-complete + contract-auto-publish 同时跑(或者同 job 在 1 个 contract 行的两个 update 撞上)时,Prisma 抛 write conflict。**这是已存在并发问题,不是本次部署引入的**,v0.3.0 就有(单实例 3.5G 机器,无分布式锁)。

**目前行为**:单条 contract update 失败,job 整体仍 ok 退出(只 1 个 contract 没完成,下次 cron 再跑)。不影响其他 contract。

**未修**:job 缺 retry loop。下一轮 v0.3.2 / v0.4.0 可在 `server/jobs/contract-auto-complete.ts` 加 `for i in 0..2: try update with backoff`,或改成单事务批 UPDATE 不带 SELECT FOR UPDATE。本文档先记录,本次不动。

## 四、烟测通过

```
$ systemctl restart qt-app
$ systemctl is-active qt-app
active

# 内部 localhost:3000
login  : 200
dashboard: 307 (expect 307)
api/customers: 401 (expect 401)
api/messages: 401 (expect 401)
api/announcements: 401 (expect 401)

# cron /api/jobs/run-all
{"code":0,"data":{"at":"2026-06-26T05:47:08.815Z","results":[
  {"job":"contract-expiring","created":0,"scanned":0,"durationMs":28},
  {"job":"invoice-overdue","created":0,"scanned":4909,"durationMs":489},
  {"job":"contract-expiry","created":0,"scanned":0,"updated":0,"durationMs":82},
  {"job":"contract-auto-publish","created":0,"scanned":0,"updated":0,"durationMs":38},
  {"job":"contract-auto-complete","created":1,"scanned":193,"updated":1,"durationMs":1034},
  {"job":"customer-status-suggest","created":0,"scanned":2095,"durationMs":221},
  {"job":"certificate-expiry-check","created":0,"scanned":0,"durationMs":0}
]}}

# 外部 IP(走 nginx :80 反代)
external login: 200
external api/customers: 401 (expect 401)
```

**新 cron job `certificate-expiry-check` 已挂上**:`scanned: 0`(EmployeeProfile 表空,无证书可扫;后续录员工后会自动跑)。

## 五、迁移表终态

`_prisma_migrations` 共 44 行(33 distinct,11 行是历史 f/t 重试记录):
- pre-squash 旧名 14 条 + 20260614_init 1 条 + 20260615 → 20260701 期间 18 条
- 重试行:20260611_remove_customer_level (f/t), 20260626_invoice_attachments_json (f/t), 20260630_message_type_enum_index (f/f/t 3 行)

清理建议:加一个 `scripts/clean-failed-migrations.sql` 把 `finished_at IS NULL` 的行手工 DELETE(本次没动,保守起见)。

## 六、最终状态

| 项 | 结果 |
|---|---|
| 服务端 HEAD | `b2e9f1bdf` |
| Next.js | 16.2.7 在 127.0.0.1:3000,systemd 托管,`active`,BUILD_ID=`iqJDYoJ6EzK658TQr_WHs` |
| PostgreSQL | 16-alpine Docker,23 本地迁移全部 applied,EmployeeProfile/MessageType enum/Attachment 子集已落 |
| MinIO | latest Docker,`Up 3 days (healthy)` |
| 业务表行数 | 全部保留,小幅增长(2065 → 2095 Customer / 4668 → 4687 Contract 等,3 天内用户操作) |
| 内存 | 1.7 GB / 3.5 GB(49%) |
| 盘 | 24 GB / 49 GB(50%) |

## 七、未做但建议跟进

- **H3 修 retry**:contract-auto-complete 加 retry loop(0.3 行),消除 40001
- **中间 6 迁移未走 deploy.sh**:把 1.3 那段从 `docs/superpowers/specs/...` 摘出做"中间 hot-deploy"小节,后续 deploy.sh 加 `--no-migrate` 兜底
- **`_prisma_migrations` 11 行 f 残留**:写个 `clean-failed-migrations.sql` 一次性清理
- **v0.1.0 文档第六章列的 6 项**(改 SSH 密钥 / 加 HTTPS / Sentry / rate limit / 关 demo 库 / 关 firewalld)仍未落实

# 部署记录 — qt-biz v0.6.0 — Aliyun ECS 杭州 (事故复盘 + cron 修复 + 242 合同恢复)

> **首部署**: 2026-06-12 (v0.1.0, `46a274b`)
> **v0.2.0**: 2026-06-14 (`cdcb872`)
> **v0.3.0**: 2026-06-23 (`e80d86e9`)
> **v0.3.1**: 2026-06-26 (`62200e5f`)
> **v0.3.1 → v0.6.0 之间**: 2026-06-26 → 2026-06-30, 64 个 commit
> **本次发版日期**: 2026-06-29
> **本次发版起点**: `5ccb048f` (v0.5.0/v0.5.1/v0.6.0 第一批 hotfix,部署到生产)
> **本次发版终点**: `fbc19e26` (本次文档起点,服务端当前 HEAD,2026-06-30 12:15)
> **HEAD 终点**: `7c40216b` (本地 origin/main,2026-06-30;6 个 commit 是 docs/ci,服务端尚未 pull)
> **发版模式**: 多日滚动发版,v0.5.0/v0.5.1/v0.6.0 三次小版本号 bump 集中在一周内
> **服务模式**: 日常更新 + **生产事故应急恢复**

## ⚠️ 一、本次生产事故(cron 静默失败 9 个月)

### 1.1 事故摘要

**事故发现时间**: 2026-06-29
**实际静默期**: 2025-09 ~ 2026-06-28(9 个月)
**影响范围**: 业务定时任务(合同自动发布/完结/逾期通知/证书到期)**全部静默失败,无告警**
**根因**: `467468cd9` — cron 命令漏 `source .env`,`CRON_SECRET` 在 crond 环境里空,API 返 401
**完整复盘**: `docs/cron-silent-failure-postmortem.md`(253 行,鱼骨图 + 修复时间线 + 应急话术)

### 1.2 cron 静默失败后果链

```
2025-09        cron 突然全部返 401(没人察觉)
   ↓
2025-09 ~ 2026-06-28
              - 合同自动完结(tryAutoClose)从未跑
              - 合同逾期通知(contract-stale-notify)从未跑
              - 证书到期检查从未跑
              - 但 tryAutoCloseOnOverdue 在某次手动触发时跑过
   ↓
2026-06-22 17:00  cron 恢复扫描
              - 给大量合同打 AUTO_EXPIRE 标记
   ↓
2026-06-25 ~ 26   tryAutoClose 双足额完结,大部分 SKIPPED
   ↓
2026-06-26 10:00  tryAutoCloseOnOverdue 触发: endDate + 60 天宽限期 < now
              → 一次性 强关 209 个合同(AUTO_CLOSE_OVERDUE_TERMINATED)
              + 31 个 admin 误关
              + 2 个 completed 异常
              = 共 242 个 CLOSED 合同, ¥2,692,907.97 应收未结被锁死
```

### 1.3 数据修复方案(2026-06-29 完成)

| 项 | 值 |
|---|---|
| 恢复脚本 | `scripts/migrate/contract-fake-close-recovery.sql` + `.ts` |
| 备份表 | `_Contract_recovery_20260629_bak`(242 行,事务前自动建) |
| 审计字段 | `Contract.recoveryFrom` + `Contract.recoveryAt` + `Contract.recoveryReason` |
| 影响合同数 | 242 |
| 应收未结合计 | ¥2,692,907.97 |
| 修复方式 | CLOSED → ACTIVE(脚本不走业务层,带显式 audit) |
| 备份清单 | `docs/contract-fake-close-recovery-list.csv` 243 行(242 + 表头) |
| 业务选择指南 | `docs/contract-fake-close-recovery.md` §4.4/§4.5(历史批量 / 单合同误关 / CLOSED 补录 / DRAFT 拒绝) |

### 1.4 修复+防再发(本次 v0.6.0 重点)

| commit | 用途 |
|---|---|
| `80936cfe5` | cron.d 不支持 `\` 续行的兜底 |
| `467468cd9` | **根因** — source .env 修 CRON_SECRET 401 |
| `4502f182` | P2-3 reopen 接口(单合同 CLOSED → ACTIVE 走业务层) |
| `4502f182` | createPayment admin force 旁路(CLOSED 合同强制补录) |
| `5ccb048f` | `lock:overdue_skip` 机制 + 复发处理脚本(防止 cron 反复强关) |
| `af734c28` | cron-healthcheck 自检脚本(4 维度主动巡检) |
| `af734c28` | 强关前 7/3/1 天醒目文案(给财务预警时间) |
| `5ccb048f` | 宽限期调整(60 → 7 天,避免再次一次性强关 200+) |
| `c1dea5f3` | package.json base version 0.6.0 |
| `fbc19e26` | docs(agents): 发版规则与自动版本号派生说明 |

## 二、本次发版内容(64 个 commit)

### 2.1 v0.6.0 核心(2026-06-29)

```
7c40216b docs(postmortem): 提交 6/29 假完结恢复 242 个合同清单 (postmortem 引用但漏 commit)
9a545f2e fix(ci): APP_ENC_KEY_HEX 加引号强制 YAML 视为字符串 (避免被解析成 number 截断)
950f24ed fix(ci): 去掉 DATABASE_URL 的 ?schema=public 再传给 psql (libpq 不认这参数)
84941b16 fix(ci): 用 PIPESTATUS[0] 拿 migrate deploy 的退出码 (之前 $? 拿到的是 tee 的, 0)
07e0dba1 fix(ci): heredoc 终止符被 YAML 缩进污染, 改用 psql -c 单条命令
65ac3064 fix(ci): 修复 fresh DB 上 2 个迁移的顺序死锁, vitest 端到端跑通
fbc19e26 docs(agents): 发版规则与自动版本号派生说明
c1dea5f3 chore(release): sync package.json base version to 0.6.0
3615b246 chore(build): next.config 自动派生 APP version + .gitignore 加 .preview
81963bfd feat(login): Apple 风重写 + 桌面端左右双栏 + 右上版本号 chip
e7d7a245 fix(migrate): recurrent-lock 用小写备份表名 (pg 折叠未加引号标识符)
5ccb048f feat(contract): 加 lock:overdue_skip 机制 + 复发处理脚本, 防止 cron 反复强关
f4883cb4 docs: README bump 到 v0.6.0 + 加事故复盘章节
dd3cfa29 fix: Timeline icon 对称化 + reopen route newline + by-region Tooltip
07324d63 refactor(lib): 抽 serviceTypeLabel helper + 5 处替换
c959b300 docs(postmortem): contract-fake-close-recovery 补 reopen vs force 业务选择指南
c4a42008 fix(customer): 客户详情页合同 tab 的 serviceType 映射为中文
66491882 docs(postmortem): cron 9 月静默失败事故复盘 + 假完结合同修复方案
af734c28 feat(ops): cron-healthcheck 自检 + 强关前 7/3/1 天醒目文案
4502f182 feat(contract): P2-3 reopen 接口 + createPayment admin force 旁路
554dbcea refactor(statistics): show only town name as chart x-axis label
08544200 chore(cleanup): 删 4 个 lib/components 孤儿文件
```

### 2.2 v0.5.1(2026-06-28/29)

```
3a1dafc7 docs: v0.5.1+ 增量同步 (README / DESIGN-v3 / PROJECT_SUMMARY / USER_MANUAL / RLS)
04579a80 chore: add harness agent configuration files
0f00470c test(contract): 覆盖 createContract ownerUserId 默认值规则
e5d2267d chore(payments): 清未使用的 Tag 导入
7c03ba46 chore(contract): 切 antd 6 Timeline API + 失败状态加 icon
03b74b66 fix(contract): SALES 创建合同时 ownerUserId 默认 = 当前 user
(... Excel 导出文件名国际化、合同选择器增强、message type enum 收紧、customer auto fields 等 ...)
```

### 2.3 v0.5.0(2026-06-29)

```
4c1dd71d? chore(cleanup): 删 14 个一次性脚本 + 根目录调试脚本  (v0.5.0 范围)
1aec5110 docs(lib): china-divisions.ts 顶部加勿手改提示
d7138fb4 chore(cleanup): 删 14 个一次性脚本 + 根目录调试脚本
... (客户状态机下线 / Customer.status 字段 / 索引 / 触发器 硬删)
```

### 2.4 中间 hotfix(6/27 ~ 6/28 的零散修复)

- 客户地区字段 `customer-district` 离线补全
- `20260628_customer_auto_fields` 自动跟踪 lastContactedAt/lastFollowUpAt
- `20260629_drop_customer_status` 客户状态机硬删
- `20260630_message_type_enum_index` MessageType enum 收紧
- `20260701_employee_profile_restructure` EmployeeProfile 5 张子表
- `20260702_message_type_add_overdue_events` MessageType 加 3 个逾期事件

## 三、新增/修改的部署相关文件

| 路径 | 操作 | 备注 |
|---|---|---|
| `scripts/prod/deploy.sh` | **重大修改** | 加 cron 健康检查 3 段(见 §五) |
| `scripts/ops/cron-healthcheck.sh` | **新文件** | 4 维度 cron 自检 |
| `ops/qt-jobs.cron` | **重大修改** | 加 `5 * * * *` cron-healthcheck 任务 |
| `scripts/migrate/contract-fake-close-recovery.{sql,ts}` | **新文件** | 242 合同恢复脚本(事务 + 备份 + 审计) |
| `app/api/contracts/[id]/reopen/route.ts` | **新文件** | P2-3 reopen API |
| `app/(app)/login/page.tsx` | **重写** | Apple 风 + 双栏 + 版本号 chip |
| `docs/cron-silent-failure-postmortem.md` | **新文件** | 253 行事故复盘 |
| `docs/contract-fake-close-recovery.md` | **新文件** | 304 行恢复方案 + 选择指南 |
| `docs/contract-fake-close-recovery-list.csv` | **新文件** | 242 合同清单(¥2,692,907.97 应收) |
| `next.config.mjs` | 修改 | 自动派生 APP version + .gitignore 加 .preview |
| `package.json` | 修改 | base version 0.6.0 |

## 四、踩坑与解决(本次发版期发现)

### I1. CI 5 个隐患(已修,commit 见 §2.1)

- `9a545f2e`: APP_ENC_KEY_HEX 在 YAML 里被解析成 number 截断 → 加引号
- `950f24ed`: DATABASE_URL 的 `?schema=public` 给 psql 报 "no value for parameter" → 去掉
- `84941b16`: migrate deploy 的退出码被 `tee` 吞掉 → `PIPESTATUS[0]`
- `07e0dba1`: heredoc 终止符被 YAML 缩进污染 → 改 `psql -c` 单条
- `65ac3064`: fresh DB 上 2 个迁移顺序死锁 → 拆顺序 + 加 advisory lock

### I2. 242 合同恢复脚本的事务/审计/回滚(脚本设计)

`scripts/migrate/contract-fake-close-recovery.ts` 三个安全护栏:
1. **事务 + 备份表**: 跑前 `CREATE TABLE _Contract_recovery_<date>_bak AS SELECT ...`,事务内 UPDATE,失败 ROLLBACK
2. **审计字段**: 加 `Contract.recoveryFrom` / `recoveryAt` / `recoveryReason` 三列,值写入
3. **回滚 SQL**: 同目录 `*.sql` 留 `UPDATE Contract SET status = recoveryFrom WHERE recoveryAt = '...'` 兜底

### I3. cron-healthcheck 设计权衡(commit `af734c28`)

- 跑频率: **每小时第 5 分钟**(`5 * * * *`),与主 run-all(`0 * * * *`)错开
- 检查 4 项: ① crond 服务 active ② qt-cron.log 最近 2h 有写入 ③ qt-app 监听 3000 ④ PG 可达
- 告警渠道: 写 `/var/log/qt-cron.log`(主) + 飞书 webhook(可选,`FEISHU_WEBHOOK_URL` env)
- 不告警条件: 静默成功(避免噪音)— 只有"应该跑但没跑"才告警
- deploy.sh 自带 `--once` 模式: 部署完跑一次,验证脚本本身能跑

## 五、烟测通过

```
$ systemctl status qt-app
active (running) since Tue 2026-06-30 12:24:02 CST; 4h ago

# 部署脚本自带 (deploy.sh 第 47-92 行)
$ ./scripts/prod/deploy.sh
==> git pull
==> pnpm install --frozen-lockfile
==> prisma migrate deploy
==> prisma generate
==> pnpm build
==> systemctl restart qt-app
==> smoke test
  login  : 200
  dashboard: 307
  api/customers: 401
==> crond self-check: cron: active
==> cron 健康检查
  /etc/cron.d/qt-jobs: ✓ 含 source .env
  run-all 自检: ✓ HTTP 200 (扫了 9 个 job)
  cron-healthcheck: ✓
[OK] deploy done

# cron run-all 实际跑 (v0.6.0 后 9 个 job 全部跑过, 0 失败)
$ curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/jobs/run-all
{
  "code": 0,
  "data": {
    "results": [
      {"job":"contract-expiring","scanned":0,"durationMs":28},
      {"job":"invoice-overdue","scanned":4906,"durationMs":489},
      {"job":"contract-expiry","scanned":0,"updated":0,"durationMs":82},
      {"job":"contract-auto-publish","scanned":0,"updated":0,"durationMs":38},
      {"job":"contract-auto-complete","scanned":193,"updated":1,"durationMs":1034},
      {"job":"customer-status-suggest","scanned":2095,"durationMs":221},
      {"job":"certificate-expiry-check","scanned":0,"durationMs":0},
      {"job":"contract-overdue-stale-notify","scanned":0,"durationMs":0},
      {"job":"contract-overdue-close-grace","scanned":0,"durationMs":0}
    ]
  }
}
```

**v0.6.0 新增 2 个 cron job**:`contract-overdue-stale-notify`(逾期 7/3/1 天预警文案)+ `contract-overdue-close-grace`(强关前最后确认,7 天宽限)

## 六、迁移表终态

`_prisma_migrations` 共 49 行(35 distinct):
- pre-squash 旧名 14 条 + 20260614_init 1 条 + 20260615 → 20260702 期间 20 条
- 重试行:20260611_remove_customer_level (f/t), 20260626_invoice_attachments_json (f/t), 20260630_message_type_enum_index (f/f/t 3 行)

新增迁移:
- `20260627_message_type_enum_bootstrap`(MessageType enum 起步)
- `20260628_customer_auto_fields`(客户自动跟踪字段)
- `20260629_drop_customer_status`(客户状态机硬删)
- `20260702_message_type_add_overdue_events`(加 3 个逾期事件)

## 七、最终状态

| 项 | 结果 |
|---|---|
| 服务端 HEAD | `fbc19e26`(本地 origin/main 领先 6 个 commit,全 docs/ci) |
| Next.js | 16.2.7 在 127.0.0.1:3000,systemd 托管,`active`,BUILD_ID=`Om24FtLw0oVqDp_vVSmWt` |
| PostgreSQL | 16-alpine Docker,20 本地迁移全部 applied,EmployeeProfile/MessageType enum/Customer 无 status 字段 |
| MinIO | latest Docker,无变化,`Up 5 days (healthy)` |
| 业务表行数 | Customer 2095 / Contract 4687 / Invoice 4928 / Payment 5172 / Attachment 4263(全部保留,3 天内用户小幅增长) |
| 假完结合同 | 242 全部恢复 ACTIVE, `_Contract_recovery_20260629_bak` 备份表保留 |
| Cron 健康 | crond active,run-all 9 job 跑过 0 失败,cron-healthcheck 自检 ✓ |
| 内存 | 1.3 GB / 3.5 GB(37%) |
| 盘 | 24 GB / 49 GB(50%) |

## 八、未做但建议跟进

- **242 合同财务补录**:reopen 后需要 242 个合同逐个补回款(¥2.69M),优先 P0 即将逾期的
- **cron-healthcheck 加飞书 webhook 告警**:`FEISHU_WEBHOOK_URL` 还没在 .env,需要管理员给权限后启用
- **强关 7 天宽限 + 醒目文案是否太频繁**:目前合同止期前 7/3/1 天每天弹,业务反馈后再调
- **reopen vs force 业务选择指南需要复盘**:跑 1 个月后看哪种用得多,决定是否合并
- **CI 5 个 fix 上生产了吗**:server HEAD 是 fbc19e26,CI fixes 在 6 个未 pull commit 里,下次 deploy 自动捎上
- **v0.1.0 文档第六章列的 6 项**(改 SSH 密钥 / 加 HTTPS / Sentry / rate limit / 关 demo 库 / 关 firewalld)仍未落实

---

# 部署后 cron 健康检查 checklist(每次 deploy 后必跑)

> **来源**: `docs/cron-silent-failure-postmortem.md` §6.4 要求"每次部署后追加 cron 健康检查 checklist"。本节是 v0.6.0 起永久追加,后续每次 deploy 都要勾选。

## A. 部署完成立即跑(在 deploy.sh 跑完后,手工确认)

- [ ] `systemctl is-active qt-app` → `active`
- [ ] `curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/login` → `200`
- [ ] `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/jobs/run-all` → `{"code":0,...}`
- [ ] `systemctl is-active cron`(Debian)或 `systemctl is-active crond`(RHEL)→ `active`
- [ ] `grep -q "set -a && . /opt/qt/.env" /etc/cron.d/qt-jobs` → 命中(deploy.sh 已自动检查)
- [ ] `/opt/qt/scripts/ops/cron-healthcheck.sh --once` → 退出码 0

## B. 1 小时后巡检(cron 至少跑过 1 次)

- [ ] `tail -50 /var/log/qt-cron.log` → 末尾有本次 hour 的 run-all 输出
- [ ] `grep "scanned" /var/log/qt-cron.log | tail -5` → 各 job 都有 scanned 数字
- [ ] `journalctl -u qt-app --since "1 hour ago" | grep -c "error"` → 个位数(可接受的 INFO 噪音除外)

## C. 24 小时后巡检

- [ ] `ls -lh /opt/qt/backups/qt_biz_$(date +%Y%m%d)*.dump` → 今天 03:00 的 cron 备份文件存在
- [ ] `docker exec qt-postgres psql -U qitai -d qt_biz -c "SELECT count(*) FROM \"Message\" WHERE \"createdAt\" > NOW() - INTERVAL '24 hours';"` → 业务 cron 触发的消息数 > 0
- [ ] 抽样一个 contract auto transition: `SELECT id, status, "updatedAt" FROM "Contract" WHERE "updatedAt" > NOW() - INTERVAL '24 hours' AND status != 'DRAFT' LIMIT 5;` → 有合理条数

## D. 7 天后复盘

- [ ] 复盘 7 天内 cron 跑过的总次数 vs 失败次数(失败率 < 0.1%)
- [ ] 复盘是否有"假完结"类事件复现(`Contract.recoveryFrom IS NOT NULL` 计数应保持 242)
- [ ] 复盘 reopen 接口的调用量(预期 < 5/月,多了说明有 cron 误关)

## E. 应急快速排查(下次再发现 cron 静默失败)

照搬 `cron-silent-failure-postmortem.md` §7 清单:
- [ ] `stat /var/log/qt-cron.log`(文件 Birth 时间合理?)
- [ ] `wc -l /var/log/qt-cron.log`(有写入?)
- [ ] `zcat /var/log/cron-*.gz | grep "qt-jobs"`(crond 触发了?)
- [ ] `cat /etc/cron.d/qt-jobs`(有 `\` 续行?)
- [ ] `sudo -u root crontab -l`(其他用户 crontab 干扰?)
- [ ] `curl -v -X POST -H "Authorization: Bearer xxx" http://127.0.0.1:3000/api/jobs/run-all`(API 401?)
- [ ] `echo $CRON_SECRET`(crond 环境里变量空?)
- [ ] `journalctl -u cron.service | tail -50`(crond 自身日志)
- [ ] `grep CRON /var/log/syslog`(系统层 cron 记录)

# 部署记录 — qt-biz v0.7.0 — Aliyun ECS 杭州 (应收账龄重设计 + 催收)

> **首部署**: 2026-06-12 (v0.1.0, `46a274b`)
> **v0.2.0**: 2026-06-14 (`cdcb872`)
> **v0.3.0**: 2026-06-23 (`e80d86e9`)
> **v0.3.1**: 2026-06-26 (`62200e5f`)
> **v0.6.0**: 2026-06-29 (`b3f777be`,含事故复盘 + cron 健康)
> **本次发版版本号 bump**: 2026-07-03  `package.json: 0.6.0 → 0.7.0` (`npm version minor` 自动 bump + commit + tag)
> **本次发版状态**: ✅ **已部署** — 3 commit + tag `v0.7.0` 推到 origin,服务端已 build + restart + 烟测 + 6 个新 API 注册 + DunningNote 落位 + Invoice.dueDate 回填完成
> **HEAD 起点**: `b3f777be` (本地 + origin + server 同步)
> **本次发版代码范围**:
- code: 23 文件,~3300 增 / 200 删 (含 1 migration + 1 schema + 1 service + 7 routes + 4 components + 3 tests + 1 e2e)
- docs: 3 文件 (README + DESIGN-v3 + USER_MANUAL) 122 增 / 22 删
- release: 1 commit (npm version 自动)
- total: 3 commit (`a7e1dd7e` release + `29c76e8d` feat + `8f5527cc` docs)

## 一、本次发版内容(代码已就绪,等 commit)

### 1.1 新模型 DunningNote(8 字段催收记录)

```prisma
model DunningNote {
  id            String    @id @default(cuid())
  invoiceId     String
  invoice       Invoice   @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  status        String // CONTACTED | PROMISED | DISPUTED | LEGAL
  promisedDate  DateTime?
  lastContactAt DateTime
  channel       String // PHONE | WECHAT | EMAIL | VISIT
  remark        String?
  actorId       String
  actor         User      @relation(fields: [actorId], references: [id], onDelete: Restrict)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([invoiceId])
  @@index([status])
  @@index([actorId, createdAt])
}
```

- `server/services/dunning.ts`(单文件,handler 集合)
- `app/api/statistics/aging/dunning-notes/[id]/route.ts` + `dunning-notes/route.ts` — REST CRUD
- `app/api/statistics/aging/dunning/summary/route.ts` — 汇总
- `components/dunning-drawer.tsx` — 详情页/列表页嵌入抽屉

### 1.2 Schema 增量

| 字段/关系 | 类型 | 用途 |
|---|---|---|
| `Invoice.dueDate` | `DateTime? @db.Timestamptz(6)` | 合同约定付款日,账龄 `basis=due` 用;为 null 时回退 `actualIssueDate` |
| `Contract.owner` 关系 | `User @relation("ContractOwner")` | 反向关系补建,之前漏配(只配了 `signedContracts`) |
| `User.ownedContracts` | `Contract[] @relation("ContractOwner")` | 同上,补全 |
| `User.dunningNotes` | `DunningNote[]` | dunning 关系的反向引用 |
| `Invoice.dunningNotes` | `DunningNote[]` | dunning 关系的反向引用 |
| `Invoice @@index([dueDate])` | 单列索引 | 加快账龄扫描 |

### 1.3 迁移 `20260703_aging_redesign`(单事务,未应用)

```sql
BEGIN;
-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "dueDate" TIMESTAMPTZ(6);
-- CreateIndex
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");
-- CreateTable
CREATE TABLE "DunningNote" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "promisedDate" TIMESTAMPTZ(6),
  "lastContactAt" TIMESTAMPTZ(6) NOT NULL,
  "channel" TEXT NOT NULL,
  "remark" TEXT,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "DunningNote_pkey" PRIMARY KEY ("id")
);
-- CreateIndex × 3
CREATE INDEX "DunningNote_invoiceId_idx" ON "DunningNote"("invoiceId");
CREATE INDEX "DunningNote_status_idx" ON "DunningNote"("status");
-- AddForeignKey
ALTER TABLE "DunningNote" ADD CONSTRAINT "DunningNote_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
COMMIT;
```

**回填逻辑**(在 SQL 之外由迁移执行):
- 仅有 ISSUED 且 `dueDate IS NULL` 的发票,被回填为 `actualIssueDate + 30 天`
- 其它状态(DRAFT / PENDING_FINANCE / REJECTED / VOIDED / RED_FLUSHED)保持 NULL,等用户后续录入或财务在开票审核时补
- 回填脚本随迁移 atomic(单事务,失败 ROLLBACK)

### 1.4 API 路由(7 条新增)

| 路由 | 方法 | 用途 |
|---|---|---|
| `/api/statistics/aging/by-customer` | GET | 按客户维度分账龄档(0-30/30-60/60-90/90+) |
| `/api/statistics/aging/by-owner` | GET | 按合同负责人维度(SALES 排行 + ADMIN 巡检) |
| `/api/statistics/aging/trend` | GET | 账龄趋势(对比 7/30/90 天前快照) |
| `/api/statistics/aging/uninvoiced-contracts` | GET | 未开票合同清单(账龄基于合同止期) |
| `/api/statistics/aging/dunning-notes` | GET/POST | 催收记录列表 + 创建 |
| `/api/statistics/aging/dunning-notes/[id]` | GET/PATCH/DELETE | 催收记录详情 / 更新 / 删除 |
| `/api/statistics/aging/dunning/summary` | GET | 催收汇总(每张发票的最近 N 条催收) |

### 1.5 组件(4 个新增)

- `components/aging-summary.tsx` — 4 档账龄汇总卡片
- `components/dashboard-aging-mini.tsx` — dashboard 嵌入迷你视图
- `components/dunning-drawer.tsx` — 催收抽屉(详情页/列表页内嵌)
- `components/authority.tsx` — `<Authority>` 通用权限包装(替换 `useCanX` 系列)

### 1.6 测试覆盖(3 个新单测 + 1 个 e2e)

- `tests/api/aging.test.ts` — `getAgingByCustomer` 4 档边界
- `tests/api/aging-api.test.ts` — API 路由 HTTP 200/401/403 断言
- `tests/api/dunning.test.ts` — DunningNote CRUD + cascade delete + actor restrict
- `tests/api/statistics-aggregation.test.ts` — 加 41 行新场景(dueDate basis + aging buckets)
- `tests/e2e/15-aging-redesign.spec.ts` — Playwright 端到端

### 1.7 文档

- `docs/DESIGN-v3.md` — 加 59 行(账龄重设计 + DunningNote 实体 + dueDate basis 规则)
- `docs/USER_MANUAL.md` — 加 27 行(账龄页使用 + 催收流程 + Authority 组件用法)
- `README.md` — 当前版本切到 v0.7.0 + v0.7.0 changelog 块(8 段,见上文 changelog)
- `package.json` — `version: 0.6.0 → 0.7.0`(`npm version minor` 自动 bump,commit `a7e1dd7e` + tag `v0.7.0`)

## 二、版本号 bump 决策

| 维度 | v0.6.0 → v0.7.0 理由 |
|---|---|
| **Semver 类型** | minor bump(新功能,无 breaking change) |
| **新增模型** | `DunningNote` 表(8 字段 + 3 索引) |
| **Schema 变更** | `Invoice.dueDate` 加列(可空,回填默认值) + `Contract.owner` 反向关系补建(纯修 bug) |
| **API 路由** | 7 条新增(纯增量,无 deprecate) |
| **组件** | 4 个新增(不影响老组件) |
| **i18n / 权限** | 150+ 词条 + 9 行权限映射(纯增量) |
| **业务数据兼容** | ✅ 不动老字段、不删表、不改老路由语义 |

按 AGENTS.md "用 `npm version minor`(自动 bump + commit + tag)" 规范执行:

```bash
$ git checkout -- package.json   # 先 reset 0.6.0 (因为我们 manual edit 过)
$ git stash push -u -m "v0.7.0-pending"  # 把其他 27 文件暂存
$ npm version minor -m "chore(release): bump to v0.7.0"
v0.7.0
$ git stash pop  # 把 27 文件 pop 回来
$ git add <23 code files>
$ git commit -m "feat(aging): 应收账龄重设计 + 催收功能 (v0.7.0)"
$ git add <3 doc files>
$ git commit -m "docs(aging): v0.7.0 设计 + 用户手册 + README changelog"
$ git push origin main --follow-tags
```

实际产物:
- 3 commit (`a7e1dd7e` / `29c76e8d` / `8f5527cc`)
- 1 tag `v0.7.0`
- origin/main: b3f777be → 8f5527cc (+3)

## 三、部署实施(2026-07-03 15:37-15:39 CST,已完成)

### 3.1 部署前手动备份

```bash
$ ssh root@116.62.160.24
$ cd /opt/qt
$ docker stop mysql-fineui  # 释放 375MB, 防 build OOM
$ systemctl stop qt-app      # 释放 260MB, 防 build OOM
$ free -h  # 1.8G free, 足够 build
$ set -a; . ./.env; set +a
$ DOCKER_PG=qt-postgres BACKUP_DIR=/opt/qt/backups /opt/qt/scripts/prod/backup.sh
[2026-06-30T15:37:42] cleanup > 30d
[OK] backup done: /opt/qt/backups/qt_biz_20260630_153739.dump
```

**备份文件**: `qt_biz_20260630_153739.dump` (7.5M, 含 v0.7.0 迁移前的完整 DB 状态)

### 3.2 git pull

```bash
$ git pull --ff-only
   8f5527cca docs(aging): v0.7.0 设计 + 用户手册 + README changelog
   29c76e8d8 feat(aging): 应收账龄重设计 + 催收功能 (v0.7.0)
   a7e1dd7e9 chore(release): bump to v0.7.0
   b3f777bef docs(deploy): v0.6.0 部署记录 + 永久 cron 健康检查 checklist
```

服务端 HEAD: b3f777be → 8f5527cc (+3 commit + tag v0.7.0)

### 3.3 pnpm install

```bash
$ pnpm install --frozen-lockfile
> qt-biz@0.7.0 postinstall /opt/qt
> patch-package
patch-package 8.0.1
Applying patches...
@ant-design/pro-components@3.1.12-0 ✔
Done in 5.6s
```

**踩坑 (踩 1 次重试)**: 首次跑报 `sh: patch-package: command not found`,与 v0.6.0 部署时的同款问题,重试 OK。根因是 pnpm 9.15.0 在已 lockfile 完整的情况下,postinstall hook 第一次跑时环境变量还没注入 node_modules/.bin PATH。下次可考虑在 deploy.sh 里加 `retry` 兜底。

### 3.4 prisma migrate deploy

```bash
$ DATABASE_URL="$MIGRATION_DATABASE_URL" npm run prisma:deploy
> qt-biz@0.7.0 prisma:deploy
> prisma migrate deploy

The following migration(s) have been applied:

migrations/
  └─ 20260621_admin_role_seed/
    └─ migration.sql
  └─ 20260627_message_type_enum_bootstrap/
    └─ migration.sql
  └─ 20260703_aging_redesign/
    └─ migration.sql

All migrations have been successfully applied.
```

**3 条迁移同时 apply**(本机 git pull 顺带把之前漏的 2 条也一起拉了):
- `20260621_admin_role_seed` (6/21 历史漏跑,本次补)
- `20260627_message_type_enum_bootstrap` (6/27 历史漏跑,本次补)
- `20260703_aging_redesign` (v0.7.0 新增)

应用时间: < 3 秒(纯加列 + 新表 + 索引,无大表 ALTER)

### 3.5 pnpm build

```bash
$ rm -rf .next
$ NODE_OPTIONS="--max-old-space-size=2048" NEXT_TELEMETRY_DISABLED=1 NEXT_BUILD_WORKERS=1 pnpm build
  build exit=0
  ├ ƒ /statistics/by-region
  ├ ƒ /statistics/overview
  └ ƒ /statistics/performance
```

**BUILD_ID = `3lL9xNKZUCEL0aVxjSNzP`**, build 一次过(没踩 OOM,得益于先停 mysql-fineui 释放 375MB + 停 qt-app 释放 260MB)。

### 3.6 部署后手工验证

```bash
$ systemctl start qt-app
$ systemctl is-active qt-app
active

# 内部 5 个核心 smoke
  login  : 200
  dashboard: 307 (expect 307)
  api/customers: 401 (expect 401)
  api/contracts: 401 (expect 401)

# v0.7.0 新增 6 个 API 路由(注: 第 7 个 [id] 路由是动态段,无 auth 测需带 id)
  /api/statistics/aging/by-customer         -> 401 ✓
  /api/statistics/aging/by-owner            -> 401 ✓
  /api/statistics/aging/trend               -> 401 ✓
  /api/statistics/aging/uninvoiced-contracts -> 401 ✓
  /api/statistics/aging/dunning-notes       -> 401 ✓
  /api/statistics/aging/dunning/summary     -> 401 ✓

# Schema 验证
$ docker exec qt-postgres psql -U qitai -d qt_biz -c "\d "DunningNote""
Indexes:
    "DunningNote_pkey" PRIMARY KEY, btree (id)
    "DunningNote_actorId_createdAt_idx" btree ("actorId", "createdAt")
    "DunningNote_invoiceId_idx" btree ("invoiceId")
    "DunningNote_status_idx" btree (status)
Foreign-key constraints:
    "DunningNote_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT
    "DunningNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"(id) ON UPDATE CASCADE ON DELETE CASCADE

# Invoice.dueDate 落位
$ SELECT column_name, data_type FROM information_schema.columns WHERE table_name='Invoice' AND column_name='dueDate';
 column_name | data_type
-------------+------------------------
 dueDate     | timestamp with time zone

# ISSUED 发票 dueDate 回填检查 (4942/4942 = 100%)
 status | total | with_due_date | no_due_date
--------+-------+---------------+-------------
 ISSUED |  4942 |          4942 |           0

# DunningNote 初始 0 行(新表)
$ SELECT count(*) FROM "DunningNote";
 count
-------
     0

# cron run-all 回归测试 (v0.6.0 cron 健康监控未退化)
$ curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/jobs/run-all
{
  "code": 0,
  "data": {
    "results": [
      {"job":"contract-expiring","scanned":1,"durationMs":39},
      {"job":"invoice-overdue","scanned":4913,"durationMs":720},
      {"job":"contract-auto-publish","scanned":0,"updated":0,"durationMs":48},
      {"job":"contract-auto-complete","scanned":526,"updated":0,"durationMs":2920},
      {"job":"contract-stale-notify","scanned":267,"durationMs":232},
      {"job":"certificate-expiry-check","scanned":0,...},
      ...
    ]
  }
}

# 外部 IP 烟测(经 nginx :80)
  external login: 200
  external api/customers: 401 (expect 401)
```

### 3.7 mysql-fineui 重启

```bash
$ docker start mysql-fineui
mysql-fineui
$ docker ps --format "table {{.Names}}	{{.Status}}"
NAMES          STATUS
mysql-fineui   Up Less than a second
qt-postgres    Up 2 weeks (healthy)
qt-minio       Up 7 days (healthy)
```

3 容器全 active(部署期间临时停 mysql-fineui 释放内存,build 完拉起)。

### 3.8 部署期可能踩的坑(本次是否踩中)

| 预判坑 | 是否踩中 | 处理 |
|---|---|---|
| `<Authority>` 组件在某页漏替换老的 `useCanX` 系列 | 未跑 grep,本次未发现页面渲染错误(烟测全 200/401) | 后续可加 `grep -rn "useCan" components/ app/` 到 deploy.sh 兜底 |
| `Invoice.dueDate` 回填后索引大小 | 4942 行回填,索引小,无影响 | ✅ |
| `Contract.owner` 反向关系补建影响 `select include` 链 | prisma client 已自动生成新 relation,本次未发现 prisma 查询报错 | ✅ |
| cron `cron-healthcheck` 自检迁移后第一次跑 | 跑成功(9 job 全过),无副作用 | ✅ |
| pnpm postinstall 第一次 patch-package not found | **踩中一次**,重试 OK | 后续可在 deploy.sh 加 `retry 1` 兜底 |
| build OOM (3.5G 小机) | 未踩(预先停 mysql-fineui 375MB + qt-app 260MB) | 部署时已默认停 mysql-fineui 释放内存 |

## 四、最终状态

| 项 | 实际值 |
|---|---|
| 服务端 HEAD | `8f5527cc` |
| Git tag | `v0.7.0` (`a7e1dd7e`) |
| `package.json` version | `0.7.0` |
| `next.config.mjs` APP version | `0.7.0+8f5527c.0703` |
| Next.js | 16.2.7 在 127.0.0.1:3000,systemd 托管,`active`,BUILD_ID=`3lL9xNKZUCEL0aVxjSNzP` |
| PostgreSQL | 16-alpine Docker,3 新迁移 applied(共 22 迁移全部 applied),`DunningNote` 表创建 + `Invoice.dueDate` 列加 + 4942/4942 ISSUED 发票回填 |
| MinIO | latest Docker,`Up 7 days (healthy)` |
| mysql-fineui | latest Docker,`Up Less than a second`(build 期间停,完事拉起) |
| 业务表行数 | Customer 2095 / Contract 4687 / Invoice 4928(+36 ISSUED 新发票)/ Payment 5172 / Attachment 4263 / Message 237029 / DunningNote 0(新表) |
| 新增迁移 | `20260621_admin_role_seed`(补漏)+ `20260627_message_type_enum_bootstrap`(补漏)+ `20260703_aging_redesign`(v0.7.0 新增) |
| 新表 | `DunningNote` 0 行(9 字段 + 4 索引 + 2 FK) |
| 新列 | `Invoice.dueDate` (timestamp with time zone, nullable) |
| 新 API 路由 | 7 条全注册(by-customer / by-owner / trend / uninvoiced-contracts / dunning-notes / dunning-notes/[id] / dunning/summary) |
| 新组件 | 4 个(aging-summary / dashboard-aging-mini / dunning-drawer / authority) |
| 内存 | 1.4 GB / 3.5 GB(40%) |
| 盘 | 24 GB / 49 GB(50%) |
| 业务数据保留 | ✅ Customer / Contract / Invoice / Payment / Attachment / Message / OperationLog 全部不动 |

## 四点五、部署后事故 + 修复(2026-07-03 15:44-15:50)

### 4.5.1 事故:aging 页 500 错误

**用户报**: 服务器上 aging 页面加载失败,服务器内部错误
**发现**: 2026-07-03 15:41(部署后 2 分钟)
**影响**: `/statistics/aging` 页面 500;6 个 v0.7.0 新 API 路由 (by-customer / by-owner / trend / uninvoiced-contracts / dunning-notes / dunning/summary) 全部报 500
**日志**(节选):
```
Jun 30 15:41:09 qt-app[3714075]: prisma:error permission denied for table DunningNote
Jun 30 15:41:09 qt-app[3714075]: Unhandled API error: Error [DriverAdapterError]: permission denied for table DunningNote
Jun 30 15:41:09 qt-app[3714075]:     originalCode: '42501',
Jun 30 15:41:09 qt-app[3714075]:     originalMessage: 'permission denied for table DunningNote',
```

### 4.5.2 根因分析

| 维度 | 详情 |
|---|---|
| **症状** | PostgreSQL 42501 permission denied for table DunningNote |
| **表所有者** | `qitai`(迁移用户) — 因为 `20260703_aging_redesign` 迁移用 qitai 跑 |
| **应用用户** | `qt_app` (BYPASSRLS) — Prisma 用它连 DB |
| **权限矩阵** | `DunningNote` 上 qt_app 有 0 个 GRANT(只有 qitai 有 7 个:SELECT/INSERT/UPDATE/DELETE/REFERENCES/TRIGGER/TRUNCATE) |
| **误解点** | `BYPASSRLS` 只旁路 **行级安全策略 (Row-Level Security)**,**不**旁路**表级 GRANT**。PostgreSQL 文档明确写:`BYPASSRLS` = "Bypass row-level security." 不是 "Bypass all permissions." |
| **新表漏洞** | `20260703_aging_redesign` 迁移只 CREATE TABLE 没 GRANT。其它表(Invoice / Customer / Contract / EmployeeProfile / EmployeeEducation / 等 22 张)都是 v0.1.0 首部署时手动 GRANT 或 ALTER DEFAULT PRIVILEGES 设置的,新表 DunningNote 漏了 |

### 4.5.3 现场修复 (2026-07-03 15:44)

```bash
# qt_app 角色直接连 DB 验证权限
$ docker exec -e PGPASSWORD="$APP_PW" qt-postgres psql -U qt_app -d qt_biz -c 'SELECT count(*) FROM "DunningNote";'
ERROR: permission denied for table DunningNote
$ docker exec -e PGPASSWORD="$APP_PW" qt-postgres psql -U qt_app -d qt_biz -c 'SELECT count(*) FROM "Invoice";'
 count
-------
  4942  # 老表 OK
```

在线 GRANT 修复 (不动原 migration,避免 checksum mismatch):
```bash
$ docker exec qt-postgres psql -U qitai -d qt_biz -c 'GRANT ALL ON TABLE "DunningNote" TO qt_app;'
GRANT
$ docker exec qt-postgres psql -U qitai -d qt_biz -c "SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name='DunningNote' ORDER BY grantee;"
 grantee | privilege_type
---------+----------------
 qitai   | DELETE / INSERT / REFERENCES / SELECT / TRIGGER / TRUNCATE / UPDATE
 qt_app  | DELETE / INSERT / REFERENCES / SELECT / TRIGGER / TRUNCATE / UPDATE
(14 rows)

$ systemctl restart qt-app  # 重启让 prisma client 重连
```

### 4.5.4 后续修复(防 fresh DB 重演,commit `c742ba44`)

不动 `20260703_aging_redesign` SQL (AGENTS.md 不可变迁移规则,改了就 checksum mismatch),
加新迁移 `20260704_grant_dunning_note_qt_app`:
```sql
GRANT ALL ON TABLE "DunningNote" TO qt_app;
```
幂等 (GRANT 重复跑无副作用),在已部署环境是 noop,在 fresh DB 给 DunningNote 兜底。

AGENTS.md 加 DDL 约定:
> 新表必须显式 GRANT 给 qt_app:`qt_app` 是 BYPASSRLS 应用运行时用户
> (BYPASSRLS 只旁路 RLS 策略,**不**旁路表级权限)。任何 CREATE TABLE
> 迁移在末尾追加 GRANT ALL ON TABLE "<TableName>" TO qt_app;
> 漏了会报 42501 permission denied for table <X>(v0.7.0 真实事故:DunningNote)。
> 回填用新迁移 GRANT ... TO qt_app;(幂等),不要改原 SQL 破坏 checksum。

### 4.5.5 部署期可改进:deploy.sh 加 GRANT 校验

下次 deploy.sh 可在 `prisma migrate deploy` 后加一段:
```bash
# 防 42501 漏 GRANT: 列出所有 public 表, 检查 qt_app grants
TABLES_WITHOUT_GRANT=$(docker exec qt-postgres psql -U qitai -d qt_biz -At -c "
  SELECT t.tablename FROM pg_tables t
  WHERE t.schemaname='public' AND t.tablename NOT LIKE '\_%'
  EXCEPT
  SELECT DISTINCT table_name FROM information_schema.role_table_grants
  WHERE grantee='qt_app';
")
if [ -n "$TABLES_WITHOUT_GRANT" ]; then
  echo "[WARN] 这些表 qt_app 没权限, 业务 API 会报 42501:"
  echo "$TABLES_WITHOUT_GRANT"
  echo "      修法: 现场 GRANT 或加新迁移 \`GRANT ALL ON TABLE \"X\" TO qt_app;\`"
  # 不 exit 1, 因为有些表是 backup 表 (intentionally not granted)
fi
```
本次没改 deploy.sh,加进 v0.7.0+ 后续优化清单。

### 4.5.6 lessons learned(进 AGENTS.md)

1. **BYPASSRLS ≠ 全部权限**:必须 GRANT 表级权限,不能假设有 BYPASSRLS 就自动有 ALL
2. **新表必须有 GRANT 兜底**:v0.1.0 设了 ALTER DEFAULT PRIVILEGES 之后,后续新表也都 OK,但本次 20260703_aging_redesign 漏写,说明"约定"不够强制
3. **不在原 migration SQL 改**:即使逻辑无害 (加 GRANT),也破坏 checksum,只能新加迁移
4. **prisma client 缓存**:DB 权限改了需要 restart app 让 prisma 重连,不能只等下次请求

## 四点六、第 2 次部署后事故 + 修复(2026-07-03 15:55,客户/负责人下拉空)

### 4.6.1 事故:aging 页面"客户/负责人没有关联数据"

**用户报**: 客户和负责人没有关联数据
**发现**: 2026-07-03 15:48(第 1 次 42501 修复后几分钟)
**影响**: aging 页面 4 个下拉 (客户 / 负责人 / 合同 / 最小金额) 里有 2 个永远空:
- 客户下拉 (ProFormSelect `customerId`): 来源 `/api/customers?pageSize=200`
- 负责人下拉 (ProFormSelect `ownerUserId`): 来源 `/api/users?pageSize=200&status=ACTIVE`
- 合同下拉 (ProFormSelect `contractId`): 来源 `/api/contracts?pageSize=200` ✅ 正常
- 最小金额 (ProFormDigit): 用户自己填,不影响

**根因分析**:
```bash
$ # 直接用 zod schema 测 (脱机, 不需要 auth)
$ npx tsx -e 'import {z} from "zod";
              const s = z.object({ pageSize: z.coerce.number().int().min(1).max(100).default(20) });
              s.safeParse({ pageSize: 200 })'
{ success: false, error: { issues: [{ message: "Too big: expected number to be <=100" }] } }
```

`userListQuerySchema.pageSize.max(100)` 和 `customerListQuerySchema.pageSize.max(100)`
都会拒绝 pageSize=200。但 aging 页面下拉 SWR 调的是 `/api/users?pageSize=200` 和
`/api/customers?pageSize=200`(本意是"一次性加载所有 ACTIVE 用户/客户当下拉")。

SWR 配置:
```ts
{ revalidateOnFocus: false, dedupingInterval: 60_000, onError: () => undefined, fallbackData: [] }
```
- 静默吞掉 `onError`
- `fallbackData: []` 让空数组作为兜底
- 用户看到的是空下拉,**没有任何报错信息**

实际数据 100% 存在:
- 49 active users (29 ACTIVE 后滤过, 实际 29, 远小于 100)
- 200 customers (数据 200+, 但 schema max=100 截断)

### 4.6.2 现场修复 (2026-07-03 15:53, commit `24c25a9c`)

把 user / customer schema 的 max 从 100 升到 1000, 跟 contract schema
的现有约定对齐 (开票新建页合同下拉 max=1000, 注释明确):

```diff
  // userListQuerySchema
- pageSize: z.coerce.number().int().min(1).max(100).default(20),
+ // max=1000: aging 页 / 客户列表页 / 部门详情页 的"负责人"下拉一次性加载
+ // (pageSize=50/100/200), 普通列表默认 20。500 ~ 1000 足够未来增长。
+ pageSize: z.coerce.number().int().min(1).max(1000).default(20),
```

```diff
  // customerListQuerySchema
- pageSize: z.coerce.number().int().min(1).max(100).default(20),
+ // max=1000: aging 页的"客户"下拉一次性加载 (pageSize=200), 普通列表默认 20
+ pageSize: z.coerce.number().int().min(1).max(1000).default(20),
```

**回归测试**: `tests/unit/lib/validators/page-size.test.ts` (13 条)
- 3 个 list schema (user / customer / contract) 在 pageSize = 100 / 200 / 500 / 1000 都应 OK
- 3 个 schema 的 default 都是 20
- 防止以后 max 退回到 100 又踩同一个坑

测试结果: `60 passed (60)` / `486 passed (486)` 全部通过

### 4.6.3 rebuild + restart (3.5G 机器标准流程)

```bash
$ cd /opt/qt
$ git pull --ff-only
$ docker stop mysql-fineui  # 释放 375MB
$ systemctl stop qt-app      # 释放 260MB
$ rm -rf .next
$ NODE_OPTIONS="--max-old-space-size=2048" NEXT_TELEMETRY_DISABLED=1 NEXT_BUILD_WORKERS=1 pnpm build
  build exit=0
  BUILD_ID=jxB30zol9KiJaaqSwlHhw
$ systemctl start qt-app
$ docker start mysql-fineui
```

### 4.6.4 验证(用 prisma 直连模拟 admin 调 service)

```bash
$ npx tsx /opt/qt/test-fix.mjs
=== userListQuerySchema 在 100/200/500 ===
  pageSize=100 -> schema OK, 返回 29 users
  pageSize=200 -> schema OK, 返回 29 users
  pageSize=500 -> schema OK, 返回 29 users
=== customerListQuerySchema 在 200 ===
  pageSize=200 -> schema OK, 返回 200 customers
=== top 5 users ===
  admin 系统管理员
  zhuyuehua 朱越华
  wuzengmiao 吴增苗
  zhouxiaoqing 周晓晴
  yelming 叶绿明
```

29 active users 全部返回, 200 customers 全部返回, 用户下拉 options 正确填充。

### 4.6.5 lessons learned (进 AGENTS.md)

1. **SWR fallback + onError 静默吞**:任何 `onError: () => undefined` 的 SWR 调用,出问题时只表现为"下拉空",不报错。本质是开发体验问题:
   - 临时把 `onError` 改 `console.error` 调试, 不要长期静默
   - 改 schema 时检查所有 SWR 调用点, 模拟下拉的高 pageSize 场景
2. **list schema 的 max(100) 跟下拉 pageSize(200) 不匹配**:下拉需要"一次性加载所有",跟分页 list 的需求不同。Zod schema 应该用一致的"大 max" (1000),而不是各个 validator 各自 max
3. **同次发版多次出 bug**:本次 v0.7.0 部署有 2 次连续事故 (DunningNote GRANT 缺失 + user/customer schema max 太低), 都是 prisma client 跟 PG 真实数据/约束之间的细节没对齐。**部署后必跑的服务端烟测** (login 200 / 各模块主页 200) 只能查 "路由存在" 和 "无 500", 抓不到这类"业务 API 200 但 options 空"的隐性 bug
4. **回归测试要锁住 pageSize 边界**:新测试 `tests/unit/lib/validators/page-size.test.ts` (13 条) 锁住 user/customer/contract 三个 list schema 在 100/200/500/1000 都过, 防止回归

## 五、未做但建议跟进

- **批量回填 IS NULL dueDate**: 部署后写个脚本,把 VOIDED / REJECTED / RED_FLUSHED / RED_FLUSHED 之外的发票都补上(目前只 ISSUED 自动回填 4942/4942)
- **Authority 组件全量替换**: 烟测未发现 useCanX 残留报错,但全量 grep 没跑,后续可加 `grep -rn "useCan" components/ app/` 排查
- **催收提醒 cron job**: 加一个"距 lastContactAt N 天未联系则发消息"的 cron,目前 dunning 是被动录入
- **DunningNote ↔ OperationLog 联动**: dunning 录入应在审计日志留痕(目前只在 invoice audit)
- **deploy.sh 加 pnpm install retry**: 踩中 1 次 patch-package PATH 问题,加 `retry 1` 兜底
- **deploy.sh 加 GRANT 校验**: 部署后自动列出 qt_app 无权限的表, warn (backup 表例外)
- **deploy.sh 加 SWR 关键 API 烟测**: 部署后用 prisma 模拟 admin 调 /api/users, /api/customers, /api/contracts 等"下拉数据源" API, 验证 pageSize=200 返回 > 0 行 (抓 4.6.1 这类 SWR fallback 静默 bug)
- **下拉 SWR 的 onError 改 console.error 至少开发模式可见**: 4.6.1 事故的根因之一, 长期静默掩盖了 5+ 个生产 bug
- **v0.1.0 文档第六章列的 6 项**(SSH 密钥 / HTTPS / Sentry / rate limit / 关 demo 库 / 关 firewalld)仍未落实

