# 以線上現有設定重新部署，避免用到 cloudbuild.yaml 內的空預設值。
# 只讀取現有設定 → 組 substitutions → gcloud builds submit。
$ErrorActionPreference = "Stop"
$Project = "amiable-nirvana-500300-a0"
$Region = "asia-east2"
$Service = "history-self-study"

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
Write-Host "roster sheet id   : $($subs['_ROSTER_SHEET_ID'])"
Write-Host "backup bucket     : $($subs['_BACKUP_BUCKET'])"
Write-Host "backup interval   : $($subs['_BACKUP_INTERVAL_SECONDS'])"

$missing = @()
foreach ($k in @("_ADMIN_EMAILS", "_TEACHER_EMAILS", "_ROSTER_SHEET_ID", "_BACKUP_BUCKET", "_BACKUP_INTERVAL_SECONDS")) {
    if ([string]::IsNullOrWhiteSpace($subs[$k])) { $missing += $k }
}
if ([string]::IsNullOrWhiteSpace($RuntimeSA)) { $missing += "RUNTIME_SA" }
if ($missing.Count -gt 0) {
    Write-Host "拒絕部署：以下必要設定讀不到 -> $($missing -join ', ')" -ForegroundColor Red
    exit 1
}

$subArg = ($subs.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ","
Write-Host "`n=== 開始建置及部署 ==="
gcloud builds submit --project $Project --config cloudbuild.yaml --substitutions "$subArg"
exit $LASTEXITCODE
