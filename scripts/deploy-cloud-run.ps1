<#
.SYNOPSIS
    建置並部署「香港中學歷史科自學互動網站」到 Google Cloud Run。

.DESCRIPTION
    預設只會「顯示」將會執行的 gcloud 指令（安全起見不會改動雲端資源）；
    加上 -Apply 才會真正執行。所有步驟均可重複執行（已存在的資源會略過）。

   步驟：
     1. 啟用所需 API（run、artifactregistry、secretmanager、sheets、cloudbuild）
     2. 建立 Artifact Registry 倉庫
     3. 建立／更新 Secret Manager 機密：
        AUTH_SECRET（隨機產生）、LLM API key、Google OAuth 用戶端 ID 及密碼
     4. 建立名冊讀取服務帳戶及金鑰（JSON 存放於 ./secrets/，已被 .gitignore 忽略）
     5. 以 Cloud Build 建置映像檔並部署到 Cloud Run
     6. 輸出服務網址及需要登記的 OAuth 重新導向網址

   後台角色：
     - 管理員（可進入 /admin）必須以 -AdminEmails 指定，否則部署後沒有人能管理教材及系統設定。
     - 教師（可進入 /teacher）可用 -TeacherEmails 指定非校內網域帳戶；
       校內網域但非學號形式的帳戶本身已是教師，毋須填寫。

    機密值不會寫入任何檔案或顯示在輸出中：
      - AUTH_SECRET 未提供時即時隨機產生
      - LLM API key 以 -LlmApiKey 或環境變數 DEEPSEEK_API_KEY 提供
      - Google 憑證以 -GoogleClientId／-GoogleClientSecret 或環境變數提供

.EXAMPLE
    # 先看會執行哪些指令（不會建立任何資源）
    ./scripts/deploy-cloud-run.ps1 -Project my-project

.EXAMPLE
    # 實際部署
    ./scripts/deploy-cloud-run.ps1 -Project amiable-nirvana-500300-a0 -Apply `
        -RosterSheetId 1RlzeojjxJqu8vk7ctTliVRahA1sXnR-BJRiyFMCr_uM `
        -AdminEmails ipwh@pochiu.edu.hk `
        -LlmApiKey $env:DEEPSEEK_API_KEY `
        -GoogleClientId $env:GOOGLE_CLIENT_ID -GoogleClientSecret $env:GOOGLE_CLIENT_SECRET
#>
[CmdletBinding()]
param(
    # GCP 專案 ID（必填）
    [Parameter(Mandatory = $true)][string]$Project,
    # Cloud Run 區域（香港最近為 asia-east2）
    [string]$Region = "asia-east2",
    # Cloud Run 服務名稱
    [string]$Service = "history-self-study",
    # Artifact Registry 倉庫名稱
    [string]$Repository = "history",
    # 映像檔名稱
    [string]$ImageName = "hk-history-self-study",
    # 學生名冊 Google Sheet ID（可留空，稍後用 gcloud run services update 補上）
    [string]$RosterSheetId = "",
    # 學生名冊工作表名稱（留空 = 第一張工作表）
    [string]$RosterSheetName = "",
    # 管理員電郵（可進入管理員端 /admin；多個以分號分隔；留空 = 沒有人是管理員）
    # 注意：管理員必須在此指定，否則部署後無法進入 /admin 管理教材及系統設定。
    [string]$AdminEmails = "",
    # 教師電郵（供非校內網域帳戶使用，可進入教師端 /teacher；多個以分號分隔）
    # 校內網域但非學號形式的帳戶本身已是教師，毋須填寫。
    [string]$TeacherEmails = "",
    # 名冊讀取用的服務帳戶名稱（會被建立；學校需把 Sheet 分享給它的電郵）
    [string]$RosterServiceAccount = "history-roster-reader",
    # Cloud Run 執行身分服務帳戶名稱（會被建立，只獲授讀取所需 Secret 的權限）
    [string]$RuntimeServiceAccount = "history-run",
    # LLM API key（未提供時沿用環境變數 DEEPSEEK_API_KEY）
    [string]$LlmApiKey = "",
    # Google OAuth 用戶端 ID（未提供時沿用環境變數 GOOGLE_CLIENT_ID）
    [string]$GoogleClientId = "",
    # Google OAuth 用戶端密碼（未提供時沿用環境變數 GOOGLE_CLIENT_SECRET）
    [string]$GoogleClientSecret = "",
    # 服務帳戶金鑰 JSON 檔案路徑（未提供時自動建立 ./secrets/roster-service-account.json）
    [string]$RosterServiceAccountFile = "",
    # 不要自動建立名冊服務帳戶金鑰（Cloud Run 部署需要該 Secret，一般毋須使用）
    [switch]$NoRosterKey,
    # 是否允許未登入者存取 Cloud Run 服務（false 時需要 IAP 或身分權杖）
    [bool]$AllowUnauthenticated = $true,
    # 最大執行個體數：SQLite 需要 1，改用 Cloud SQL 後可調高
    [int]$MaxInstances = 1,
    # 資料庫備份用的 Cloud Storage bucket 名稱（留空 = 自動使用「專案 ID-history-backup」）
    [string]$BackupBucket = "",
    # 備份 bucket 的位置（asia-east2 = 香港；us-central1 等美國區域可享免費額度）
    [string]$BackupLocation = "asia-east2",
    # bucket 內的物件前置路徑
    [string]$BackupPrefix = "history",
    # 備份間隔秒數（預設 5 分鐘）
    [string]$BackupIntervalSeconds = "300",
    # 真正執行（未指定時只顯示指令）
    [switch]$Apply
)

