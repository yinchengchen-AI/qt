# ============================================================
# scripts/dev/enable-utf8.ps1
# qt-biz: 强制当前 PowerShell 用户 UTF-8 终端
#
# 作用:
#   1) 在当前 session 内立即生效 (chcp 65001 + Console.OutputEncoding = UTF-8)
#   2) 幂等地把同样的设置追加到 $PROFILE,新开的 PowerShell 也默认 UTF-8
#
# 用法 (在仓库根目录):
#   .\scripts\dev\enable-utf8.ps1
#
# 幂等:重复运行不会重复追加 profile 块。
# 卸载:从 $PROFILE 删掉 "# === qt-biz terminal UTF-8 ===" 块即可。
# ============================================================

$ErrorActionPreference = "Stop"

# 1) 当前 session 立即生效
chcp 65001 | Out-Null
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
    Write-Warning ("[enable-utf8] could not set OutputEncoding: " + $_.Exception.Message)
}
$PSDefaultParameterValues["Out-File:Encoding"] = "utf8"

# 2) 把配置追加到 $PROFILE (幂等)
$markerBegin = "# === qt-biz terminal UTF-8 ==="
$markerEnd   = "# === /qt-biz terminal UTF-8 ==="

if (-not (Test-Path $PROFILE)) {
    New-Item -ItemType File -Path $PROFILE -Force | Out-Null
    Write-Host ("[enable-utf8] created $PROFILE")
}

$profileText = ""
if (Test-Path $PROFILE) {
    $profileText = Get-Content $PROFILE -Raw -ErrorAction SilentlyContinue
}

if ($profileText -and $profileText.Contains($markerBegin)) {
    Write-Host "[enable-utf8] $PROFILE already has qt-biz UTF-8 block, skipping (idempotent)"
} else {
    $block = @"

$markerBegin
# 解决 Windows PowerShell 默认 codepage 936 把 UTF-8 字节按 GB2312 解码
# 导致 git log / Get-Content / pnpm dev 输出中文乱码的问题。
# 重复运行此脚本是安全的:本块只在 profile 里出现一次。
chcp 65001 | Out-Null
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    `$OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}
$PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'
$markerEnd
"@
    Add-Content -Path $PROFILE -Value $block -Encoding utf8
    Write-Host ("[enable-utf8] wrote to $PROFILE (new PowerShell will auto-UTF-8)")
}

# 3) 验证
$verify = @{
    "Console.OutputEncoding" = [Console]::OutputEncoding.EncodingName
    "chcp"                   = (chcp | Select-Object -Last 1).Trim()
    "Profile"                = $PROFILE
}
Write-Host ""
Write-Host "[enable-utf8] Current session state:"
$verify.GetEnumerator() | ForEach-Object { Write-Host ("  {0,-22} = {1}" -f $_.Key, $_.Value) }
Write-Host ""
Write-Host "[enable-utf8] done."
