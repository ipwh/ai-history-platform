# 以線上現有設定重新部署，避免用到 cloudbuild.yaml 內的空預設值。
# 只讀取現有設定 → 組 substitutions → gcloud builds submit。
#
# 專案**必須**是 pccss-ai-history：舊專案 amiable-nirvana-500300-a0 已停用。
# （2026-10-19 的部署曾因這裡硬編碼舊專案而更新了錯誤的服務。）
param(
    [string]$Project = "pccss-ai-history",
    [string]$Region = "asia-east2",
    [string]$Service = "history-self-study"
)
$ErrorActionPreference = "Stop"

function Get-EnvValue([string]$name) {
    $v = gcloud run services describe $Service --project $Project --region $Region `
        --format "value(spec.template.spec.containers[0].env.filter(name:$name).extract(value).flatten())" 2>$null
    if ($null -eq $v) { return "" }
    return ($v -join "").Trim()
}

$RuntimeSA = (gcloud run services describe $Service --project $Project --region $Region `
    --format "value(spec.template.spec.serviceAccountName)" 2>$null).Trim()

$subs = [ordered]@{
    "_REGION"                    = $Region
    "_SERVICE"                   = $Service
    "_REPOSITORY"                = "history"
    "_IMAGE_NAME"                = "hk-history-self-study"
    "_MAX_INSTANCES"             = "1"
    "_RUNTIME_SA"                = $RuntimeSA
    "_AUTH_FLAG"                 = "--allow-unauthenticated"
    "_ROSTER_SHEET_ID"           = (Get-EnvValue "STUDENT_ROSTER_SHEET_ID")
    "_ROSTER_SHEET_NAME"         = (Get-EnvValue "STUDENT_ROSTER_SHEET_NAME")
    "_ROSTER_COLUMN_NAME"        = (Get-EnvValue "STUDENT_ROSTER_COLUMN_NAME")
    "_ROSTER_CLASS_PREFIXES"     = (Get-EnvValue "STUDENT_ROSTER_CLASS_PREFIXES")
    "_ADMIN_EMAILS"              = (Get-EnvValue "AUTH_ADMIN_EMAILS")
    "_TEACHER_EMAILS"            = (Get-EnvValue "AUTH_TEACHER_EMAILS")
    # 學科審核者名單必須一併沿用：cloudbuild.yaml 的 _REVIEWER_EMAILS 預設是空字串，
    # 若不傳遞，每次用本指令碼部署都會把 HISTORY_REVIEWER_EMAILS 清空，令 Golden fixture
    # 及「已修復並核准」的學科裁決全部 fail-closed 回 403（2026-10-24 的 revision 00056
    # 就是這樣失去設定的）。留空仍然合法（= 一律 fail-closed），但會在下面明確警告。
    "_REVIEWER_EMAILS"           = (Get-EnvValue "HISTORY_REVIEWER_EMAILS")
    "_STAFF_ACCESS_POLICY"       = (Get-EnvValue "AUTH_STAFF_ACCESS_POLICY")
    "_STAFF_DOMAINS"             = (Get-EnvValue "AUTH_STAFF_DOMAINS")
    "_BACKUP_BUCKET"             = (Get-EnvValue "BACKUP_BUCKET")
    "_BACKUP_PREFIX"             = (Get-EnvValue "BACKUP_PREFIX")
    "_BACKUP_INTERVAL_SECONDS"   = (Get-EnvValue "BACKUP_INTERVAL_SECONDS")
}

Write-Host "=== 沿用線上設定 ==="
Write-Host "runtime SA        : $RuntimeSA"
Write-Host "admin             : $($subs['_ADMIN_EMAILS'])"
Write-Host "teacher count     : $(($subs['_TEACHER_EMAILS'] -split ';').Count)"
Write-Host "staff policy      : $($subs['_STAFF_ACCESS_POLICY'])"
Write-Host "reviewer emails   : $($subs['_REVIEWER_EMAILS'])"
Write-Host "roster sheet id   : $($subs['_ROSTER_SHEET_ID'])"
Write-Host "backup bucket     : $($subs['_BACKUP_BUCKET'])"
Write-Host "backup interval   : $($subs['_BACKUP_INTERVAL_SECONDS'])"

$missing = @()
foreach ($k in @("_ADMIN_EMAILS", "_ROSTER_SHEET_ID", "_BACKUP_BUCKET", "_BACKUP_INTERVAL_SECONDS")) {
    if ([string]::IsNullOrWhiteSpace($subs[$k])) { $missing += $k }
}
# 教師名單只在 allowlist 政策下必要；school-domain 政策由 AUTH_STAFF_DOMAINS 授權全校教職員。
if ($subs["_STAFF_ACCESS_POLICY"] -ne "school-domain" -and [string]::IsNullOrWhiteSpace($subs["_TEACHER_EMAILS"])) {
    $missing += "_TEACHER_EMAILS"
}
if ($subs["_STAFF_ACCESS_POLICY"] -eq "school-domain" -and [string]::IsNullOrWhiteSpace($subs["_STAFF_DOMAINS"])) {
    $missing += "_STAFF_DOMAINS"
}
if ([string]::IsNullOrWhiteSpace($RuntimeSA)) { $missing += "RUNTIME_SA" }
if ($missing.Count -gt 0) {
    Write-Host "拒絕部署：以下必要設定讀不到 -> $($missing -join ', ')" -ForegroundColor Red
    exit 1
}

# 學科審核者可留空（= 一律 fail-closed），但部署後擁有者將無法核准 Golden 及學科裁決，
# 因此明確提示，而不是靜靜地部署一個沒人能覆核的環境。
if ([string]::IsNullOrWhiteSpace($subs["_REVIEWER_EMAILS"])) {
    Write-Host "警告：HISTORY_REVIEWER_EMAILS 為空，部署後無人可核准 Golden fixture 及學科裁決（fail-closed 403）。" -ForegroundColor Yellow
}

$subArg = ($subs.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ","
Write-Host "`n=== 開始建置及部署 ==="
gcloud builds submit --project $Project --config cloudbuild.yaml --substitutions "$subArg"
exit $LASTEXITCODE
