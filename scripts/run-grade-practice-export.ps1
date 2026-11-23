<#
.SYNOPSIS
    執行一次中四每日作答匯出，並把輸出及錯誤寫入日誌（供 Windows 工作排程器呼叫）。

.DESCRIPTION
    由 `schedule-grade-practice-export.ps1` 註冊的排程呼叫。本身亦可手動執行：

        ./scripts/run-grade-practice-export.ps1 -OutDir "D:\匯出"
        ./scripts/run-grade-practice-export.ps1 -OutDir "D:\匯出" -Date 2026-11-19
        ./scripts/run-grade-practice-export.ps1 -OutDir "D:\匯出" -PreviousDay

    預設（不使用任何日期參數）按交付規則統計：
      - **星期一**：上一個工作週（上星期一至五）——07:45 時本週才開始，本週累計必然是 0；
      - **星期二至五**：前一日，以及本週一至前一日的累計。
    `-Date`／`-PreviousDay`／`-Week` 只供手動或診斷使用。

    日誌檔：`<OutDir>\logs\export-<YYYY-MM-DD>.log`（每次執行附加，失敗時保留完整輸出）。
    離開碼：0 = 成功；1 = 失敗（排程的「上次執行結果」會顯示）。
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$OutDir,
    [string]$Form = "4",
    [string]$NodeExe = "npm.cmd",
    # 手動指定單一統計日期（YYYY-MM-DD）；留空時按交付規則統計（見 .DESCRIPTION）。
    [string]$Date = "",
    # 只統計前一日（手動用；排程本身在星期二至五已包含前一日）
    [switch]$PreviousDay,
    # 只統計本週一至今日的累計（手動用）
    [switch]$Week,
    # 收件人（多個以分號或逗號分隔）。留空 = 使用 secrets\export-mail.env 的 EXPORT_EMAIL_TO。
    [string]$EmailTo = "",
    # 只寫本機檔案、不寄電郵（例如除錯）
    [switch]$NoEmail,
    # 沒有設定收件人時只警告而不失敗（預設：失敗，避免「以為已派發」）
    [switch]$AllowNoEmail
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
$rangeArgs = @()
if (-not [string]::IsNullOrWhiteSpace($Date)) {
    $rangeArgs = @("--date", $Date)
    Write-Log "統計日期：$Date（手動指定）"
} elseif ($PreviousDay) {
    $previous = (Get-Date).AddDays(-1).ToString("yyyy-MM-dd")
    $rangeArgs = @("--date", $previous)
    Write-Log "統計日期：$previous（前一日，手動指定）"
} elseif ($Week) {
    $rangeArgs = @("--week")
    Write-Log "統計範圍：本週一至今日（累計，手動指定）"
} else {
    $rangeArgs = @("--schedule")
    $weekday = (Get-Date).DayOfWeek
    if ($weekday -eq [System.DayOfWeek]::Monday) {
        Write-Log "統計範圍：上星期一至五（星期一交付規則）"
    } else {
        Write-Log "統計範圍：前一日＋本週一至前一日累計（交付規則）"
    }
}

$arguments = @("run", "--silent", "export:grade-daily", "--", "--form", $Form, "--out", $OutDir) + $rangeArgs
if ($NoEmail) {
    $arguments += "--no-email"
} elseif (-not [string]::IsNullOrWhiteSpace($EmailTo)) {
    $arguments += @("--email-to", $EmailTo)
}

Push-Location $RepoRoot
try {
    # 原生指令（npm）會把進度寫到 stderr；若保持 ErrorActionPreference=Stop，
    # PowerShell 會把每一行 stderr 當成終止錯誤，令成功的匯出被誤報為失敗。
    $ErrorActionPreference = "Continue"
    $output = & $NodeExe @arguments 2>&1
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    foreach ($line in @($output)) { Write-Log "  $line" }
    if ($exitCode -ne 0) {
        Write-Log "失敗：exit=$exitCode（詳見上方輸出；常見原因：secrets\export-mail.env 未設定或 SMTP 認證失敗）"
        exit 1
    }
    $delivered = @($output | Where-Object { "$_" -match "已以電郵派發" }).Count -gt 0
    if (-not $delivered -and -not $NoEmail) {
        if ($AllowNoEmail) {
            Write-Log "警告：未派發電郵（沒有設定收件人）。"
        } else {
            Write-Log "失敗：沒有派發電郵。請設定 secrets\export-mail.env 的 EXPORT_EMAIL_TO 及 EXPORT_SMTP_*，或明確使用 -NoEmail。"
            exit 1
        }
    }
    Write-Log "完成。"
    exit 0
} catch {
    Write-Log "失敗：$($_.Exception.Message)"
    exit 1
} finally {
    Pop-Location
}
