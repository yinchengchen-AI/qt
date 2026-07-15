# 中文乱码排障 Runbook

> 适用:`qt-biz` 全栈 (Next.js 16 + Node 20 + Windows / macOS / Linux 终端)。

## TL;DR

源码已经全部是合法 UTF-8 (本仓库 565 个 .ts/.tsx/.js/.json/.md 已通过字节级校验)。
如果看到"乱码",**几乎一定是终端 / 编辑器那一层把 UTF-8 字节按错编码解码**,不是应用 bug。
先按下面三步走,90% 的情况立刻解决。

---

## 1. 现象 vs. 真因

| 你看到的 | 实际原因 | 修哪里 |
|---|---|---|
| PowerShell 里 `git log` / `Get-Content xxx.ts` / `pnpm dev` 输出 `璁＄畻...` 这种方块 | Windows console codepage 是 936 (GB2312),把 UTF-8 字节按 GB2312 解码 | 终端 codepage (本文档 §2) |
| VS Code 集成终端里中文乱码 | VS Code 默认跟随系统 codepage,需显式设 `terminal.integrated.env.windows` | VS Code 设置 (本文档 §3) |
| Git-Bash (mintty) 里中文乱码 | mintty 默认不是 UTF-8,需在 options 里把 locale 改成 zh_CN.UTF-8 或 en_US.UTF-8 | mintty 设置 (本文档 §4) |
| macOS / Linux 终端中文乱码 | 终端 app (iTerm2 / Terminal.app) 的字符编码不是 UTF-8 | 终端 app 设置 (本文档 §5) |
| **浏览器页面里**某段中文显示 `???` / `锟斤拷` / `ä¸­æ–‡` | 真应用 bug,几乎都是某个 HTTP 头 / 数据库字段 / 文件名 metadata 没走 UTF-8 | 先按 §6 自查,复现后联系开发 |
| 导出 .xlsx / .csv 用 Excel 打开是乱码,但浏览器里正常 | Excel 默认按系统 ANSI 解读 CSV,没识别 UTF-8 | 导出层加 UTF-8 BOM,或提醒用户用"数据 → 自文本" |

---

## 2. PowerShell 一键修复 (推荐)

打开 PowerShell,执行:

```powershell
chcp 65001
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$PSDefaultParameterValues[''Out-File:Encoding''] = ''utf8''
```

立刻验证:

```powershell
git log --oneline -3          # 提交信息里的中文应正常
Get-Content lib/i18n.ts -TotalCount 3   # 文件里的中文注释应正常
```

**永久生效**:把下面三行加到 PowerShell profile:

```
# === qt-biz terminal UTF-8 ===    (ASCII marker, 幂等检测用)
chcp 65001 | Out-Null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$PSDefaultParameterValues[''Out-File:Encoding''] = ''utf8''
```

(标记块**必须用纯 ASCII**,否则 Windows PowerShell 5.1 解析器在
`.Contains("...")` / `Write-Host "..."` 里遇到中文字符会报
"The string is missing the terminator" 假错误。`scripts/dev/enable-utf8.ps1`
的标记已经按这个约定写好。)

或者直接跑项目里的一键脚本 (`enable-utf8.ps1` 标记块用 ASCII,重复跑幂等):

```powershell
.\scripts\dev\enable-utf8.ps1
```

(脚本是幂等的,重复跑不会重复写入 profile。)

---

## 3. VS Code 集成终端

在 `.vscode/settings.json` (用户级或工作区级) 加入:

```jsonc
{
  "terminal.integrated.env.windows": {
    "LANG": "C.UTF-8",
    "LC_ALL": "C.UTF-8",
    "PYTHONIOENCODING": "utf-8"
  },
  "terminal.integrated.defaultProfile.windows": "PowerShell",
  "files.encoding": "utf8",
  "files.autoGuessEncoding": false
}
```

`files.autoGuessEncoding: false` 防止 VS Code 误判已有 UTF-8 文件为 GBK 重新保存。
本仓库已经全部是合法 UTF-8,**绝对不要让 VS Code 触发"以 GBK 重新载入"**。