$ErrorActionPreference = "Stop"

$authSecretName = "history-auth-secret"
$llmSecretName = "history-deepseek-api-key"
$rosterSecretName = "history-roster-service-account"
$googleIdSecretName = "history-google-client-id"
$googleSecretSecretName = "history-google-client-secret"

function Write-Step([string]$Text) {
    Write-Host ""
    Write-Host "== $Text" -ForegroundColor Cyan
}

<#
執行 gcloud 並處理 PowerShell 5.1 的特性：
原生程式寫入 stderr（gcloud 的進度訊息）在 $ErrorActionPreference = 'Stop' 下會被視為
終止錯誤，因此這裡暫時改為 Continue，改以退出碼判斷成敗。
#>
function Invoke-GcloudCore {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)

    $display = "gcloud " + ($Args -join " ")
    Write-Host "  $display" -ForegroundColor DarkGray

    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & gcloud @Args 2>&1
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    if ($code -ne 0) {
        throw "gcloud 指令失敗（退出碼 $code）：$display`n$($output | Out-String)"
    }
    return (($output | Out-String).Trim())
}

function Invoke-Gcloud {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)

    if (-not $Apply) {
        Write-Host ("  （模擬）gcloud " + ($Args -join " ")) -ForegroundColor DarkGray
        return ""
    }
    return Invoke-GcloudCore @Args
}

<# 由標準輸入寫入 Secret 版本（避免機密出現在命令列或檔案） #>
function Add-SecretVersion {
    param([string]$Name, [string]$Value, [string]$Label)

    if ($Apply) {
        $previous = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            $Value | & gcloud secrets versions add $Name --project $Project --data-file - | Out-Null
            $code = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previous
        }
        if ($code -ne 0) {
            throw "更新 Secret 失敗：$Name（退出碼 $code）"
        }
        Write-Host "  已更新 $Name（$Label）" -ForegroundColor DarkGray
    } else {
        Write-Host "  （模擬）更新 $Name（$Label）" -ForegroundColor DarkGray
    }
}

function Ensure-Secret {
    param([string]$Name, [string]$Existing)

    # gcloud 可能回報完整資源名稱（projects/<專案>/secrets/<名稱>）或簡短名稱
    $matches = @(
        ($Existing -split "\r?\n") | Where-Object { $_ -match ("(^|/)" + [regex]::Escape($Name) + "$") }
    )
    if ($Apply -and $matches.Count -eq 0) {
        try {
            Invoke-Gcloud secrets create $Name --project $Project --replication-policy automatic --quiet | Out-Null
        } catch {
            # 併發或已存在時不視為失敗
            if ($_.Exception.Message -notmatch "already exists") { throw }
            Write-Host "  已存在：$Name" -ForegroundColor DarkGray
        }
    } else {
        Write-Host "  已存在或為模擬模式：$Name" -ForegroundColor DarkGray
    }
}

