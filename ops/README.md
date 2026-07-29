# 生产运维文件 (ops/)

本目录集中存放生产服务器 /etc 下的配置文件,**仓库内只是模板**,安装时由人工 cp 到对应位置。

## 文件清单

| 文件 | 安装位置 | 用途 |
|------|---------|------|
| `qt-app.service`   | `/etc/systemd/system/qt-app.service` | **(legacy, v0.13.2 起停用)** 应用已容器化(qt-app docker 容器,host 网络,`docker compose -f docker-compose.prod.yml up -d app` 管理);此单元仅留作容器化前的回滚备份 |
| `qt-jobs.cron`     | `/etc/cron.d/qt-jobs`                | 定时任务 (job runner + backup + audit + cert-check) |

## 应用容器化 (v0.13.2 起)

- 应用镜像由根目录 `Dockerfile` 多阶段构建(standalone 产物 + 全局 tsx/prisma CLI),`docker-compose.prod.yml` 的 `app` 服务以 **host 网络**运行,`.env` 里的 `127.0.0.1:5432/9000` 零改动可用。
- 日常部署仍是 `scripts/prod/deploy.sh` 一条命令,内部变为:git pull → `docker build` → 一次性容器跑 `prisma migrate deploy` 与 `release:publish` → `docker compose up -d app`。
- 回滚:`docker tag qt-app:<旧版本> qt-app:latest && docker compose -f docker-compose.prod.yml up -d app`(镜像 tag 保留最近 3 个版本)。
- 宿主机 nginx 不动,上游仍是 `127.0.0.1:3000`;cron 的 curl 目标也不变。
- 容器日志:`docker logs -f qt-app`(替代 `journalctl -u qt-app`)。

## 安装步骤 (Aliyun ECS 单主机, 用户 `qt`, 工作目录 `/opt/qt`)

```bash
# 1) 应用(Docker)
docker compose -f docker-compose.prod.yml up -d app
docker logs -f qt-app                  # 实时日志

# 2) 定时任务 (安装前请确认 .env 里已设置 CRON_SECRET, 与 NextAuth / 内部 API 鉴权一致)
sudo cp ops/qt-jobs.cron /etc/cron.d/qt-jobs
sudo chmod 644 /etc/cron.d/qt-jobs
# cron.d 不需重启,直接生效; 用 systemctl status crond 确认 crond 在跑 (RHEL/CentOS/Aliyun Linux; Debian/Ubuntu 用 systemctl status cron)
cat /etc/cron.d/qt-jobs               # 检查变量 ${CRON_SECRET} 会被 cron 展开
```

## 注意事项

- **`/opt/qt/.env` 必须含**:`DATABASE_URL`、`MIGRATION_DATABASE_URL`、`MINIO_ACCESS_KEY`、`MINIO_SECRET_KEY`、`CRON_SECRET`(在 `/etc/cron.d/qt-jobs` 中被引用)、`NEXTAUTH_SECRET`、`NEXTAUTH_URL`。
- **`qt-app.service` 走 `pnpm start`**(等同 `next start`)。如改用 `node node_modules/next/dist/bin/next start`,记得改 `ExecStart`。
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
  `deploy.sh` 会自动兼容两种命名,无须手动判断。
- **修改 ops/ 下文件后**:`git commit && git push`,生产端 `cd /opt/qt && sudo git pull` 再 `sudo cp ops/* /etc/...`。
- **不要把生产 secret 写进仓库**:`.env` 在 `.gitignore` 里,这里只引用变量名。