---

## 4. Git-Bash (mintty)

右键标题栏 → Options → Text → Locale 改为 `zh_CN` 或 `en_US` (任一 UTF-8 版本);
Character set 选 `UTF-8`。保存后重启 mintty。

或者在 `~/.bashrc` 顶部加:

```bash
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
```

> 注:`scripts/dev/dev-up.sh` 已经在脚本内显式 `export LANG="${LANG:-C.UTF-8}"`,
> 即使外部环境没设好,dev-up 启动的 `next dev` 进程也会拿到 UTF-8 locale。

---

## 5. macOS / Linux

终端 (Terminal.app / iTerm2 / GNOME Terminal) 的字符编码选 UTF-8。
`~/.bashrc` / `~/.zshrc` 顶部加:

```bash
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8
```

WSL (Ubuntu) 用户:在 `/etc/default/locale` 里设 `LANG=en_US.UTF-8`,然后 `sudo locale-gen`。

---

## 6. 如果乱码出现在**浏览器**里 (不是终端)

按下面顺序排查,不要上来就改应用代码:

1. 打开浏览器 DevTools → Network → 选中对应 API → 看 Response Headers:
   - `Content-Type` 必须带 `charset=utf-8` (HTML) 或 `application/json; charset=utf-8`
   - 缺 charset 就在 `next.config.mjs` 的 `headers()` 函数里补
2. 看 Response body → 浏览器看到的字节本身是不是 UTF-8:
   - DevTools → Network → Response → 点 "view source",看是不是乱码
   - 如果是,问题在 server 端 (Prisma / MinIO metadata / JSON.stringify)
3. 浏览器 `<html>` 顶部有 `<meta charset="utf-8">` 吗?Next.js 16 默认就有,但 SSR 注入失败时要检查。
4. 数据库里查:打开 `psql` → `\l` 看 `qt_biz` 的 `Encoding` 是不是 `UTF8`,`Collate` 是不是 `zh_CN.UTF-8`。
   不是就 `ALTER DATABASE qt_biz SET LC_COLLATE = ''zh_CN.UTF-8'';` (需要在 initdb 时就传,事后改不动)。

**本仓库已确认正确的点 (无需改动):**

- `lib/excel.ts` `attachmentHeader()` 已经用 RFC 5987 的 `filename*=UTF-8''<percent-encoded>`
  发送中文 .xlsx 文件名,Chrome / Edge / Firefox / Safari 都看 `filename*`。
- `lib/upload-client.ts` 走 Next.js proxy → `/api/files/upload/[id]`,MinIO
  PutObjectCommand 的 ContentType / Metadata 全程 UTF-8。
- 所有 server action / route handler 走 `Response` / `NextResponse.json()`,Next 16
  默认带 `Content-Type: application/json; charset=utf-8`。
- Prisma 连接串没有 `?client_encoding=` 参数,走 PostgreSQL 默认 UTF8。

---

## 7. 自检脚本

本仓库提供 `scripts/dev/utf8-doctor.ps1` (Windows) 和
`scripts/dev/utf8-doctor.sh` (macOS / Linux / Git-Bash),跑一遍能 10 秒内定位问题:

```powershell
# Windows / PowerShell
.\scripts\dev\utf8-doctor.ps1
```

```bash
# macOS / Linux / Git-Bash
bash scripts/dev/utf8-doctor.sh
```

输出会告诉你:

- 当前终端 codepage (期望 65001)
- PowerShell `Console.OutputEncoding` (期望 UTF-8)
- git 是否能正常输出中文提交信息
- 仓库源码里有没有非 UTF-8 文件 (期望 0)

---

## 8. 修改记录

- v0.9.6: 新增本文档 + `scripts/dev/enable-utf8.ps1` + `scripts/dev/utf8-doctor.ps1/.sh`;
  `scripts/dev/dev-up.sh` 顶部追加 `export LANG/LC_ALL=C.UTF-8`。
