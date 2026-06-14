材料齐了,给你一份决策完整的方案。<proposed_plan>

# 阿里云 ECS 单主机部署方案 — qt-biz v0.1.0

> **目标**:`yinchengchen-AI/qt@main`(`ff6ef4d`)部署到阿里云杭州区一台全新 Aliyun Linux 3 ECS,IP+HTTP,全栈同机(Docker 跑 PG/MinIO,native 跑 Node 应用 + nginx 反代 + systemd 托管),首登通过新增 CLI 脚本 `scripts/create-admin.ts` 建第一个 admin。

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

### 阶段 I:建第一个 admin(新增 `scripts/create-admin.ts`)

文件规格(将在下次实施时由我创建并提交,先列规约):

- 入口:`pnpm tsx scripts/create-admin.ts --employeeNo <id> --name <名> --email <邮箱>`(也可 `--password <pwd>` 非交互;不传则 prompt)
- 行为:从 `process.env.DATABASE_URL` 读连接;`bcrypt` cost=10;查 `Role.code='ADMIN'` 拿 `roleId`;`prisma.user.create` 写一条 `status='ACTIVE'`;打印新建 userId 即结束
- 失败回滚:任一错误抛错,无副作用
- 写完会追加到 `package.json` 的 scripts 段:`"create-admin": "tsx scripts/create-admin.ts"`

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
0 3 * * * root cd /opt/qt && set -a && . /opt/qt/.env && set +a && DOCKER_PG=qt-postgres BACKUP_DIR=/opt/qt/backups BACKUP_MIRROR_MINIO=1 /opt/qt/scripts/backup.sh >> /var/log/qt-cron.log 2>&1
```

### 阶段 M:备份脚本(`scripts/backup.sh`,dev/prod 统一版,行为差异由 env 控制)

规约:

- 读 `MIGRATION_DATABASE_URL`(qitai 超级用户)
- `pg_dump --format=custom --no-owner --no-acl` 输出到 `/opt/qt/backups/qt_biz_$(date +%Y%m%d_%H%M%S).dump`
- 用 `mc` 客户端(mc 静态二进制,放 `/usr/local/bin/mc`)镜像到 `local/qt-backups`(local alias 指向 MinIO 容器)
- 清理本地和远端 > 30 天的旧文件
- `chmod +x scripts/backup.sh`, `/opt/qt/scripts/deploy.sh` 同

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
| 代码更新      | 新增 `scripts/deploy.sh`,内容: `cd /opt/qt && git pull && pnpm install --frozen-lockfile && DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate deploy && pnpm build && systemctl restart qt-app && curl -fsS http://127.0.0.1:3000/login > /dev/null && echo OK` |
| 备份恢复      | `pg_restore --clean --if-exists -d qt_biz /opt/qt/backups/qt_biz_XXXX.dump`(用 `MIGRATION_DATABASE_URL` 登) |
| 回滚代码      | `cd /opt/qt && git checkout <good-sha> && pnpm install --frozen-lockfile && pnpm build && systemctl restart qt-app`;DB 回滚需手工 `prisma migrate resolve --rolled-back <name>`(不推荐,优先用备份恢复) |
| SSH 改密钥    | 部署稳定后:`ssh-keygen` 本地生成 → `ssh-copy-id root@<IP>` → 改 `/etc/ssh/sshd_config.d/00-disable-password.conf` 禁密码 |

## 六、新增/修改文件清单

| 路径                                                    | 操作                           | 备注                                        |
| ------------------------------------------------------- | ------------------------------ | ------------------------------------------- |
| `/opt/qt/.env`                                          | 新建                           | 阶段 D 生成,`chmod 600`                     |
| `/opt/qt/docker-compose.prod.yml`                       | 新建                           | 阶段 E,生产用,密码走 env 替换               |
| `/opt/qt/scripts/create-admin.ts`                       | **新文件,由我提交 commit**     | 阶段 I 规约                                 |
| `/opt/qt/scripts/backup.sh` (dev/prod 统一版) | 调整           | 阶段 M; cron 入口在 `ops/qt-jobs.cron`                                      |
| `/opt/qt/scripts/deploy.sh`                             | 新建                           | 日常运维                                    |
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
- **无 CI/CD**:`scripts/deploy.sh` 手跑;v0.2 加 GitHub Actions
- **不跑 seed**:留空库,`scripts/create-admin.ts` 建首个 admin(README 里 4 个 test 账号全部不进生产)
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

确认这份方案可以直接开干的话,回我"OK"或者指出要改哪几条;我会把 `scripts/create-admin.ts` 落到 commit,然后等你贴公网 IP + 密码,按阶段 A → 阶段 M 顺序执行,每完成一段给你贴关键命令输出。