Write-Host "香港中學歷史科自學互動網站 → Google Cloud Run" -ForegroundColor Green
Write-Host "專案：$Project；區域：$Region；服務：$Service"
if (-not $Apply) {
    Write-Host "目前為模擬模式：只會顯示指令。要真正部署請加上 -Apply。" -ForegroundColor Yellow
}

Write-Step "1/7 啟用所需 API（run、artifactregistry、secretmanager、sheets、cloudbuild、storage）"
Invoke-Gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com sheets.googleapis.com cloudbuild.googleapis.com storage.googleapis.com --project $Project | Out-Null

Write-Step "2/7 建立 Artifact Registry 倉庫（已存在時略過）"
$repos = Invoke-Gcloud artifacts repositories list --project $Project --location $Region --format "value(name)"
if ($Apply -and $repos -notmatch "$Repository$") {
    Invoke-Gcloud artifacts repositories create $Repository --project $Project --location $Region --repository-format docker --description "HK history self-study images" | Out-Null
} else {
    Write-Host "  已存在或為模擬模式：$Repository" -ForegroundColor DarkGray
}

Write-Step "3/7 建立資料備份用的 Cloud Storage bucket（免費方案：資料庫快照備份）"
$backupBucketName = if ($BackupBucket) { $BackupBucket } else { "$Project-history-backup" }
if ($Apply) {
    $buckets = Invoke-Gcloud storage buckets list --project $Project --format "value(name)"
    if ($buckets -notmatch [regex]::Escape($backupBucketName)) {
        Invoke-Gcloud storage buckets create "gs://$backupBucketName" --project $Project --location $BackupLocation --default-storage-class standard --uniform-bucket-level-access | Out-Null
        Write-Host "  已建立 gs://$backupBucketName（${BackupLocation}）" -ForegroundColor DarkGray
    } else {
        Write-Host "  已存在：gs://$backupBucketName" -ForegroundColor DarkGray
    }
} else {
    Write-Host "  （模擬）建立 gs://$backupBucketName（$BackupLocation，標準儲存）" -ForegroundColor DarkGray
}

Write-Step "4/7 建立／更新 Secret Manager 機密"
$existingSecrets = Invoke-Gcloud secrets list --project $Project --format "value(name)"

Ensure-Secret -Name $authSecretName -Existing $existingSecrets
# 只在尚未有版本時產生新的工作階段密鑰；否則每次部署都會令所有已登入使用者被登出。
# 注意：gcloud 會把「Listed 0 items.」等訊息寫到 stderr，而 helper 以 2>&1 合併輸出，
#       因此不能只判斷輸出是否為空，必須檢查是否真的有版本編號（純數字）。
$authVersions = Invoke-Gcloud secrets versions list $authSecretName --project $Project --format "value(name)" --filter "state!=DESTROYED"
$hasAuthVersion = @($authVersions -split "\r?\n" | Where-Object { $_ -match '^\d+$' }).Count -gt 0
if ($Apply -and -not $hasAuthVersion) {
    $authSecret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 48 | ForEach-Object { [char]$_ })
    Add-SecretVersion -Name $authSecretName -Value $authSecret -Label "工作階段簽署密鑰，隨機產生"
} else {
    Write-Host "  保留現有 $authSecretName（避免現有登入狀態失效）" -ForegroundColor DarkGray
}

Ensure-Secret -Name $llmSecretName -Existing $existingSecrets
$llmKey = if ($LlmApiKey) { $LlmApiKey } else { $env:DEEPSEEK_API_KEY }
if ($llmKey) {
    Add-SecretVersion -Name $llmSecretName -Value $llmKey -Label "LLM API key"
} else {
    Add-SecretVersion -Name $llmSecretName -Value "REPLACE_ME" -Label "佔位值"
    Write-Warning "未提供 LLM API key：已放入佔位值，請盡快更新 Secret $llmSecretName，否則 AI 出題會回退到示範生成。"
}

