<#
.SYNOPSIS
    設定「推送即部署」：push 到 GitHub 即由 Cloud Build 建置並部署到 Cloud Run。

.DESCRIPTION
    預設只會「顯示」將會執行的 gcloud 指令（不會改動雲端資源）；加上 -Apply 才會執行。
    所有步驟均可重複執行（已存在的資源會略過）。

    為什麼需要這支指令碼，而不能只在 Console 按幾下滑鼠：
      1. materials/ 不納入版本控制（第三方版權，見 .gitignore 及 materials/README.md），
         由 GitHub 觸發的建置只會拿到 materials/README.md。因此教材必須先上載到**私有**
         bucket，再由 cloudbuild.yaml 的 sync-materials 步驟同步回建置工作目錄。
      2. cloudbuild.yaml 的 substitution 預設值大多是空字串（名冊、備份 bucket、管理員），
         直接建立觸發程序會部署出「沒有名冊、沒有備份、沒有人能進 /admin」的服務。
         這支指令碼改為讀取**線上 Cloud Run 服務的現有設定**來組成 substitutions，
         令觸發程序與目前的正式環境一致。
      3. 觸發程序必須指定 serviceAccount（**省略會回 INVALID_ARGUMENT**，實測 2026-10-28），
         且該身分需具備部署 Cloud Run、寫入 Artifact Registry 及讀取教材 bucket 的權限。

   步驟：
     1. 檢查前置條件（gcloud 登入、服務存在、本機教材檔案數量）
     2. 建立／確認教材 bucket（預設與資料庫備份共用「專案 ID-history-backup」）
     3. 上載 materials/ 到 bucket（-SkipMaterials 可略過；-Prune 會刪除 bucket 內已無對應本機檔案）
     4. 建立並授權建置身分（預設 history-build@<專案>；-BuildServiceAccount 可指定其他）
     5. 由線上服務現有設定組成 trigger 的 substitutions
     6. 建立（或 -Recreate 重建）GitHub 觸發程序：push 到 main → 品質閘門 → 建置 → 部署

   注意：
     - 需先在 Cloud Build 的「觸發程序 → 連結儲存庫」連結此 GitHub 儲存庫
       （安裝 Cloud Build GitHub App），否則建立觸發程序會失敗。
     - 教材上載到私有 bucket，不會進入公開的 GitHub 儲存庫；bucket 權限只有
       執行身分（讀寫備份）及建置身分（唯讀）持有。

.EXAMPLE
    # 先看會執行哪些指令（不會改動任何資源）
    ./scripts/setup-push-to-deploy.ps1 -Project pccss-ai-history

.EXAMPLE
    # 實際設定（上載教材、授權並建立觸發程序）
    ./scripts/setup-push-to-deploy.ps1 -Project pccss-ai-history -Apply

.EXAMPLE
    # 只更新教材（教材有變更、但觸發程序已存在）
    ./scripts/setup-push-to-deploy.ps1 -Project pccss-ai-history -Apply -SkipTrigger
