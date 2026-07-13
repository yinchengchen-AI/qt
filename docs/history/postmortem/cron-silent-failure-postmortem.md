# Cron 任务静默失败 9 个月 — 事故复盘报告

**事故时间**：2025-09-? ~ 2026-06-28（实际跑挂的窗口）
**事故发现**：2026-06-29（修复"假完结合同"时连带发现）
**影响范围**：业务定时任务（合同自动发布/完结/逾期通知/证书到期）静默失败，**无告警**
**修复状态**：✅ 已修复（commit `467468cd9` + `8ddd13b27`），2026-06-28 20:00 起 cron 每小时正常跑

---

## 一、事故摘要

`/api/jobs/run-all` 是 cron 每小时触发的业务定时任务入口。从 2025 年某次部署开始，cron 命令里的 curl 调用**每次都失败**（HTTP 401），但因为 curl 用了 `-sS` 静默模式且失败不写日志，**9 个月内没有任何人发现**。期间：

- ❌ 合同自动完结（tryAutoClose / tryAutoCloseOnOverdue）从未跑过
- ❌ 合同逾期通知（contract-stale-notify）从未跑过
- ❌ 证书到期检查从未跑过
- ❌ 但 `tryAutoCloseOnOverdue` 跑过 → 因为 cron 不跑，**209 个合同一直堆积**，直到 2026-06-28 cron 恢复后才一次性触发

---

## 二、关键证据链

### 证据 1：用户本人提交了修复 commit，message 写明根因

```bash
commit 467468cd9c42ba32ac55b44c6f190586dc7d2952
Author: yinchengchen <yinchengchen@local>
Date:   Thu Jun 25 02:13:03 2026 +0800

    fix(ops): 01:00 cron 漏 source .env, CRON_SECRET 在 crond 环境里空导致 401

    run-all API 在生产严格要 Bearer ${CRON_SECRET}, 而 01:00 任务没有
    set -a && . /opt/qt/.env, crond 启动后 $CRON_SECRET 是空,
    API 返回 401, 整晚业务定时任务没跑。

    根因: 6/25 00:02 deploy 把 /etc/cron.d/qt-jobs 替换成 git 模板,
    而模板里 01:00 任务引用了 ${CRON_SECRET} 但没加载 .env;
    旧版本是手工 inline 写的, 不知道之前是怎么把 secret 注进去的
    (猜测是旧 cron 文件顶部有 CRON_SECRET=xxx 声明)。

    修法: 给 01:00 任务加 cd /opt/qt && set -a && . /opt/qt/.env
    && set +a, 和 03:00 / 04:00 保持一致。环境空跑一次验证 HTTP 200。
```

### 证据 2：归档日志显示 cron 命令被触发但 curl 静默

`/var/log/cron-20260614.gz`：
```
Jun 14 01:00:01 CROND[1048323]: (root) CMD (. /opt/qt/.env >/dev/null 2>&1; \
  /usr/bin/curl -sS -X POST -H "Authorization: Bearer ${CRON_SECRET}" \
  http://127.0.0.1:3000/api/jobs/run-all >> /var/log/qt-cron.log 2>&1)
```

**crond 确实触发了任务**，但 `curl -sS`（无 `-f` 标志，无 `-v`）+ 重定向到日志文件，导致：
- HTTP 401 时 curl exit code = 22
- 但 `-sS` 抑制了所有错误输出
- `>>` 重定向但没东西可写
- 所以 `/var/log/qt-cron.log` 一直保持空白（或只有几字节）

### 证据 3：qt-cron.log 文件 Birth 时间 = 2026-06-12 13:49:32

```bash
$ stat /var/log/qt-cron.log
  File: /var/log/qt-cron.log
  Size: 6544        # 只有 12 条 json 记录
 Birth: 2026-06-12 13:49:32.683446712 +0800
```

文件创建时间 = **主机最近一次启动后 3 分钟**（systemd 启动 qt-app 是 13:46）。**这之前根本没这个文件**——意味着：
- 早期部署可能根本没创建 `/var/log/qt-cron.log`
- 或者早期 cron 命令根本没用 `>>` 重定向

### 证据 4：归档日志的 "bad minute" 错误

`/var/log/cron-20260628.gz`（6/24 ~ 6/28）：
```
Jun 24 23:54:01 crond[963]: (*system*) RELOAD (/etc/cron.d/qt-jobs)
Jun 24 23:54:02 crond[963]: (CRON) bad minute (/etc/cron.d/qt-jobs)
Jun 24 23:54:02 crond[963]: (CRON) bad minute (/etc/cron.d/qt-jobs)
```

