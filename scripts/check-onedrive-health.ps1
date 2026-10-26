# 檢查（並可修正）OneDrive 工作目錄的「雲端預留檔」問題。
#
# 背景（2026-10-24 實際故障）：
#   OneDrive 的「檔案隨選」（Files On-Demand）會把長期未讀取的檔案變成雲端預留檔。
#   一旦下列位置被還原成預留檔，工具就會出現看似無關的錯誤：
#     - `.git\`：`git fetch` 出現 `fatal: mmap failed`，甚至 `loose object … is corrupt`；
#     - `node_modules\`：`next build` 出現 `Cannot find module 'pdfkit'` 或
#       `雲端檔案提供者未執行 (os error 362)`；
#     - `materials\`：`next build`（Turbopack 會追蹤整個專案）讀不到 docx 而失敗；
#     - `assets\`：匯出 PDF 時找不到中文字型。
#
# 這個指令碼只讀取檔案屬性，不會修改專案內容。加 `-Pin` 才會把指定資料夾標記為
# 「永遠保留在此裝置」（`attrib +P -U`），令 OneDrive 保持本機副本。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-onedrive-health.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-onedrive-health.ps1 -Pin
param(
    # OneDrive 內的專案目錄（預設為目前目錄）
    [string]$ProjectRoot = (Get-Location).Path,
    # 標記為「永遠保留在此裝置」，阻止 OneDrive 再次還原成預留檔
    [switch]$Pin,
    # 只檢查而不列出每個檔案
    [switch]$Summary
)
$ErrorActionPreference = "Stop"
$offlineFlag = [IO.FileAttributes]::Offline
$watched = @(".git", "node_modules", "materials", "assets", "data", "docs")

function Test-Placeholder([IO.FileSystemInfo]$item) {
    return ($item.Attributes -band $offlineFlag) -ne 0
}

Write-Host "=== OneDrive 預留檔檢查 ==="
Write-Host "專案：$ProjectRoot"
Write-Host ""

$total = 0
$problems = @()
foreach ($name in $watched) {
    $path = Join-Path $ProjectRoot $name
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $files = Get-ChildItem -LiteralPath $path -Recurse -File -Force -ErrorAction SilentlyContinue
    $placeholders = $files | Where-Object { Test-Placeholder $_ }
    $count = ($placeholders | Measure-Object).Count
    $total += $count
    $state = if ($count -eq 0) { "OK" } else { "有 $count 個預留檔" }
    Write-Host ("  {0,-14} {1,7} 個檔案   {2}" -f $name, ($files | Measure-Object).Count, $state) `
        -ForegroundColor $(if ($count -eq 0) { "DarkGray" } else { "Yellow" })
    if ($count -gt 0) { $problems += [pscustomobject]@{ Folder = $name; Placeholders = $count } }
    if ($count -gt 0 -and -not $Summary) {
        $placeholders | Select-Object -First 5 | ForEach-Object {
            Write-Host "      - $($_.FullName.Substring($ProjectRoot.Length + 1))" -ForegroundColor DarkYellow
        }
        if ($count -gt 5) { Write-Host "      …其餘 $($count - 5) 個" -ForegroundColor DarkYellow }
    }
}

Write-Host ""
if ($total -eq 0) {
    Write-Host "沒有預留檔：git、建置及測試都應可正常運作。" -ForegroundColor Green
    exit 0
}

if ($Pin) {
    Write-Host "正在標記為「永遠保留在此裝置」（OneDrive 會開始下載）…" -ForegroundColor Cyan
    foreach ($problem in $problems) {
        $path = Join-Path $ProjectRoot $problem.Folder
        attrib +P -U /s /d "`"$path`"" | Out-Null
        Write-Host "  已標記：$($problem.Folder)" -ForegroundColor Green
    }
    Write-Host ""
    Write-Host "下載需要時間。完成後重新執行本指令碼應顯示 0 個預留檔；" -ForegroundColor Cyan
    Write-Host "若仍顯示預留檔並出現「雲端檔案提供者未執行」，請重新啟動 OneDrive" -ForegroundColor Cyan
    Write-Host "（結束 OneDrive.exe 後再開啟），或在檔案總管右鍵選「永遠保留在此裝置」。" -ForegroundColor Cyan
    exit 0
}

Write-Host "建議：" -ForegroundColor Cyan
Write-Host "  1. 重新執行並加 -Pin：powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-onedrive-health.ps1 -Pin"
Write-Host "  2. 或在檔案總管對專案資料夾右鍵 →「永遠保留在此裝置」。"
Write-Host "  3. 若 OneDrive 顯示「雲端檔案提供者未執行」而無法下載，請重新啟動 OneDrive。"
Write-Host ""
Write-Host "在預留檔問題解決前，仍可使用的指令：npm test、npm run typecheck、npm run lint。" -ForegroundColor Yellow
Write-Host "建置請用 npm run build:webpack（不會追蹤整個專案）；npm run build（Turbopack）需要全部檔案可讀。" -ForegroundColor Yellow
exit 1
