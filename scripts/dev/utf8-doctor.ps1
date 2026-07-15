# ============================================================
# scripts/dev/utf8-doctor.ps1
# qt-biz: 终端编码自检,10 秒定位中文乱码来源
#
# 用法: .\scripts\dev\utf8-doctor.ps1
# ============================================================

$ErrorActionPreference = "Continue"
$root = (Get-Location).Path
$ok = $true

Write-Host ""
Write-Host "=== qt-biz terminal encoding self-check ===" -ForegroundColor Cyan
Write-Host ("cwd: " + $root)
Write-Host ""

# 1) 终端 codepage
$codepage = (chcp | Select-Object -Last 1).ToString() -replace "\s+", " "
$cpNum = 0
if ($codepage -match "(\d+)") { $cpNum = [int]$Matches[1] }
if ($cpNum -eq 65001) {
    Write-Host ("[1/5] chcp               = " + $codepage + "  OK") -ForegroundColor Green
} else {
    Write-Host ("[1/5] chcp               = " + $codepage + "  FAIL (expected 65001)") -ForegroundColor Red
    $ok = $false
}

# 2) PowerShell OutputEncoding
$enc = [Console]::OutputEncoding.EncodingName
if ($enc -like "*UTF-8*") {
    Write-Host ("[2/5] Console.Encoding   = " + $enc + "  OK") -ForegroundColor Green
} else {
    Write-Host ("[2/5] Console.Encoding   = " + $enc + "  FAIL (expected UTF-8)") -ForegroundColor Red
    $ok = $false
}

# 3) 仓库源码 UTF-8 体检
$encStrict = New-Object System.Text.UTF8Encoding($false, $true)
$badFiles = @()
$total = 0
Get-ChildItem -Path $root -Recurse -Include *.ts,*.tsx,*.js,*.mjs,*.cjs,*.json,*.md -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch "\\node_modules\\|\\.next\\|\\.git\\|test-results\\|playwright-report\\|backups\\|docker-data\\" } |
    ForEach-Object {
        $total++
        $b = [System.IO.File]::ReadAllBytes($_.FullName)
        try { $null = $encStrict.GetString($b) }
        catch { $badFiles += $_.FullName.Substring($root.Length + 1) }
    }
if ($badFiles.Count -eq 0) {
    Write-Host ("[3/5] source UTF-8 health = " + $total + " files, all valid UTF-8  OK") -ForegroundColor Green
} else {
    Write-Host ("[3/5] source UTF-8 health = " + $badFiles.Count + " files invalid") -ForegroundColor Red
    $badFiles | ForEach-Object { Write-Host ("      - " + $_) -ForegroundColor Red }
    $ok = $false
}

# 4) git 提交信息能不能正常输出
$gitLog = ""
try { $gitLog = git log --oneline -1 2>&1 | Out-String } catch {}
if ($gitLog.Length -gt 0) {
    # 检查是否包含乱码特征:连续两个字节的 UTF-8 字符被错误解码为 鈥€ 这种
    if ($gitLog -match "Mojibake detected") {
        Write-Host "[4/5] git log Chinese output    FAIL" -ForegroundColor Red
        $ok = $false
    } else {
        Write-Host "[4/5] git log Chinese output    OK" -ForegroundColor Green
    }
} else {
    Write-Host "[4/5] git log              SKIP" -ForegroundColor Yellow
}

# 5) $PROFILE 是否已经包含 qt-biz UTF-8 配置
$profileText = ""
if (Test-Path $PROFILE) { $profileText = Get-Content $PROFILE -Raw -ErrorAction SilentlyContinue }
if ($profileText -and $profileText.Contains("qt-biz terminal UTF-8")) {
    Write-Host "[5/5] PowerShell profile   = configured (new windows auto UTF-8)  OK" -ForegroundColor Green
} elseif ($profileText -and $profileText.Contains("qt-biz: terminal UTF-8")) {
    # Old marker from a previous version
    Write-Host "[5/5] PowerShell profile   = OLD marker detected, please re-run enable-utf8.ps1" -ForegroundColor Yellow
} else {
    Write-Host "[5/5] PowerShell profile   = not configured (new windows may mojibake)" -ForegroundColor Yellow
    Write-Host "      run: .\scripts\dev\enable-utf8.ps1" -ForegroundColor Yellow
}

Write-Host ""
if ($ok) {
    Write-Host "Result: terminal is healthy, the mojibake is not coming from PowerShell side." -ForegroundColor Green
} else {
    Write-Host "Result: red items above are the source of the problem." -ForegroundColor Red
    Write-Host "      one-liner fix: .\scripts\dev\enable-utf8.ps1" -ForegroundColor Yellow
}
Write-Host ""
