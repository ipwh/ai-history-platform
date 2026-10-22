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

   後台角色（角色只來自明確名單，網域本身不再授予教師權限）：
     - 管理員（可進入 /admin）必須以 -AdminEmails 指定，否則部署後沒有人能管理教材及系統設定。
     - 教師（可進入 /teacher）預設必須以 -TeacherEmails 指定（含校內網域帳戶）。
       未列入名單的帳戶（包括校內網域帳戶）一律是學生；為免默默把教師鎖在門外，
       未提供 -TeacherEmails、又未明確選擇全校政策時指令碼會**拒絕部署**。
     - 擁有者明確授權的暫時政策：-StaffAccessPolicy school-domain 會令 -StaffDomains
       所列校內網域中「非學號形式」（^s\d+$ 除外的）帳戶全部成為教師。這是**全校教職員**
       政策，不是最小權限政策；學號形式的學生帳戶一律仍是學生。停用方式：改回 allowlist
       （或直接把 AUTH_STAFF_ACCESS_POLICY 設為 allowlist／移除），現有工作階段會即時降權。

    機密值不會寫入任何檔案或顯示在輸出中：
       - AUTH_SECRET 未提供時即時隨機產生（已有版本時保留，避免登出所有使用者）
      - LLM API key 以 -LlmApiKey 或環境變數 DEEPSEEK_API_KEY 提供
      - Google 憑證以 -GoogleClientId／-GoogleClientSecret 或環境變數提供
       - 以上兩者未提供時，會依序讀取本機 .env.local；仍然沒有時**不會**覆寫
         已存在的 Secret（只在完全沒有版本時才寫入佔位值）

.EXAMPLE
    # 先看會執行哪些指令（不會建立任何資源）
    ./scripts/deploy-cloud-run.ps1 -Project my-project

.EXAMPLE
    # 實際部署（機密值會自動取自本機 .env.local）
    ./scripts/deploy-cloud-run.ps1 -Project pccss-ai-history -Apply `
        -RosterSheetId 1RlzeojjxJqu8vk7ctTliVRahA1sXnR-BJRiyFMCr_uM `
        -AdminEmails ipwh@pochiu.edu.hk `
        -TeacherEmails 'teacher1@pochiu.edu.hk;teacher2@pochiu.edu.hk'

.EXAMPLE
    # 或明確由環境變數提供
    ./scripts/deploy-cloud-run.ps1 -Project pccss-ai-history -Apply `
        -AdminEmails ipwh@pochiu.edu.hk `
        -LlmApiKey $env:DEEPSEEK_API_KEY `
        -GoogleClientId $env:GOOGLE_CLIENT_ID -GoogleClientSecret $env:GOOGLE_CLIENT_SECRET
#>
[CmdletBinding()]
param(
    # GCP 專案 ID（必填；正式環境為 pccss-ai-history）
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
    # 開放的班別前綴（前綴比對；預設 1;2;3;4;5;6 = 中一至中六，留空 = 不設限）
    # 留空會令所有班別都可登入；高中（4、5、6）不在此清單時中四至中六學生無法登入。
    [string]$RosterClassPrefixes = "1;2;3;4;5;6",
    # 管理員電郵（可進入管理員端 /admin；多個以分號分隔；留空 = 沒有人是管理員）
    # 注意：管理員必須在此指定，否則部署後無法進入 /admin 管理教材及系統設定。
    [string]$AdminEmails = "",
    # 教師電郵（可進入教師端 /teacher；多個以分號分隔）
    # 所有教師都必須在此列出（含校內網域帳戶）；網域本身不再授予教師權限。
    # 例外：-StaffAccessPolicy school-domain 時，校內網域的非學號形式帳戶皆為教師。
    [string]$TeacherEmails = "",
    # 歷史科內容審核者名單（HISTORY_REVIEWER_EMAILS；多個以分號分隔）。
    # 只有名單內的帳戶可核准 Golden fixture 及「已修復並核准」的學科裁決；
    # 平台 teacher／admin 角色**不等於**學科審核資格，留空時一律 fail-closed。
    [string]$ReviewerEmails = "",
    # 教職員存取政策（擁有者決定）：
    #   allowlist（預設）= 最小權限，只有 -AdminEmails／-TeacherEmails 列出的帳戶是教職員
    #   school-domain    = 暫時的全校教職員政策，-StaffDomains 所列網域的非學號形式帳戶皆為教師
    # 未設定或拼錯時應用程式一律退回 allowlist（fail-closed）。
    [ValidateSet("allowlist", "school-domain")]
    [string]$StaffAccessPolicy = "allowlist",
    # 全校政策的校內網域清單（只在 -StaffAccessPolicy school-domain 時生效；多個以分號分隔）
    [string]$StaffDomains = "pochiu.edu.hk",
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
    # 建置環境沒有教材檔案時仍然繼續（預設會擋下來；詳見指令碼內的教材檢查）
    [switch]$AllowMissingMaterials,
    # 真正執行（未指定時只顯示指令）
    [switch]$Apply
)

