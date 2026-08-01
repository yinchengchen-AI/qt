# qt-biz 生产部署 — 当前流程 (v0.13.8+)

> 适用版本: v0.13.8 起。架构: 单机 ECS (Aliyun Linux 3), Next.js 应用 + PG/MinIO 全部容器化, host 网络。
>
> 历史事故档案 / 完整 ECS 装机步骤 / 早期部署记录: 见 [docs/ops/deploy-history/](deploy-history/)。

## 一、命令速查

| 动作 | 命令 |
|---|---|
| **本地 Mac 触发远端部署** (推荐, 用 QT.pem) | `./scripts/prod/remote-deploy.sh` |
| 本地 dry-run (只显示 ssh 配置, 不真跑) | `./scripts/prod/remote-deploy.sh --dry-run` |
| **server 上日常部署** (进 ssh 后) | `cd /opt/qt && sudo -E ./scripts/prod/deploy.sh` |
| 紧急回滚到上一版 | `bash /opt/qt/scripts/prod/rollback.sh` |
| 查看历史镜像版本 | `bash /opt/qt/scripts/prod/rollback.sh --list` |
| 回滚到指定版本 | `bash /opt/qt/scripts/prod/rollback.sh --to v0.13.6` |
| 看部署日志 | `tail -f /var/log/qt-deploy.log` |
| 看应用日志 | `docker logs -f qt-app` |
| 看 cron 自检日志 | `tail -f /var/log/qt-cron.log` |

## 二、deploy.sh 自动跑的 9 步

`deploy.sh` (236 行, 一条命令到底) 顺序执行:

```
1. preflight_check    # .env 完整性 / git 干净 / 磁盘 > 3G / 内存预警 / 容器健康
2. git pull --ff-only
3. preflight_check    # 再跑一次 (pull 后状态可能变)
4. source .env + derive POSTGRES_SUPER_PASSWORD/MINIO_ROOT_*
5. docker build qt-app:<version> + qt-app:latest    (零停机首选; OOM 才停容器)
6. docker compose up -d postgres minio             (基础设施兜底)
7. docker run --rm ... prisma migrate deploy       (一次性容器)
8. docker run --rm ... tsx scripts/release/publish.ts  (失败不阻断)
9. docker compose up -d app                         (滚动替换)
   + 磁盘清理 (image prune + qt-app 留 2 版 + builder cache 4GB 上限)
   + smoke_test                                     (login/dashboard/api/customers 三个 URL)
   + cron 健康检查                                   (/etc/cron.d/qt-jobs 含 source .env + run-all 自检)
```

任何步骤失败会**立刻退出非零**, 留下明确的修复提示。

## 三、本地触发远端 (v0.13.8+ 推荐)

**前置**: 把私钥放到约定路径, 加 600 权限。

```bash
# 默认读 ~/Downloads/QT.pem, 也支持 ~/.ssh/qt_deploy.pem
chmod 600 ~/Downloads/QT.pem    # 或 cp 到 ~/.ssh/qt_deploy.pem
```

**首次配置远端目标** (一次性):

```bash
cp .deploy-target.example .deploy-target       # 改里面的 DEPLOY_HOST/USER/PORT/PATH
```

`.deploy-target` 已被 `.gitignore` 忽略, 真实 host/IP 不进 git。

**触发部署**:

```bash
./scripts/prod/remote-deploy.sh                # 真触发
./scripts/prod/remote-deploy.sh --dry-run      # 只显示 ssh 命令
DEPLOY_HOST=116.62.160.24 ./scripts/prod/remote-deploy.sh --dry-run  # 覆盖环境变量
```

**机制**:
1. ssh 进 server, 拷贝 `deploy.sh` + `_lib.sh` 到 `/tmp/qt-deploy-pkg/`
2. 远端启动一个 tmux 会话跑 deploy.sh (避免本地断线中断 deploy)
3. 本地循环 `tmux capture-pane` 拿日志, 加 `[remote]` 前缀 stream 出来
4. 退出码通过 `EXIT=$?` 标记传回本地

