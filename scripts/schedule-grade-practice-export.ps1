<#
.SYNOPSIS
    每日自動匯出中四學生的一般練習作答情況（Excel），並註冊 Windows 工作排程器。

.DESCRIPTION
    步驟：
      1. 立即執行一次匯出（驗證 gcloud 登入、資料庫下載及 Excel 產生是否正常）；
      2. 註冊／更新每日 07:45（香港時間）的 Windows 工作排程。

    輸出：`<輸出資料夾>\中四_每日作答_<日期>.xlsx`
    （總表、班別統計、4A–4D 各一張工作表；重溫錯題不計入。）

    為甚麼要先手動執行一次：
      `gcloud` 憑證過期時排程只會靜默失敗。先執行一次可即時看到錯誤，並在日誌留下紀錄。

.EXAMPLE
    ./scripts/schedule-grade-practice-export.ps1 `
        -OutDir "$env:USERPROFILE\OneDrive - PO CHIU CATHOLIC SECONDARY SCHOOL\AI\學習記錄匯出"

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
    Write-Host "先執行一次匯出（驗證環境）…" -ForegroundColor Cyan
    & $Runner -OutDir $OutDir -Form $Form
    if (-not $?) { throw "首次匯出失敗；請先修正（例如執行 gcloud auth login），再註冊排程。" }
}

$timeOfDay = [datetime]::ParseExact($Time, "HH:mm", $null)
$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Runner`" -OutDir `"$OutDir`" -Form $Form" `
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
    -Description "每日匯出中${Form}學生一般練習作答情況（Excel）到 $OutDir；重溫錯題不計入。" `
    -Force | Out-Null

Write-Host ""
Write-Host "已註冊每日排程" -ForegroundColor Green
Write-Host "  名稱：$TaskName"
Write-Host "  時間：每日 $Time（電腦需開機並已登入）"
Write-Host "  輸出：$OutDir"
Write-Host "  日誌：$LogDir"
Write-Host ""
Write-Host "提醒：gcloud 憑證過期時排程會失敗，日誌會記錄原因；屆時於終端執行 gcloud auth login 即可。" -ForegroundColor Yellow
