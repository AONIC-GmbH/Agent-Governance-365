# Smoke-test the scheduled job trigger (correct secret from Key Vault).
# Usage:
#   .\backend\scripts\test-internal-job-trigger.ps1
#   .\backend\scripts\test-internal-job-trigger.ps1 -JobType inventory_sync

param(
  [string]$AppName = "runpipe2-api",
  [string]$VaultName = "runpipe2-kv-dev",
  [string]$SecretName = "INTERNAL-JOB-TRIGGER-SECRET",
  [string]$JobType = "inventory_sync",
  [string]$TenantId = "t1"
)

$ErrorActionPreference = "Stop"
$secret = az keyvault secret show --vault-name $VaultName --name $SecretName --query value -o tsv
if (-not $secret) { throw "Could not read $SecretName from $VaultName" }

$url = "https://$AppName.azurewebsites.net/internal/jobs/$JobType/run"
Write-Host "POST $url"
$resp = Invoke-RestMethod -Method Post -Uri $url `
  -Headers @{ "x-internal-job-secret" = $secret } `
  -ContentType "application/json" `
  -Body (@{ tenant_id = $TenantId } | ConvertTo-Json)
$resp | ConvertTo-Json -Depth 5
Write-Host "OK: job accepted. Check GET /admin/jobs/runs?type=$JobType as admin for status."