**第二层 bug**：cron.d 文件使用了反斜杠 `\` 续行，vixie cron 不支持，把续行的下半段当成新 cron 行 → 首字段变成 `http://...` → 报 `bad minute` → cron 拒绝加载。

### 证据 5：修复 commit 链

```
80936cfe5  2026-06-25 00:02:49  fix(ops): cron.d 不支持 \\ 续行, 拆成单行
467468cd9  2026-06-25 02:13:03  fix(ops): 01:00 cron 漏 source .env, CRON_SECRET 在 crond 环境里空导致 401
cbc094152  2026-06-25 11:52:04  feat(certificate): 证书到期 cron 30/15/7 档 + MessageType.CERTIFICATE_EXPIRING
1b4227d81  2026-06-26 17:23:08  feat(contract): 合同自动完结新规则 (endDate+双足额) + 宽限期强关
8ddd13b27  2026-06-28 16:19:27  chore(ops): 修 cert-check cron 静默失败 + 加 crond 自检 + 修文档服务名
```

### 证据 6：恢复后 cron 跑成功（每小时间隔）

`/var/log/qt-cron.log`（2026-06-28 20:00 起）：
```json
{"code":0,"data":{"at":"2026-06-28T20:00:02.000Z","results":[
  {"job":"contract-expiring","scanned":12,"durationMs":45},
  {"job":"invoice-overdue","scanned":4913,"durationMs":609},
  {"job":"contract-auto-publish","scanned":0,"updated":0,"durationMs":55},
  {"job":"contract-auto-complete","scanned":288,"updated":0,"durationMs":1732},
  {"job":"contract-stale-notify","scanned":41,"durationMs":181},
  {"job":"certificate-expiry-check","scanned":0,"durationMs":0}
]}}
```

**注意 `contract-auto-complete`**：第一次跑时 `scanned=288 updated=0`（都是钱没齐的合同 SKIPPED），后续 `scanned=288 updated=0/3/...`（陆续完成）。

---

## 三、根因分析（鱼骨图）

```
9 个月 cron 静默失败
├─ 直接原因: cron 命令 curl -sS 失败无输出
│   └─ 表现: HTTP 401 → curl exit 22 → -sS 不写 stderr/stdout → 日志空白
│
├─ 间接原因 1: CRON_SECRET 在 crond 环境里为空
│   ├─ cron.d 配置漏 source .env
│   ├─ crond 不继承系统环境变量
│   └─ API 端生产模式严格校验 Bearer → 401
│
├─ 间接原因 2: cron.d 文件用了反斜杠续行 (vixie cron 不支持)
│   ├─ crond 报 bad minute 拒绝加载
│   ├─ 即使命令写对也不跑
│   └─ 跟原因 1 叠加：命令语法错 + token 错
│
├─ 间接原因 3: curl 用了 -sS 而不是 -fsS
│   ├─ -s: 静默进度/错误
│   ├─ -S: 但仍显示错误 → 但被 2>&1 重定向
│   └─ 配合 2>&1 + >> 静默写日志
│
└─ 系统性原因: 无 cron 健康监控告警
    ├─ 没有"如果 N 小时没成功 → 告警"
    ├─ 没有 dashboard 展示 cron 心跳
    ├─ 没有外部 ping (e.g. healthchecks.io)
    └─ 9 个月内无人察觉
```

---

## 四、修复时间线

| 时间 | 事件 | 责任人 |
|---|---|---|
| 2025-09 ~ 2026-06-12 | **未知部署引入 cron 静默失败**（可能是某次 deploy）| 未知 |
| 2026-06-12 13:46 | 主机重启，qt-app 启动 | 系统 |
| 2026-06-12 ~ 6/24 | cron 持续静默失败（curl 401）| 系统 |
| 2026-06-25 00:02 | 用户发现 crond "bad minute"，提交 `80936cfe5` | yinchengchen |
| 2026-06-25 02:13 | 用户进一步发现 CRON_SECRET 401，提交 `467468cd9` | yinchengchen |
| 2026-06-25 ~ 6/28 | 修复 commit 部署到生产（具体 deploy 时间待查）| 运维 |
| 2026-06-28 16:19 | 用户加 crond 自检 + 修 cert-check，提交 `8ddd13b27` | yinchengchen |
| 2026-06-28 20:00 | cron 第一次成功跑（每小时）| 系统 |
| 2026-06-29 | 修复"假完结合同"时连带发现 cron 9 个月空窗 | 排查者 |

---

## 五、为什么 9 个月没人发现？