$ErrorActionPreference = "Stop"

# 角色預設值為 student（fail-closed）：校內網域但學號形式不符的帳戶不再自動成為教師。
# 若沒有同時列出教師，部署後所有教師都會失去教師端權限（而且不會有任何錯誤訊息），
# 因此這裡在部署前先擋下來，要求明確決定，而不是默默把教師鎖在門外。
# 舊的「校內網域 = 教師」政策已移除：未列入名單的帳戶（包括校內網域）一律是學生。
if ($StaffAccessPolicy -eq "school-domain") {
    # 全校教職員政策：必須明確列出網域，否則應用程式會 fail-closed（沒有人是教師）
    if ($StaffDomains.Trim().Length -eq 0) {
        throw @"
已選擇全校教職員政策（-StaffAccessPolicy school-domain），但沒有指定校內網域（-StaffDomains）。
應用程式在這種設定下一律 fail-closed（沒有人是教師），因此拒絕部署。

請指定校內網域，或在沒有明確授權時改用最小權限政策：
  -StaffAccessPolicy allowlist -TeacherEmails 'teacher1@pochiu.edu.hk;teacher2@pochiu.edu.hk'
"@
    }
    Write-Warning @"
教職員政策：school-domain（全校教職員）——目的是暫時讓校內職員能進入教師端。
這是**全校**授權，不是最小權限政策：凡屬下列網域且**非**學號形式（^s\d+$）的帳戶，
都會取得教師權限，可讀取全部學生的練習記錄。學生帳戶（學號形式）一律仍是學生。
僅在擁有者明確授權下使用，並在不再需要時改回 -StaffAccessPolicy allowlist。
網域：$StaffDomains
"@
} elseif ($TeacherEmails.Trim().Length -eq 0) {
    throw @"
尚未指定教師電郵（-TeacherEmails）。校內網域的帳戶不再自動取得教師權限，
若不在這裡列出，部署後沒有人能進入教師端（管理員不受影響）。

請以 -TeacherEmails 列出歷史科教師，多個以分號分隔：
  -TeacherEmails 'teacher1@pochiu.edu.hk;teacher2@pochiu.edu.hk'

如擁有者已明確授權「暫時開放全校校內職員使用教師端」，可改用：
  -StaffAccessPolicy school-domain -StaffDomains pochiu.edu.hk
"@
}

# 學號形式（s + 數字）的帳戶一律是學生，不會因為列在教師名單而升級；
# 若名單內出現這類帳戶，應用程式會顯示 error 級設定警示。這裡只回報數量，不顯示電郵。
# 註：gcloud 的 --substitutions 及 --set-env-vars 都以逗號分隔，清單內若用逗號會被截斷，
#     因此這裡把清單統一正規化為分號（設定層同時接受逗號、分號及空白）。
$adminEmailList = (@(($AdminEmails -split "[;,\s]+") | Where-Object { $_ }) -join ";")
$teacherEmailList = (@(($TeacherEmails -split "[;,\s]+") | Where-Object { $_ }) -join ";")
$staffDomainList = (@(($StaffDomains -split "[;,\s]+") | Where-Object { $_ }) -join ";")
$reviewerEmailList = (@(($ReviewerEmails -split "[;,\s]+") | Where-Object { $_ }) -join ";")

# 歷史科內容審核者名單留空時，所有學科裁決（Golden 核准、已修復並核准）都會回 403。
# 這是 fail-closed 的設計，但部署時若忘記指定，教師會在介面上四處碰壁而不知原因，
# 因此這裡明確提示（不顯示電郵）。
if ($reviewerEmailList.Trim().Length -eq 0) {
    Write-Warning @"
未指定歷史科內容審核者（-ReviewerEmails）。部署後**沒有任何人**可以核准
Golden fixture 或「已修復並核准」的學科裁決（平台 teacher／admin 角色不等於學科資格）。
如有歷史科教師需要核准內容，請加上：
  -ReviewerEmails 'history-teacher@pochiu.edu.hk'
"@
}

