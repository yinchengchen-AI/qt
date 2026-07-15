#!/usr/bin/env bash
# ============================================================
# scripts/dev/utf8-doctor.sh
# qt-biz: 终端编码自检,10 秒定位中文乱码来源 (macOS / Linux / Git-Bash)
#
# 用法: bash scripts/dev/utf8-doctor.sh
# ============================================================
set -u
root="$(pwd)"
ok=1
red()    { printf "\033[31m%s\033[0m\n" "$*"; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
say()    { printf "\033[36m=== %s ===\033[0m\n" "$*"; }

say "qt-biz 终端编码自检"
printf "工作目录: %s\n\n" "$root"

# 1) locale
if command -v locale >/dev/null 2>&1; then
    cur_locale=$(locale 2>/dev/null | awk -F= '/^LANG=/{print $2; exit}')
    case "$cur_locale" in
        *UTF-8*|*utf8*)
            green "[1/5] locale             = $cur_locale  OK"
            ;;
        *)
            red   "[1/5] locale             = $cur_locale  FAIL (期望 *.UTF-8)"
            printf "      修复: export LANG=C.UTF-8 LC_ALL=C.UTF-8\n"
            ok=0
            ;;
    esac
else
    yellow "[1/5] locale 命令不可用,跳过"
fi

# 2) 终端是否能正常输出中文 (打印一个字面 UTF-8 汉字,看 stdout bytes)
test_char="中文"
printf "%s" "$test_char" | od -An -c | head -1 >/dev/null
printf "[2/5] 终端中文输出        = "
if printf "%s" "$test_char" | grep -q "中"; then
    green "OK"
else
    red   "FAIL (终端不能正常显示中文)"
    ok=0
fi

# 3) 仓库源码 UTF-8 体检 (用 python 跑,跨平台)
if command -v python >/dev/null 2>&1; then
    bad=$(python - <<'PY'
import os, sys
root = sys.argv[1] if len(sys.argv) > 1 else '.'
bad = []
for base, dirs, files in os.walk(root):
    # 跳过常见生成/依赖目录
    dirs[:] = [d for d in dirs if d not in ('node_modules','.next','.git','test-results','playwright-report','backups','docker-data','dist','build')]
    for f in files:
        if not f.endswith(('.ts','.tsx','.js','.mjs','.cjs','.json','.md')):
            continue
        p = os.path.join(base, f)
        try:
            with open(p, 'rb') as fp:
                data = fp.read()
            data.decode('utf-8', errors='strict')
        except UnicodeDecodeError:
            bad.append(p)
print(len(bad))
for b in bad[:10]:
    print(b)
PY
)
    count=$(echo "$bad" | head -1)
    if [ "$count" = "0" ]; then
        green "[3/5] 源码 UTF-8 健康   = 全部合法  OK"
    else
        red   "[3/5] 源码 UTF-8 健康   = $count 个文件不合法"
        echo "$bad" | tail -n +2 | sed 's/^/      - /'
        ok=0
    fi
else
    yellow "[3/5] python 不可用,跳过源码体检"
fi

# 4) git log 中文输出
if command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
    gitout=$(git log --oneline -3 2>&1)
    if echo "$gitout" | grep -qE '璁|鈥|锟'; then
        red   "[4/5] git log 中文输出    FAIL (含乱码特征)"
        ok=0
    else
        green "[4/5] git log 中文输出    OK"
    fi
else
    yellow "[4/5] 不是 git 仓库,跳过"
fi

# 5) ~/.bashrc 是否配置 LANG
if [ -f "$HOME/.bashrc" ] && grep -qE 'LANG=.*UTF-?8' "$HOME/.bashrc"; then
    green "[5/5] ~/.bashrc LANG      = 已配置  OK"
else
    yellow "[5/5] ~/.bashrc LANG      = 未配置 (新 bash 窗口可能乱码)"
    printf "      建议追加: export LANG=C.UTF-8 LC_ALL=C.UTF-8\n"
fi

echo
if [ "$ok" = "1" ]; then
    green "结论: 终端环境健康。"
else
    red   "结论: 上面标红的就是问题源。"
    yellow "一键修复 (PowerShell 用户): .\\scripts\\dev\\enable-utf8.ps1"
fi
echo