#>
[CmdletBinding()]
param(
    # GCP 專案 ID（正式環境為 pccss-ai-history）
    [Parameter(Mandatory = $true)][string]$Project,
    # Cloud Run 區域
    [string]$Region = "asia-east2",
    # 要部署的 Cloud Run 服務名稱
    [string]$Service = "history-self-study",
    # Artifact Registry 倉庫名稱
    [string]$Repository = "history",
    # 映像檔名稱
    [string]$ImageName = "hk-history-self-study",
    # GitHub 儲存庫（owner／name）
    [string]$RepoOwner = "ipwh",
    [string]$RepoName = "ai-history-platform",
    # 觸發建置的分支（正規表示式）
    [string]$BranchPattern = "^main$",
    # Cloud Build 觸發程序名稱
    [string]$TriggerName = "history-main-push",
    # 觸發程序區域（第一代觸發程序為 global；專案若改用區域性建置請填入區域）
    [string]$TriggerRegion = "global",
    # 教材 bucket（留空 = 沿用線上服務的 BACKUP_BUCKET，再退回「專案 ID-history-backup」）
    [string]$Bucket = "",
    # bucket 內的教材前置路徑
    [string]$MaterialsPrefix = "materials",
    # 觸發程序使用的建置設定檔
    [string]$BuildConfig = "cloudbuild.yaml",
    # 觸發程序執行建置所用的服務帳戶（電郵）。留空 = 建立或沿用
    # 「history-build@<專案>.iam.gserviceaccount.com」。
    # 這個專案必須明確指定：省略 --service-account 時 Cloud Build 會回
    # INVALID_ARGUMENT（實測 2026-10-28，任何觸發程序類型都一樣）。
    [string]$BuildServiceAccount = "",
    # 略過教材上載（只建立／更新觸發程序）
    [switch]$SkipMaterials,
    # 略過觸發程序（只上載教材，例如教材更新後）
    [switch]$SkipTrigger,
    # 上載教材時刪除 bucket 內已不存在的本機檔案（預設保留，避免半套教材蓋掉完整教材）
    [switch]$Prune,
    # 觸發程序已存在時先刪除再建立（substitutions 無法逐項更新）
    [switch]$Recreate,
    # 真正執行；否則只顯示指令
    [switch]$Apply
)

$RepoRoot = Split-Path -Parent $PSScriptRoot
$materialsRoot = Join-Path $RepoRoot "materials"

function Write-Step([string]$Text) {
    Write-Host ""
    Write-Host "== $Text" -ForegroundColor Cyan
}

# 唯讀查詢一律真正執行，令模擬模式也能顯示實際組出來的觸發程序內容。
# stderr 另存檔案而不併入 stdout：gcloud 的「有元件可更新」之類提示會寫入 stderr，
# 併入後會令 --format json 的輸出無法解析。
function Invoke-GcloudRead {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)

    $display = "gcloud " + ($Args -join " ")
    Write-Host "  $display" -ForegroundColor DarkGray

    $errFile = [System.IO.Path]::GetTempFileName()
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & gcloud @Args 2>$errFile
        $code = $LASTEXITCODE
        $errText = ""
        if (Test-Path -LiteralPath $errFile) { $errText = (Get-Content -LiteralPath $errFile -Raw) }
    } finally {
        $ErrorActionPreference = $previous
        Remove-Item -LiteralPath $errFile -Force -ErrorAction SilentlyContinue
    }
    if ($code -ne 0) {
        throw "gcloud 指令失敗（退出碼 $code）：$display`n$errText"
    }
    return (($output | Out-String).Trim())
}

function Invoke-Gcloud {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)

    # 顯示時遮蔽電郵名單（值仍以完整內容傳給 gcloud）
    $display = ($Args -join " ")
    $display = [regex]::Replace($display, "(_(?:ADMIN|TEACHER|REVIEWER)_EMAILS)=[^,]*", '$1=***')

    if (-not $Apply) {
        Write-Host "  （模擬）gcloud $display" -ForegroundColor DarkGray
        return ""
    }
    Write-Host "  gcloud $display" -ForegroundColor DarkGray

    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & gcloud @Args 2>&1
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    if ($code -ne 0) {
        throw "gcloud 指令失敗（退出碼 $code）：$($Args -join ' ')`n$($output | Out-String)"
    }
    return (($output | Out-String).Trim())
}

function Get-EnvValue {
    param([hashtable]$EnvVars, [string]$Name, [string]$Default = "")

    if ($EnvVars.ContainsKey($Name) -and -not [string]::IsNullOrWhiteSpace($EnvVars[$Name])) {
        return $EnvVars[$Name]
    }
    return $Default
}

Write-Host "推送即部署（GitHub → Cloud Build → Cloud Run）" -ForegroundColor Green
Write-Host "專案：$Project；服務：$Service（$Region）；儲存庫：$RepoOwner/$RepoName"
if (-not $Apply) {
    Write-Host "目前為模擬模式：只會顯示指令。要真正設定請加上 -Apply。" -ForegroundColor Yellow
}