$studentPatternEntries = @(
    (($adminEmailList + ";" + $teacherEmailList).Split(";")) |
        Where-Object { $_ -match "^s[0-9]+@" }
)
if ($studentPatternEntries.Count -gt 0) {
    Write-Warning "教師／管理員名單內有 $($studentPatternEntries.Count) 個學號形式（s 加數字）的帳戶；這些帳戶不會取得教師權限，請確認名單是否誤填。"
}

$RepoRoot = Split-Path -Parent $PSScriptRoot

# 教材檔案檢查：`materials/` 不納入版本控制（版權考量，見 .gitignore 與 materials/README.md），
# 但 Dockerfile 會把 `materials/` 複製到映像檔。若在建置環境缺少教材，Cloud Build 仍會
# **成功**建置並部署，只是管理員無法匯入課本內容、學生會看到沒有教材的平台。
# 因此這裡在部署前擋下來（只回報數量，不顯示檔名）。如確實要部署無教材的映像檔，
# 請明確加上 -AllowMissingMaterials；管理員端屆時會顯示教材缺失的警告。
if (-not $AllowMissingMaterials) {
    $materialsRoot = Join-Path $RepoRoot "materials"
    $materialFileCount = 0
    if (Test-Path -LiteralPath $materialsRoot) {
        $materialFileCount = @(
            Get-ChildItem -LiteralPath $materialsRoot -Recurse -File |
                Where-Object { $_.Name -ne 'README.md' }
        ).Count
    }
    if ($materialFileCount -eq 0) {
        throw @"
建置環境內沒有教材檔案（materials/ 只有說明檔）。

教材不納入版本控制（版權考量），但 Docker 映像檔需要 materials/ 的內容，否則部署後
管理員無法匯入課本內容，學生會看到沒有教材的平台——而 Cloud Build 仍會回報成功。

請在含有教材檔案的電腦上執行部署，或先把教材放回 materials/。
如確實要部署沒有教材的映像檔（例如正式環境改由受控匯入流程提供教材），
請加上 -AllowMissingMaterials。
"@
    }
    Write-Host "  教材檔案：$materialFileCount 個（不顯示檔名）" -ForegroundColor DarkGray
} else {
    Write-Host "  已略過教材檔案檢查（-AllowMissingMaterials）" -ForegroundColor DarkGray
}

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

<# 由本機 .env.local 讀取機密值（避免部署時忘記傳參數而覆寫成佔位值） #>
function Read-LocalEnvFile {
    param([string]$FileName)

    $path = Join-Path $RepoRoot $FileName
    if (-not (Test-Path $path)) { return @{} }

    $values = @{}
    foreach ($line in (Get-Content $path)) {
        if ($line -notmatch '^\s*[A-Za-z_][A-Za-z0-9_]*\s*=') { continue }
        $key, $value = $line -split '=', 2
        $values[$key.Trim()] = $value.Trim().Trim('"')
    }
    return $values
}

