<#
.SYNOPSIS
    執行一次中四每日作答匯出，並把輸出及錯誤寫入日誌（供 Windows 工作排程器呼叫）。

.DESCRIPTION
    由 `schedule-grade-practice-export.ps1` 註冊的排程呼叫。本身亦可手動執行：

        ./scripts/run-grade-practice-export.ps1 -OutDir "D:\匯出"

    日誌檔：`<OutDir>\logs\export-<YYYY-MM-DD>.log`（每次執行附加，失敗時保留完整輸出）。
    離開碼：0 = 成功；1 = 失敗（排程的「上次執行結果」會顯示）。
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$OutDir,
    [string]$Form = "4",
    [string]$NodeExe = "npm.cmd"
)

$ErrorActionPreference = "Stop"

# 工作排程以非互動方式執行時，主控台預設用 ANSI／OEM 編碼解讀原生指令輸出，
# 中文（例如「已匯出…」）會寫成亂碼。固定為 UTF-8 後日誌可正常閱讀。
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 > $null

$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $OutDir "logs"
New-Item -ItemType Directory -Force -Path $OutDir, $LogDir | Out-Null

$stamp = Get-Date -Format "yyyy-MM-dd"
$logPath = Join-Path $LogDir "export-$stamp.log"

function Write-Log([string]$Text) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Text
    Add-Content -LiteralPath $logPath -Value $line -Encoding utf8
    Write-Host $line
}

Write-Log "開始匯出中${Form}每日作答情況 → $OutDir"
Push-Location $RepoRoot
try {
    # 原生指令（npm／gcloud）會把進度寫到 stderr；若保持 ErrorActionPreference=Stop，
    # PowerShell 會把每一行 stderr 當成終止錯誤，令成功的匯出被誤報為失敗。
    $ErrorActionPreference = "Continue"
    $output = & $NodeExe run --silent export:grade-daily -- --form $Form --out $OutDir 2>&1
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    foreach ($line in @($output)) { Write-Log "  $line" }
    if ($exitCode -ne 0) {
        Write-Log "失敗：exit=$exitCode"
        exit 1
    }
    Write-Log "完成。"
    exit 0
} catch {
    Write-Log "失敗：$($_.Exception.Message)"
    exit 1
} finally {
    Pop-Location
}