Ensure-Secret -Name $googleIdSecretName -Existing $existingSecrets
Ensure-Secret -Name $googleSecretSecretName -Existing $existingSecrets
$googleId = if ($GoogleClientId) { $GoogleClientId } else { $env:GOOGLE_CLIENT_ID }
$googleSecret = if ($GoogleClientSecret) { $GoogleClientSecret } else { $env:GOOGLE_CLIENT_SECRET }
if ($googleId -and $googleSecret) {
    Add-SecretVersion -Name $googleIdSecretName -Value $googleId -Label "Google OAuth 用戶端 ID"
    Add-SecretVersion -Name $googleSecretSecretName -Value $googleSecret -Label "Google OAuth 用戶端密碼"
} else {
    Add-SecretVersion -Name $googleIdSecretName -Value "REPLACE_ME" -Label "佔位值"
    Add-SecretVersion -Name $googleSecretSecretName -Value "REPLACE_ME" -Label "佔位值"
    Write-Warning "未提供 Google OAuth 憑證：已放入佔位值。未啟用登入時，Cloud Run 上的後台 API 會被拒絕（除非設 HISTORY_ALLOW_UNSAFE_DEMO_MODE=true），學生亦只能以匿名模式使用。"
}

Write-Step "4/6 建立名冊讀取服務帳戶及金鑰"
$serviceAccountEmail = "$RosterServiceAccount@${Project}.iam.gserviceaccount.com"
$existingAccounts = Invoke-Gcloud iam service-accounts list --project $Project --format "value(email)"
if ($Apply -and $existingAccounts -notmatch [regex]::Escape($serviceAccountEmail)) {
    Invoke-Gcloud iam service-accounts create $RosterServiceAccount --project $Project --display-name "History roster reader (Google Sheets)" --quiet | Out-Null
}
Write-Host "  名冊服務帳戶：$serviceAccountEmail" -ForegroundColor Yellow
Write-Host "  → 請把學生名冊 Google Sheet 分享給這個電郵（檢視者權限）" -ForegroundColor Yellow

$keyPath = $RosterServiceAccountFile
if (-not $keyPath -and -not $NoRosterKey) {
    $keyPath = Join-Path (Get-Location) "secrets/roster-service-account.json"
}
if ($keyPath) {
    if (-not (Test-Path $keyPath)) {
        if ($Apply) {
            $keyDirectory = Split-Path -Parent $keyPath
            if ($keyDirectory -and -not (Test-Path $keyDirectory)) {
                New-Item -ItemType Directory -Path $keyDirectory -Force | Out-Null
            }
            Invoke-Gcloud iam service-accounts keys create $keyPath --iam-account $serviceAccountEmail --project $Project | Out-Null
            Write-Host "  已建立服務帳戶金鑰：$keyPath（已被 .gitignore 忽略，請勿提交）" -ForegroundColor DarkGray
        } else {
            Write-Host "  （模擬）建立服務帳戶金鑰：$keyPath" -ForegroundColor DarkGray
        }
    } else {
        Write-Host "  使用現有金鑰：$keyPath" -ForegroundColor DarkGray
    }

    if ($Apply -and (Test-Path $keyPath)) {
        Ensure-Secret -Name $rosterSecretName -Existing $existingSecrets
        $previous = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            & gcloud secrets versions add $rosterSecretName --project $Project --data-file $keyPath | Out-Null
            $code = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previous
        }
        if ($code -ne 0) { throw "更新 Secret 失敗：$rosterSecretName（退出碼 $code）" }
        Write-Host "  已更新 $rosterSecretName（名冊服務帳戶金鑰）" -ForegroundColor DarkGray
    } else {
        Write-Host "  （模擬）更新 $rosterSecretName（名冊服務帳戶金鑰）" -ForegroundColor DarkGray
    }
} else {
    Write-Warning "未建立名冊服務帳戶金鑰：Cloud Run 部署會因缺少 Secret $rosterSecretName 而失敗，請以 -RosterServiceAccountFile 指定金鑰檔。"
}