<# 取出已存在的 Secret 版本編號（gcloud 的「Listed 0 items.」會混在 2>&1 輸出中，必須只認數字） #>
function Get-SecretVersions {
    param([string]$Name)

    $output = Invoke-Gcloud secrets versions list $Name --project $Project --format "value(name)" --filter "state!=DESTROYED"
    return @($output -split "\r?\n" | Where-Object { $_ -match '^\d+$' })
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

Write-Step "1/8 啟用所需 API（run、artifactregistry、secretmanager、sheets、cloudbuild、storage）"
Invoke-Gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com sheets.googleapis.com cloudbuild.googleapis.com storage.googleapis.com --project $Project | Out-Null

Write-Step "2/8 建立 Artifact Registry 倉庫（已存在時略過）"
$repos = Invoke-Gcloud artifacts repositories list --project $Project --location $Region --format "value(name)"
if ($Apply -and $repos -notmatch "$Repository$") {
    Invoke-Gcloud artifacts repositories create $Repository --project $Project --location $Region --repository-format docker --description "HK history self-study images" | Out-Null
} else {
    Write-Host "  已存在或為模擬模式：$Repository" -ForegroundColor DarkGray
}

Write-Step "3/8 建立資料備份用的 Cloud Storage bucket（免費方案：資料庫快照備份）"
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

Write-Step "4/8 建立／更新 Secret Manager 機密"
$existingSecrets = Invoke-Gcloud secrets list --project $Project --format "value(name)"
# 未明確提供時，依序取環境變數、再取本機 .env.local；都沒有就不能覆寫線上已設定的值
$localEnv = Read-LocalEnvFile -FileName ".env.local"
$llmKey = if ($LlmApiKey) { $LlmApiKey } elseif ($env:DEEPSEEK_API_KEY) { $env:DEEPSEEK_API_KEY } else { $localEnv["DEEPSEEK_API_KEY"] }
$googleId = if ($GoogleClientId) { $GoogleClientId } elseif ($env:GOOGLE_CLIENT_ID) { $env:GOOGLE_CLIENT_ID } else { $localEnv["GOOGLE_CLIENT_ID"] }
$googleSecret = if ($GoogleClientSecret) { $GoogleClientSecret } elseif ($env:GOOGLE_CLIENT_SECRET) { $env:GOOGLE_CLIENT_SECRET } else { $localEnv["GOOGLE_CLIENT_SECRET"] }

Ensure-Secret -Name $authSecretName -Existing $existingSecrets
# 只在尚未有版本時產生新的工作階段密鑰；否則每次部署都會令所有已登入使用者被登出。
if ($Apply -and (Get-SecretVersions -Name $authSecretName).Count -eq 0) {
    # 必須使用密碼學安全的隨機來源：Get-Random 以小型種子產生偽隨機序列，
    # 用它產生的密鑰等同可被推導，任何人拿到自己的一個 cookie 就能偽造管理員工作階段。
    $authSecretBytes = New-Object byte[] 48
    $authSecretRng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $authSecretRng.GetBytes($authSecretBytes) } finally { $authSecretRng.Dispose() }
    $authSecret = ($authSecretBytes | ForEach-Object { $_.ToString("x2") }) -join ""
    Add-SecretVersion -Name $authSecretName -Value $authSecret -Label "工作階段簽署密鑰，以密碼學安全隨機來源產生"
} else {
    Write-Host "  保留現有 $authSecretName（避免現有登入狀態失效）" -ForegroundColor DarkGray
}

Ensure-Secret -Name $llmSecretName -Existing $existingSecrets
if ($llmKey) {
    Add-SecretVersion -Name $llmSecretName -Value $llmKey -Label "LLM API key"
} elseif (-not $Apply) {
    Write-Host "  （模擬）更新 $llmSecretName（LLM API key）" -ForegroundColor DarkGray
} elseif ((Get-SecretVersions -Name $llmSecretName).Count -gt 0) {
    # 絕不以佔位值覆寫正在使用的機密（否則線上 AI 出題會靜靜失效）
    Write-Host "  保留現有 $llmSecretName（未提供新的 API key）" -ForegroundColor DarkGray
} else {
    Add-SecretVersion -Name $llmSecretName -Value "REPLACE_ME" -Label "佔位值"
    Write-Warning "未提供 LLM API key：已放入佔位值（可設 DEEPSEEK_API_KEY 或在 .env.local 填寫），否則 AI 出題會回退到示範生成。"
}

Ensure-Secret -Name $googleIdSecretName -Existing $existingSecrets
Ensure-Secret -Name $googleSecretSecretName -Existing $existingSecrets
if ($googleId -and $googleSecret) {
    Add-SecretVersion -Name $googleIdSecretName -Value $googleId -Label "Google OAuth 用戶端 ID"
    Add-SecretVersion -Name $googleSecretSecretName -Value $googleSecret -Label "Google OAuth 用戶端密碼"
} elseif (-not $Apply) {
    Write-Host "  （模擬）更新 $googleIdSecretName／$googleSecretSecretName（Google OAuth 憑證）" -ForegroundColor DarkGray
} elseif ((Get-SecretVersions -Name $googleIdSecretName).Count -gt 0 -and (Get-SecretVersions -Name $googleSecretSecretName).Count -gt 0) {
    Write-Host "  保留現有 Google OAuth 憑證（未提供新的憑證）" -ForegroundColor DarkGray
} else {
    Add-SecretVersion -Name $googleIdSecretName -Value "REPLACE_ME" -Label "佔位值"
    Add-SecretVersion -Name $googleSecretSecretName -Value "REPLACE_ME" -Label "佔位值"
    Write-Warning "未提供 Google OAuth 憑證：已放入佔位值（可設 GOOGLE_CLIENT_ID／GOOGLE_CLIENT_SECRET 或在 .env.local 填寫）。未啟用登入時，Cloud Run 上的後台 API 會被拒絕。"
}