想手动接管远端会话: `ssh ... -t tmux attach -t qt-deploy-<timestamp>`。

## 四、回滚

镜像保留最近 2 版 (`deploy.sh` 末尾 `KEEP=2`)。日常回滚:

```bash
bash /opt/qt/scripts/prod/rollback.sh                  # 默认切到上一版
bash /opt/qt/scripts/prod/rollback.sh --list           # 看历史
bash /opt/qt/scripts/prod/rollback.sh --to v0.13.6     # 指定版本
bash /opt/qt/scripts/prod/rollback.sh --skip-smoke     # 紧急回滚 (跳过 smoke test)
```

机制: `docker tag qt-app:<target> qt-app:latest && docker compose up -d app`。
smoke test 失败会自动回滚到回滚前的状态。

## 五、preflight 提前拦截的事故

| 检查项 | 阈值 | 失败时给的修法 |
|---|---|---|
| `.env` 存在 + 8 个关键 key | 全齐 | `cp .env.example .env` 后补全 |
| `git status` 干净 | 0 个改动 | `git stash` / `git commit` |
| 磁盘剩余 | ≥ 3 GB | `docker builder prune -af --keep-storage 2GB` |
| 可用内存 | ≥ 1500 MB (warn) | 停 `mysql-fineui` 等其它项目容器 |
| 容器健康 | `qt-postgres` + `qt-minio` healthy | deploy 会自动 `compose up -d` 拉起 |

历史教训:
- v0.13.6 (2026-07-29): build cache 累计 15.8GB 把 49G 盘写满 → 引入磁盘检查
- v0.9.7/v0.10.3/v0.13.4: 3.5GB 机器 Turbopack OOM → 引入内存检查 + OOM 重试
- 2025-09~2026-06: cron 静默失败 9 个月 → 部署后 cron 健康自检

## 六、远端机器上的常驻文件

| 路径 | 用途 |
|---|---|
| `/opt/qt/.env` | 数据库/MinIO/NextAuth secret (gitignore, 手工维护) |
| `/opt/qt/docker-compose.prod.yml` | 应用 + PG + MinIO 编排 |
| `/opt/qt/Dockerfile` | 多阶段镜像构建 |
| `/etc/cron.d/qt-jobs` | 5 个定时任务 (run-all/healthcheck/backup/audit/cert-check) |
| `/etc/nginx/conf.d/qt-biz.conf` | 上游 127.0.0.1:3000 反代 + 502 fallback |
| `/var/log/qt-deploy.log` | 部署日志 (deployed 路径, 跟 stdout 一致) |
| `/var/log/qt-cron.log` | cron 日志 (run-all/backup/healthcheck) |
| `/opt/qt/backups/` | 本地 PG dump 30 天滚动 + MinIO 镜像 |
| `/opt/qt/docker-data/postgres` | PG 16 数据卷 |

## 七、首次装机 (全新 ECS)

见 [docs/ops/deploy-history/v0.1.0-first-deploy.md](deploy-history/v0.1.0-first-deploy.md) (历史档案, 装机流程 v0.1.0 写过一次, 之后没变)。

涉及: Aliyun Linux 3 / Node 20+ / docker + compose 插件 / git / nginx / 时区 Asia/Shanghai。

## 八、未做但建议跟进

- **CI 自动化**: 目前是手动触发 (本地 Mac 跑 `remote-deploy.sh`), 没接 GitHub Actions
- **蓝绿部署**: 当前是 `docker compose up -d` 滚动替换; 想 0 downtime 加新实例 + nginx upstream switch
- **Feishu 部署通知**: deploy 开始/成功/失败时推 `FEISHU_WEBHOOK_URL` (现成的 webhook 已有, 部署侧没接)
- **Apline `next/image` sharp 镜像源**: Dockerfile 已经走 npmmirror, apk 走阿里源; 首次构建仍 3-4 分钟, 缓存复用后可降到 30s
- **MySQL/其它项目挤占编译内存**: 长期方案是把 `mysql-fineui` 等其它项目挪出本机或升配 4GB+; 否则每次部署靠 deploy.sh 停容器兜底