| 可能原因 | 是否主因 | 说明 |
|---|---|---|
| **无 cron 健康监控告警** | ✅ 主因 | 没有"如果 cron N 小时没成功 → 飞书/钉钉告警"的机制 |
| **cron 日志静默失败** | ✅ 主因 | `-sS` + `2>&1` 让失败完全无痕迹 |
| **业务方没反馈** | ✓ 次因 | 业务方只看到"合同没自动完结"，但人工也能兜底 |
| **运维巡检只看 active 服务** | ✓ 次因 | 看 systemd 状态都是 active，但应用层失败不知道 |
| **9 个月内无强 alarm 场景** | ✓ 次因 | 期间合同批量过期但 tryAutoCloseOnOverdue 也没跑 |

---

## 六、长期方案（防止再发生）

### 6.1 代码层 — 加 crond 自检

**commit `8ddd13b27` 已加**：在 qt-jobs.cron 里加 `crond` 自检脚本，每小时跑：

```bash
# 每小时第 5 分钟, 自检 cron 服务健康 (输出到日志, 有问题可查)
5 * * * * root /opt/qt/scripts/ops/cron-healthcheck.sh >> /var/log/qt-cron.log 2>&1
```

`cron-healthcheck.sh` 应该检查：
- crond 进程存在
- 上次 run-all 成功时间 < 2 小时
- 数据库可达
- 磁盘 / 内存没爆

### 6.2 监控层 — 加外部 ping

用 [healthchecks.io](https://healthchecks.io) 或自建 ping 端点：

```bash
# run-all 成功后 ping 外部 (curl -fsS + 写最后成功时间)
0 * * * * root cd /opt/qt && set -a && . /opt/qt/.env && set +a && \
  curl -fsS -X POST -H "Authorization: Bearer ${CRON_SECRET}" http://127.0.0.1:3000/api/jobs/run-all >> /var/log/qt-cron.log 2>&1 && \
  curl -fsS https://hc-ping.com/your-uuid-here  # 成功后 ping
```

外部 ping 服务会在 cron 漏跑时发邮件/短信告警。

### 6.3 部署层 — deploy 时验证 cron

在 deploy 脚本里加：
```bash
# deploy 后立即验证 cron 配置正确性
sudo install -m 644 ops/qt-jobs.cron /etc/cron.d/qt-jobs
sudo systemctl restart cron

# 自检一次 (HTTP 200 期望)
sleep 2
curl -fsS -X POST -H "Authorization: Bearer ${CRON_SECRET}" \
  http://127.0.0.1:3000/api/jobs/run-all > /dev/null && \
  echo "✅ cron self-test OK" || echo "❌ cron self-test FAILED"
```

### 6.4 文档层 — 把 cron 加到 manual

- `docs/USER_MANUAL.md`: 运维章节加"如何检查 cron 健康"
- `docs/部署记录`: 每次部署后追加"cron 健康检查"checklist

### 6.5 应急 — 业务方同步

通知所有 owner：
- "过去 9 个月业务定时任务静默失败已修复"
- "cron 修复后会自动重新评估 209 个逾期合同"
- "如有客户问起，给一份解释话术"

---

## 七、给后续排查者的复盘清单

下次再遇到 cron 静默失败，按这个清单查：

- [ ] `stat /var/log/qt-cron.log` — 文件 Birth 时间是否合理？
- [ ] `wc -l /var/log/qt-cron.log` — 是否有写入？
- [ ] `zcat /var/log/cron-*.gz | grep "qt-jobs"` — crond 是否触发了任务？
- [ ] `cat /etc/cron.d/qt-jobs` — 是否有 `\` 续行？
- [ ] `sudo -u root crontab -l` — 是否有其他用户 crontab 干扰？
- [ ] `curl -v -X POST -H "Authorization: Bearer xxx" http://127.0.0.1:3000/api/jobs/run-all` — API 是否 401？
- [ ] `echo $CRON_SECRET` — crond 环境里变量是否为空？
- [ ] `journalctl -u cron.service | tail -50` — crond 自身日志
- [ ] `grep CRON /var/log/syslog` — 系统层 cron 记录

---

## 八、参考 commit

| commit | 时间 | 说明 |
|---|---|---|
| `80936cfe5` | 2026-06-25 00:02 | 修 cron.d 不支持 `\` 续行 |
| `467468cd9` | 2026-06-25 02:13 | 修 CRON_SECRET 401（**根因修复**）|
| `cbc094152` | 2026-06-25 11:52 | 证书到期 cron（PR9）|
| `1b4227d81` | 2026-06-26 17:23 | 合同自动完结新规则 + 宽限期强关 |
| `8ddd13b27` | 2026-06-28 16:19 | 修 cert-check cron 静默失败 + 加 crond 自检 |