Write-Step "5/8 建立名冊讀取服務帳戶及金鑰"
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

Write-Step "6/8 建立 Cloud Run 執行身分並授權讀取 Secret 及備份 bucket"
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

Write-Step "7/8 以 Cloud Build 建置映像檔並部署到 Cloud Run（約需 5 至 10 分鐘）"
# 未指定名冊 Sheet 時沿用線上服務現有設定，避免以空值覆寫（學生將無法登入）
if (-not $RosterSheetId -and $Apply) {
    $currentSheetId = Invoke-Gcloud run services describe $Service --project $Project --region $Region --format "value(spec.template.spec.containers[0].env.filter(name:STUDENT_ROSTER_SHEET_ID).extract(value).flatten())"
    if ($currentSheetId) {
        $RosterSheetId = "$currentSheetId".Trim()
        Write-Host "  沿用線上現有 STUDENT_ROSTER_SHEET_ID（未指定 -RosterSheetId）" -ForegroundColor DarkGray
    } else {
        Write-Warning "未指定 -RosterSheetId，線上亦沒有現有設定：學生名冊將無法載入。"
    }
}
# --allow-unauthenticated 是切換式旗標（不能寫 =true）；不允許公開存取時留空，改由 IAP／身分權杖保護
$authFlag = if ($AllowUnauthenticated) { "--allow-unauthenticated" } else { "" }
$substitutions = ('_REGION={0},_SERVICE={1},_REPOSITORY={2},_IMAGE_NAME={3},_MAX_INSTANCES={4},_AUTH_FLAG={5},_RUNTIME_SA={6},_ROSTER_SHEET_ID={7},_ROSTER_SHEET_NAME={8},_BACKUP_BUCKET={9},_BACKUP_PREFIX={10},_BACKUP_INTERVAL_SECONDS={11},_ADMIN_EMAILS={12},_TEACHER_EMAILS={13},_STAFF_ACCESS_POLICY={14},_STAFF_DOMAINS={15},_REVIEWER_EMAILS={16},_ROSTER_CLASS_PREFIXES={17}' -f $Region, $Service, $Repository, $ImageName, $MaxInstances, $authFlag, $runtimeServiceAccountEmail, $RosterSheetId, $RosterSheetName, $backupBucketName, $BackupPrefix, $BackupIntervalSeconds, $adminEmailList, $teacherEmailList, $StaffAccessPolicy, $staffDomainList, $reviewerEmailList, $RosterClassPrefixes)
Invoke-Gcloud builds submit --project $Project --config cloudbuild.yaml --substitutions $substitutions --timeout=1800s . | Out-Null

# 已棄用的舊變數不會授予任何權限，但留著會產生 error 級設定警示，也容易令人誤以為仍然生效。
# --set-env-vars 不會移除未列出的變數，因此這裡明確移除（只影響環境變數，不動其他設定）。
$deprecatedVars = @("AUTH_IN_DOMAIN_ROLE", "AUTH_ALLOW_LEGACY_IN_DOMAIN_TEACHER")
if ($Apply) {
    try {
        $present = Invoke-Gcloud run services describe $Service --project $Project --region $Region --format "value(spec.template.spec.containers[0].env[].name)"
        $stale = @($deprecatedVars | Where-Object { $present -split "\s+" -contains $_ })
        if ($stale.Count -gt 0) {
            Write-Host "  移除已棄用的環境變數：$($stale -join ', ')" -ForegroundColor DarkGray
            Invoke-Gcloud run services update $Service --project $Project --region $Region --remove-env-vars ($stale -join ",") --quiet | Out-Null
        } else {
            Write-Host "  沒有已棄用的角色環境變數" -ForegroundColor DarkGray
        }
    } catch {
        Write-Host "  無法自動移除已棄用的環境變數，請手動執行：" -ForegroundColor Yellow
        Write-Host "    gcloud run services update $Service --region=$Region --project $Project --remove-env-vars AUTH_IN_DOMAIN_ROLE,AUTH_ALLOW_LEGACY_IN_DOMAIN_TEACHER" -ForegroundColor Yellow
    }
}

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

Write-Step "8/8 部署結果"
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