Write-Step "1/6 檢查前置條件"

$account = Invoke-GcloudRead config get-value account
if ([string]::IsNullOrWhiteSpace($account) -or $account -match "unset") {
    throw "gcloud 未登入。請先執行 gcloud auth login。"
}
Write-Host "  已登入：$account" -ForegroundColor DarkGray

$serviceJson = Invoke-GcloudRead run services describe $Service --project $Project --region $Region --format json
# 不要命名為 $service：PowerShell 變數不分大小寫，會與 [string]$Service 參數衝突並被轉成字串
$serviceConfig = $serviceJson | ConvertFrom-Json
if ($null -eq $serviceConfig) { throw "讀不到 Cloud Run 服務 $Service（$Region）。請確認專案、區域及服務名稱。" }

if (-not $SkipMaterials) {
    $materialCount = 0
    if (Test-Path -LiteralPath $materialsRoot) {
        $materialCount = @(
            Get-ChildItem -LiteralPath $materialsRoot -Recurse -File |
                Where-Object { $_.Name -ne 'README.md' }
        ).Count
    }
    if ($materialCount -eq 0) {
        throw @"
本機 materials/ 沒有教材檔案（只有說明檔），上載後觸發建置會因教材不足而失敗。

請在含有教材檔案的電腦上執行，或先加上 -SkipMaterials 只設定觸發程序
（屆時請確定 bucket 內已有教材）。
"@
    }
    Write-Host "  本機教材檔案：$materialCount 個（不顯示檔名）" -ForegroundColor DarkGray
}

$payload = $serviceConfig.spec.template.spec
$container = $payload.containers[0]
$annotations = $payload.metadata.annotations

$envVars = @{}
foreach ($item in $container.env) {
    if ($null -ne $item.value) { $envVars[$item.name] = [string]$item.value }
}

# 教材與資料庫備份共用同一個私有 bucket（雲端硬碟成本最低，權限也只需維護一處）
$bucketName = $Bucket
if ([string]::IsNullOrWhiteSpace($bucketName)) {
    $bucketName = Get-EnvValue -EnvVars $envVars -Name "BACKUP_BUCKET" -Default "$Project-history-backup"
}
$bucketUri = "gs://$bucketName"
$materialsSource = "$bucketUri/$($MaterialsPrefix.Trim('/'))"

$runtimeSa = [string]$payload.serviceAccountName
if ([string]::IsNullOrWhiteSpace($runtimeSa)) { $runtimeSa = "" }

$maxInstances = "1"
$minInstances = "0"
if ($null -ne $annotations) {
    if ($annotations."autoscaling.knative.dev/maxScale") { $maxInstances = [string]$annotations."autoscaling.knative.dev/maxScale" }
    if ($annotations."autoscaling.knative.dev/minScale") { $minInstances = [string]$annotations."autoscaling.knative.dev/minScale" }
}

$memory = "1Gi"
$cpu = "1"
if ($null -ne $container.resources -and $null -ne $container.resources.limits) {
    if ($container.resources.limits.memory) { $memory = [string]$container.resources.limits.memory }
    if ($container.resources.limits.cpu) { $cpu = [string]$container.resources.limits.cpu }
}

# 服務是否公開（未設 IAP）：決定觸發程序部署時要不要 --allow-unauthenticated
$authFlag = ""
if (-not $SkipTrigger) {
    $iamJson = Invoke-GcloudRead run services get-iam-policy $Service --project $Project --region $Region --format json
    $iam = $iamJson | ConvertFrom-Json
    foreach ($binding in $iam.bindings) {
        if ($binding.role -eq "roles/run.invoker" -and @($binding.members) -contains "allUsers") {
            $authFlag = "--allow-unauthenticated"
        }
    }
}

