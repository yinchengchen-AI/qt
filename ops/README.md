# 生产运维文件 (ops/)

本目录集中存放生产服务器 /etc 下的配置文件,**仓库内只是模板**,安装时由人工 cp 到对应位置。

## 文件清单

| 文件 | 安装位置 | 用途 |
|------|---------|------|
| `qt-app.service`   | `/etc/systemd/system/qt-app.service` | Next.js 服务单元 |
| `qt-jobs.cron`     | `/etc/cron.d/qt-jobs`                | 定时任务 (job runner + backup + audit + cert-check) |

## 安装步骤 (Aliyun ECS 单主机, 用户 `qt`, 工作目录 `/opt/qt`)

```bash
# 1) systemd 服务
sudo cp ops/qt-app.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now qt-app
sudo systemctl status qt-app          # 应为 active (running)
journalctl -u qt-app -f               # 实时日志

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
