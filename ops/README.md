# 生产运维文件 (ops/)

本目录集中存放生产服务器 /etc 下的配置文件,**仓库内只是模板**,安装时由人工 cp 到对应位置。

> **适用版本: v0.16.0 起。** 应用已由 docker 容器改为 **native systemd** (`qt-app.service`),仅 PostgreSQL / MinIO 仍走 docker。
> 完整部署流程见 [docs/ops/deploy-current.md](../docs/ops/deploy-current.md),docker 时期的历史记录见 [docs/ops/deploy-history/](../docs/ops/deploy-history/)。

## 文件清单

| 文件 | 安装位置 | 用途 |
|------|---------|------|
| `qt-app.service`   | `/etc/systemd/system/qt-app.service` | **应用主进程(v0.16.0+ 主路径)** native `next start`,由 systemd 托管;deploy.sh / rollback.sh 通过 `systemctl restart qt-app.service` 生效 |
| `qt-jobs.cron`     | `/etc/cron.d/qt-jobs`                | 定时任务 (job runner + backup + audit + cert-check) |

## 应用运行方式 (v0.16.0+ native systemd)

- 应用由 systemd 直接拉起 `next start`(见 `qt-app.service`,`User=root`,`WorkingDirectory=/opt/qt`,端口 `127.0.0.1:3000`)。
- **PG 16 / MinIO 仍在 docker**(`docker compose -f docker-compose.prod.yml up -d postgres minio`),app 不在容器里。
- 日常部署:`cd /opt/qt && sudo -E ./scripts/prod/deploy.sh` —— 内部是 git pull → native build(`.next/cache` 增量)→ `compose up -d postgres minio` → `prisma migrate deploy` → `release:publish` → `systemctl restart qt-app.service` → smoke + cron 自检。
- 回滚:`bash /opt/qt/scripts/prod/rollback.sh`(默认 HEAD~1,`--to <sha|tag>` 指定,`--list` 看候选,自动建 `.rollback-<sha>` 备份分支)。
- 宿主机 nginx 不动,上游仍是 `127.0.0.1:3000`;cron 的 curl 目标也不变。
- 应用日志:`journalctl -u qt-app -f`(`docker logs -f qt-app` 是 v0.15.x 及更早的旧写法,已失效)。

> **Dockerfile / `docker-compose.prod.yml` 的 `app:` 块已 DEPRECATED(v0.17+)**:qt-app 镜像与容器已清除,脚本不再调用,只作应急回退参考。

## 安装步骤 (Aliyun ECS 单主机, 用户 `qt`, 工作目录 `/opt/qt`)

```bash
# 1) 应用 (native systemd)
sudo cp ops/qt-app.service /etc/systemd/system/qt-app.service
sudo systemctl daemon-reload
sudo systemctl enable --now qt-app.service
journalctl -u qt-app -f                    # 实时日志
systemctl status qt-app --no-pager         # 运行状态

# 2) 基础设施 (PG + MinIO, 仍走 docker)
docker compose -f docker-compose.prod.yml up -d postgres minio

# 3) 定时任务 (安装前请确认 .env 里已设置 CRON_SECRET, 与 NextAuth / 内部 API 鉴权一致)
sudo cp ops/qt-jobs.cron /etc/cron.d/qt-jobs
sudo chmod 644 /etc/cron.d/qt-jobs
# cron.d 不需重启,直接生效; 用 systemctl status crond 确认 crond 在跑 (RHEL/CentOS/Aliyun Linux; Debian/Ubuntu 用 systemctl status cron)
cat /etc/cron.d/qt-jobs               # 检查变量 ${CRON_SECRET} 会被 cron 展开
```

## 注意事项

- **`/opt/qt/.env` 必须含**:`DATABASE_URL`、`MIGRATION_DATABASE_URL`、`MINIO_ACCESS_KEY`、`MINIO_SECRET_KEY`、`CRON_SECRET`(在 `/etc/cron.d/qt-jobs` 中被引用)、`NEXTAUTH_SECRET`、`NEXTAUTH_URL`。
- **`qt-app.service` 直接跑** `node node_modules/next/dist/bin/next start -p 3000 -H 127.0.0.1`(v0.16 起不再经过 pnpm,且 `EnvironmentFile=/opt/qt/.env` 注入环境变量)。改端口 / 改用户前先改 `ExecStart` 并 `daemon-reload`。
- **`qt-app.service` 缺失或没 enable 时 `deploy.sh` 会直接 exit 1**(preflight 第 4 步),不会"脚本跑通但应用没起"。
- **`/var/log/qt-cron.log`** 由 cron 自动追加,需要 logrotate 防止撑爆,或交给 journald:
  ```bash
  echo '/var/log/qt-cron.log { daily rotate 14 compress missingok notifempty }' \
    | sudo tee /etc/logrotate.d/qt-cron
  ```
- **cron 服务名因发行版而异**: RHEL/CentOS/Aliyun Linux 用 `crond`,Debian/Ubuntu 用 `cron`。验证时:
  ```bash
  # RHEL 系
  systemctl status crond --no-pager
  # Debian 系
  systemctl status cron --no-pager
  ```
- **修改 ops/ 下文件后**:`git commit && git push`,生产端 `cd /opt/qt && sudo git pull` 再 `sudo cp ops/qt-app.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl restart qt-app`(unit 文件改动需 daemon-reload 才生效)。
- **不要把生产 secret 写进仓库**:`.env` 在 `.gitignore` 里,这里只引用变量名。
