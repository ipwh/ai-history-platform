<#
.SYNOPSIS
    每日自動匯出中四學生的一般練習作答情況（Excel），並註冊 Windows 工作排程器。

.DESCRIPTION
    步驟：
      1. 立即執行一次匯出（驗證服務帳戶金鑰讀取備份、Excel 產生及電郵派發）；
      2. 註冊／更新每日 07:45（香港時間）的 Windows 工作排程。

    輸出：`<輸出資料夾>\中四_每日作答_<日期>.xlsx`（本機備份），並以電郵派發同一份檔案
    （總表、班別統計、4A–4D 各一張工作表；重溫錯題不計入）。

    憑證：
      - 讀取正式備份使用**服務帳戶金鑰**（`secrets\export-reader-service-account.json`），
        不需要 `gcloud auth login`，亦不會過期；
      - 電郵設定放 `secrets\export-mail.env`（已列入 .gitignore），首次使用請填寫
        `EXPORT_SMTP_HOST`／`PORT`／`USER`／`PASSWORD`、`EXPORT_MAIL_FROM` 及 `EXPORT_EMAIL_TO`。

    為甚麼要先手動執行一次：
      可即時看到 SMTP 認證或收件人設定的錯誤，並在日誌留下紀錄，而不是等到翌日才發現沒有派發。

.EXAMPLE
    ./scripts/schedule-grade-practice-export.ps1 `
        -OutDir "$env:USERPROFILE\OneDrive - PO CHIU CATHOLIC SECONDARY SCHOOL\AI\學習記錄匯出" `
        -EmailTo "ipwh@pochiu.edu.hk"

.EXAMPLE
    # 只註冊排程、不立即執行
    ./scripts/schedule-grade-practice-export.ps1 -OutDir "D:\匯出" -SkipRun

.EXAMPLE
    # 移除排程
    ./scripts/schedule-grade-practice-export.ps1 -OutDir "D:\匯出" -Unregister
#>
[CmdletBinding()]
param(
    # Excel 輸出資料夾（建議放在 OneDrive 同步資料夾）
    [Parameter(Mandatory = $true)][string]$OutDir,
    # 年級（4 = 中四）
    [string]$Form = "4",
    # 每日執行時間（24 小時制）
    [string]$Time = "07:45",
    # 工作排程名稱
    [string]$TaskName = "AI History Platform - 中四每日作答匯出",
    # 電郵收件人（多個以分號分隔）。留空 = 使用 secrets\export-mail.env 的 EXPORT_EMAIL_TO。
    [string]$EmailTo = "",
    # 只註冊排程，不先執行一次
    [switch]$SkipRun,
    # 移除既定排程
    [switch]$Unregister
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Runner = Join-Path $PSScriptRoot "run-grade-practice-export.ps1"
$LogDir = Join-Path $OutDir "logs"

if (-not (Test-Path -LiteralPath $Runner)) {
    throw "找不到執行腳本：$Runner"
}

if ($Unregister) {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($null -eq $existing) {
        Write-Host "沒有名為「$TaskName」的排程，毋須移除。" -ForegroundColor Yellow
        return
    }
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "已移除排程：$TaskName" -ForegroundColor Green
    return
}

New-Item -ItemType Directory -Force -Path $OutDir, $LogDir | Out-Null

if (-not $SkipRun) {
    Write-Host "先執行一次匯出及電郵派發（驗證環境）…" -ForegroundColor Cyan
    if ([string]::IsNullOrWhiteSpace($EmailTo)) {
        & $Runner -OutDir $OutDir -Form $Form
    } else {
        & $Runner -OutDir $OutDir -Form $Form -EmailTo $EmailTo
    }
    if (-not $?) { throw "首次執行失敗；請先修正（例如 secrets\export-mail.env 的 SMTP 設定或收件人），再註冊排程。" }
}

$runnerArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$Runner`" -OutDir `"$OutDir`" -Form $Form"
if (-not [string]::IsNullOrWhiteSpace($EmailTo)) {
    $runnerArgs += " -EmailTo `"$EmailTo`""
}
$timeOfDay = [datetime]::ParseExact($Time, "HH:mm", $null)
$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument $runnerArgs `
    -WorkingDirectory $RepoRoot
$trigger = New-ScheduledTaskTrigger -Daily -At $timeOfDay
# 使用者登入後執行（StartWhenAvailable：電腦於排程時間關機時，開機後補跑一次）
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "每日匯出中${Form}學生一般練習作答情況（Excel）到 $OutDir 並以電郵派發；重溫錯題不計入。" `
    -Force | Out-Null

Write-Host ""
Write-Host "已註冊每日排程" -ForegroundColor Green
Write-Host "  名稱：$TaskName"
Write-Host "  時間：每日 $Time（電腦需開機並已登入）"
Write-Host "  輸出：$OutDir"
Write-Host "  日誌：$LogDir"
Write-Host "  電郵：$(if ([string]::IsNullOrWhiteSpace($EmailTo)) { '依 secrets\export-mail.env 的 EXPORT_EMAIL_TO' } else { $EmailTo })"
Write-Host ""
Write-Host "提醒：讀取備份使用服務帳戶金鑰（不需要 gcloud 登入）；SMTP 認證失敗時日誌會記錄詳情。" -ForegroundColor Yellow