Write-Step "2/6 建立／確認教材 bucket（$bucketUri）"
$bucketExists = $true
try {
    Invoke-GcloudRead storage buckets describe $bucketUri --project $Project --format "value(name)" | Out-Null
} catch {
    $bucketExists = $false
}
if (-not $bucketExists) {
    # 統一 bucket 層級存取，避免物件層級 ACL 令 Cloud Build 讀不到教材
    Invoke-Gcloud storage buckets create $bucketUri --project $Project --location $Region `
        --default-storage-class standard --uniform-bucket-level-access | Out-Null
} else {
    Write-Host "  已存在：$bucketUri" -ForegroundColor DarkGray
}

Write-Step "3/6 上載教材到 $materialsSource（版權內容只留在私有 bucket，不進 GitHub）"
if ($SkipMaterials) {
    Write-Host "  已略過（-SkipMaterials）" -ForegroundColor DarkGray
} else {
    $sourceRoot = (Resolve-Path -LiteralPath $materialsRoot).Path
    if ($Prune) {
        Invoke-Gcloud storage rsync --recursive --delete-unmatched-destination-objects $sourceRoot "$materialsSource/" | Out-Null
    } else {
        Invoke-Gcloud storage rsync --recursive $sourceRoot "$materialsSource/" | Out-Null
    }
}

if ($SkipTrigger) {
    Write-Step "4/6 略過授權及觸發程序（-SkipTrigger）"
    Write-Host ""
    Write-Host "完成（教材已同步）。下次 push 到 $BranchPattern 時，Cloud Build 會由 $materialsSource 取教材。" -ForegroundColor Green
    return
}

Write-Step "4/6 建立並授權建置身分（觸發程序的 serviceAccount）"

# 必須明確指定：省略 --service-account 時 Cloud Build 一律回 INVALID_ARGUMENT
# （實測 2026-10-28：空白 body、inline build、webhook、github 全部同樣失敗，
#   加上 serviceAccount 後即 HTTP 200）。因此本專案用專屬的最少權限帳戶，
# 而非預設的 Compute Engine 服務帳戶（Editor 權限過大）。
$buildSa = $BuildServiceAccount
if ([string]::IsNullOrWhiteSpace($buildSa)) {
    $buildSa = "history-build@$Project.iam.gserviceaccount.com"
}
$buildSaName = ($buildSa -split "@")[0]
Write-Host "  建置身分：$buildSa" -ForegroundColor DarkGray

$saExists = $true
try {
    Invoke-GcloudRead iam service-accounts describe $buildSa --project $Project --format "value(email)" | Out-Null
} catch {
    $saExists = $false
}
if ($saExists) {
    Write-Host "  已存在：$buildSa" -ForegroundColor DarkGray
} else {
    Invoke-Gcloud iam service-accounts create $buildSaName --project $Project `
        --display-name "Cloud Build (push to deploy)" `
        --description "push 到 GitHub 時建置映像檔並部署 Cloud Run" | Out-Null
}

# run.admin：部署 Cloud Run；iam.serviceAccountUser：以執行身分部署（actAs）
# artifactregistry.writer：推送映像檔；logging.logWriter：寫入建置記錄
foreach ($role in @("roles/run.admin", "roles/iam.serviceAccountUser", "roles/artifactregistry.writer", "roles/logging.logWriter")) {
    Invoke-Gcloud projects add-iam-policy-binding $Project `
        --member "serviceAccount:$buildSa" --role $role --condition=None --quiet | Out-Null
}
# storage.objectViewer：讀取教材 bucket
Invoke-Gcloud storage buckets add-iam-policy-binding $bucketUri `
    --member "serviceAccount:$buildSa" --role roles/storage.objectViewer --project $Project --quiet | Out-Null

# 部署指令以 --set-secrets 引用 Secret；Cloud Build 服務帳戶需要能讀取 Secret 版本。
# 未建立的 Secret 由 scripts/deploy-cloud-run.ps1 負責，這裡只警告不中止。
foreach ($secret in @("history-auth-secret", "history-deepseek-api-key", "history-roster-service-account", "history-google-client-id", "history-google-client-secret")) {
    try {
        Invoke-Gcloud secrets add-iam-policy-binding $secret --project $Project `
            --member "serviceAccount:$buildSa" --role roles/secretmanager.secretAccessor --quiet | Out-Null
    } catch {
        Write-Host "  警告：無法授權 Secret $secret（可能尚未建立）：$($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Step "5/6 由線上服務現有設定組成觸發程序的 substitutions"

# 名單類設定在 Cloud Run 環境變數內以分號分隔；Cloud Build 的 substitutions
# 以逗號分隔項目，因此任何值含逗號都會令建置失敗，這裡先擋下來。
$pairs = [ordered]@{
    _REGION                    = $Region
    _SERVICE                   = $Service
    _REPOSITORY                = $Repository
    _IMAGE_NAME                = $ImageName
    _MAX_INSTANCES             = $maxInstances
    _MIN_INSTANCES             = $minInstances
    _MEMORY                    = $memory
    _CPU                       = $cpu
    _AUTH_FLAG                 = $authFlag
    _RUNTIME_SA                = $runtimeSa
    _ROSTER_SHEET_ID           = (Get-EnvValue -EnvVars $envVars -Name "STUDENT_ROSTER_SHEET_ID")
    _ROSTER_SHEET_NAME         = (Get-EnvValue -EnvVars $envVars -Name "STUDENT_ROSTER_SHEET_NAME")
    _ROSTER_COLUMN_NAME        = (Get-EnvValue -EnvVars $envVars -Name "STUDENT_ROSTER_COLUMN_NAME" -Default "CHNAME")
    _ROSTER_CLASS_PREFIXES     = (Get-EnvValue -EnvVars $envVars -Name "STUDENT_ROSTER_CLASS_PREFIXES" -Default "1;2;3")
    _ADMIN_EMAILS              = (Get-EnvValue -EnvVars $envVars -Name "AUTH_ADMIN_EMAILS")
    _TEACHER_EMAILS            = (Get-EnvValue -EnvVars $envVars -Name "AUTH_TEACHER_EMAILS")
    _REVIEWER_EMAILS           = (Get-EnvValue -EnvVars $envVars -Name "HISTORY_REVIEWER_EMAILS")
    _STAFF_ACCESS_POLICY       = (Get-EnvValue -EnvVars $envVars -Name "AUTH_STAFF_ACCESS_POLICY" -Default "allowlist")
    _STAFF_DOMAINS             = (Get-EnvValue -EnvVars $envVars -Name "AUTH_STAFF_DOMAINS")
    _BACKUP_BUCKET             = $bucketName
    _BACKUP_PREFIX             = (Get-EnvValue -EnvVars $envVars -Name "BACKUP_PREFIX" -Default "history")
    _BACKUP_INTERVAL_SECONDS   = (Get-EnvValue -EnvVars $envVars -Name "BACKUP_INTERVAL_SECONDS" -Default "300")
    _BACKUP_MIN_SPACING_SECONDS = (Get-EnvValue -EnvVars $envVars -Name "BACKUP_MIN_SPACING_SECONDS" -Default "60")
    _MATERIALS_SOURCE          = $materialsSource
    _MIN_MATERIAL_FILES        = "1"
    _QUALITY_GATE              = "1"
}

foreach ($key in $pairs.Keys) {
    if ($pairs[$key] -match ",") {
        throw "substitution $key 的值含有逗號，會令 gcloud --substitutions 解析失敗：$($pairs[$key])。請改用分號分隔清單。"
    }
}

$substitutionParts = @()
foreach ($key in $pairs.Keys) { $substitutionParts += "$key=$($pairs[$key])" }
$substitutions = $substitutionParts -join ","

Write-Host "  substitutions：" -ForegroundColor DarkGray
foreach ($key in $pairs.Keys) {
    $value = $pairs[$key]
    $shown = $value
    # 電郵名單屬個人資料，只顯示數量
    if ($key -match "_(ADMIN|TEACHER|REVIEWER)_EMAILS") {
        $count = @($value -split ";" | Where-Object { $_ -ne "" }).Count
        $shown = "（$count 個電郵）"
    }
    Write-Host "    $key=$shown" -ForegroundColor DarkGray
}

if ([string]::IsNullOrWhiteSpace($pairs._ADMIN_EMAILS)) {
    Write-Host "  警告：線上服務的 AUTH_ADMIN_EMAILS 是空的，部署後將沒有人能進入 /admin。" -ForegroundColor Yellow
}
if ([string]::IsNullOrWhiteSpace($pairs._BACKUP_BUCKET)) {
    Write-Host "  警告：線上服務沒有設定 BACKUP_BUCKET，重新部署後題庫及練習記錄會全部消失。" -ForegroundColor Yellow
}

Write-Step "6/6 建立 GitHub 觸發程序（push 到 $BranchPattern）"

$triggerExists = $true
try {
    Invoke-GcloudRead builds triggers describe $TriggerName --project $Project --region $TriggerRegion --format "value(name)" | Out-Null
} catch {
    $triggerExists = $false
}

if ($triggerExists -and $Recreate) {
    Write-Host "  已存在，先刪除（-Recreate）" -ForegroundColor DarkGray
    Invoke-Gcloud builds triggers delete $TriggerName --project $Project --region $TriggerRegion --quiet | Out-Null
    $triggerExists = $false
}

if ($triggerExists) {
    Write-Host "  已存在：$TriggerName（substitutions 無法逐項更新；要重建請加 -Recreate）" -ForegroundColor DarkGray
} else {
    try {
        Invoke-Gcloud builds triggers create github `
            --name $TriggerName `
            --project $Project `
            --region $TriggerRegion `
            --service-account "projects/$Project/serviceAccounts/$buildSa" `
            --repo-owner $RepoOwner `
            --repo-name $RepoName `
            --branch-pattern $BranchPattern `
            --build-config $BuildConfig `
            --description "push to main: lint+test gate, build image, deploy Cloud Run (materials synced from GCS)" `
            --substitutions $substitutions | Out-Null
    } catch {
        if ($_.Exception.Message -match "Repository mapping does not exist|FAILED_PRECONDITION") {
            throw @"
GitHub 儲存庫尚未連結到 Cloud Build（Repository mapping does not exist）。

教材已上載、建置身分亦已建立；只欠把 $RepoOwner/$RepoName 連結到本專案：

  1. 開啟 https://console.cloud.google.com/cloud-build/triggers?project=$Project
  2. 按「連結儲存庫／Connect repository」→ 選 GitHub
  3. 如未安裝，按「安裝 Google Cloud Build」GitHub App，授權 $RepoOwner/$RepoName
     （可只授權此單一儲存庫）
  4. 回到主控台按「連結」，然後重跑：
       ./scripts/setup-push-to-deploy.ps1 -Project $Project -Apply -SkipMaterials

這一步只能在瀏覽器完成：GitHub App 的安裝授權沒有可用於 gcloud 的 API。
"@
        }
        throw
    }
}

Write-Host ""
Write-Host "設定完成。" -ForegroundColor Green
Write-Host @"

接下來：
  1. 若建立觸發程序時回報「Repository mapping does not exist」，代表 GitHub 儲存庫尚未連結：
     在 Cloud Build → 觸發程序 → 連結儲存庫安裝 Google Cloud Build GitHub App 並授權
     $RepoOwner/$RepoName，然後重跑
       ./scripts/setup-push-to-deploy.ps1 -Project $Project -Apply -SkipMaterials
  2. git push origin main 後，Cloud Build 會依序執行：
       品質閘門（npm run lint + npm test）→ 同步教材 → 建置映像檔 → 推送 → 部署 Cloud Run
     任何一步失敗都不會部署，正式服務維持上一個成功版本。
  3. 教材有更新時，先重跑本指令碼（只上載教材）再 push，或加 -SkipTrigger：
       ./scripts/setup-push-to-deploy.ps1 -Project $Project -Apply -SkipTrigger
"@