Write-Step "5/7 建立 Cloud Run 執行身分並授權讀取 Secret 及備份 bucket"
$runtimeServiceAccountEmail = "$RuntimeServiceAccount@${Project}.iam.gserviceaccount.com"
if ($Apply -and $existingAccounts -notmatch [regex]::Escape($runtimeServiceAccountEmail)) {
    Invoke-Gcloud iam service-accounts create $RuntimeServiceAccount --project $Project --display-name "History self-study Cloud Run runtime" --quiet | Out-Null
}
Write-Host "  Cloud Run 執行身分：$runtimeServiceAccountEmail" -ForegroundColor DarkGray
foreach ($secretName in @($authSecretName, $llmSecretName, $rosterSecretName, $googleIdSecretName, $googleSecretSecretName)) {
    Invoke-Gcloud secrets add-iam-policy-binding $secretName --project $Project --member "serviceAccount:$runtimeServiceAccountEmail" --role roles/secretmanager.secretAccessor --quiet | Out-Null
}
# 只授權讀寫這個備份 bucket（不使用專案層級權限）
Invoke-Gcloud storage buckets add-iam-policy-binding "gs://$backupBucketName" --project $Project --member "serviceAccount:$runtimeServiceAccountEmail" --role roles/storage.objectAdmin --quiet | Out-Null

Write-Step "6/7 以 Cloud Build 建置映像檔並部署到 Cloud Run（約需 5 至 10 分鐘）"
# --allow-unauthenticated 是切換式旗標（不能寫 =true）；不允許公開存取時留空，改由 IAP／身分權杖保護
$authFlag = if ($AllowUnauthenticated) { "--allow-unauthenticated" } else { "" }
$substitutions = ('_REGION={0},_SERVICE={1},_REPOSITORY={2},_IMAGE_NAME={3},_MAX_INSTANCES={4},_AUTH_FLAG={5},_RUNTIME_SA={6},_ROSTER_SHEET_ID={7},_ROSTER_SHEET_NAME={8},_BACKUP_BUCKET={9},_BACKUP_PREFIX={10},_BACKUP_INTERVAL_SECONDS={11},_ADMIN_EMAILS={12},_TEACHER_EMAILS={13}' -f $Region, $Service, $Repository, $ImageName, $MaxInstances, $authFlag, $runtimeServiceAccountEmail, $RosterSheetId, $RosterSheetName, $backupBucketName, $BackupPrefix, $BackupIntervalSeconds, $AdminEmails, $TeacherEmails)
Invoke-Gcloud builds submit --project $Project --config cloudbuild.yaml --substitutions $substitutions --timeout=1800s . | Out-Null

# Cloud Build 執行身分未必有 run.services.setIamPolicy，令 --allow-unauthenticated 靜靜失效（服務會回 403）
if ($Apply -and $AllowUnauthenticated) {
    try {
        Invoke-Gcloud run services add-iam-policy-binding $Service --project $Project --region $Region --member allUsers --role roles/run.invoker --quiet | Out-Null
        Write-Host "  已允許公開存取（allUsers → roles/run.invoker）" -ForegroundColor DarkGray
    } catch {
        Write-Host "  無法自動開放公開存取，請手動執行：" -ForegroundColor Yellow
        Write-Host "    gcloud run services add-iam-policy-binding $Service --region=$Region --project $Project --member=allUsers --role=roles/run.invoker" -ForegroundColor Yellow
    }
}

Write-Step "7/7 部署結果"
$url = Invoke-Gcloud run services describe $Service --project $Project --region $Region --format "value(status.url)"
if ($Apply) {
    Write-Host ""
    Write-Host "服務網址：$url" -ForegroundColor Green
    Write-Host "請在 Google Cloud Console 的 OAuth 用戶端設定加入重新導向網址：" -ForegroundColor Yellow
    Write-Host "  $url/api/auth/google/callback" -ForegroundColor Yellow
    Write-Host "健康檢查：$url/api/health" -ForegroundColor Green
    Write-Host "管理員端系統狀態：$url/admin/settings" -ForegroundColor Green
} else {
    Write-Host "（模擬完成）實際部署請重新執行並加上 -Apply。" -ForegroundColor Yellow
}
