# Read-only checks for Gap 1 Key Vault + App Service wiring.
# Usage: .\backend\scripts\verify-kv-appservice.ps1

param(
  [string]$VaultName = "runpipe2-kv-dev",
  [string]$ResourceGroup = "rg-runpipe-dev-2",
  [string]$AppName = "runpipe2-api"
)

$ErrorActionPreference = "Stop"
$failed = $false

function Ok($msg) { Write-Host "[OK]  $msg" -ForegroundColor Green }
function Bad($msg) { Write-Host "[FAIL] $msg" -ForegroundColor Red; $script:failed = $true }
function Info($msg) { Write-Host "[..]  $msg" }

Write-Host "=== Verify Gap 1: $AppName + $VaultName ==="
Write-Host ""

try {
  $null = Invoke-RestMethod -Uri "https://$AppName.azurewebsites.net/health" -TimeoutSec 60
  Ok "App health responds"
} catch {
  Bad "App health failed: $($_.Exception.Message)"
}

$principalId = az webapp identity show --name $AppName --resource-group $ResourceGroup --query principalId -o tsv 2>$null
if ($principalId) { Ok "System MI principalId=$principalId" }
else { Bad "System-assigned managed identity not enabled" }

if ($principalId) {
  $sub = az account show --query id -o tsv
  $scope = "/subscriptions/$sub/resourceGroups/$ResourceGroup/providers/Microsoft.KeyVault/vaults/$VaultName"
  $roles = @(az role assignment list --assignee $principalId --scope $scope --query "[].roleDefinitionName" -o tsv)
  $roleText = ($roles -join ", ")
  if ($roleText -match "Key Vault Secrets User" -or $roleText -match "Key Vault Administrator") {
    Ok "MI has Key Vault secret read role: $roleText"
  } else {
    Bad "MI missing Key Vault Secrets User on $VaultName (roles: $roleText)"
    Info "Ask an admin (Owner / User Access Administrator) to assign Key Vault Secrets User to principalId=$principalId"
  }
}

$secretNames = @(az keyvault secret list --vault-name $VaultName --query "[].name" -o tsv)
Info "Vault secrets: $($secretNames -join ', ')"
$refreshSecrets = @($secretNames | Where-Object { $_ -eq "PP-REFRESH-TOKEN" -or $_ -eq "runpipev2-dev-pp-sync-refreshToken" })
if ($refreshSecrets.Count -gt 0) { Ok "Refresh token secret present: $($refreshSecrets -join ', ')" }
else { Bad "No refresh-token secret (PP-REFRESH-TOKEN or runpipev2-dev-pp-sync-refreshToken)" }

$settings = az webapp config appsettings list --name $AppName --resource-group $ResourceGroup -o json | ConvertFrom-Json
$map = @{}
foreach ($s in $settings) { $map[$s.name] = $s.value }

foreach ($req in @("PP_INVENTORY_AUTH", "PP_INVENTORY_CLIENT_ID", "PP_REFRESH_TOKEN")) {
  if (-not $map.ContainsKey($req)) { Bad "Missing app setting $req"; continue }
  if ($req -eq "PP_INVENTORY_AUTH" -and $map[$req] -ne "delegated") {
    Bad "PP_INVENTORY_AUTH=$($map[$req]) (expected delegated)"
  } elseif ($req -eq "PP_REFRESH_TOKEN") {
    $v = [string]$map[$req]
    if ($v.StartsWith("@Microsoft.KeyVault") -and $v.EndsWith(")")) {
      Ok "PP_REFRESH_TOKEN is a Key Vault reference"
    } else {
      Bad "PP_REFRESH_TOKEN is not a valid Key Vault reference (run fix-pp-refresh-kvref.ps1)"
    }
  } else {
    Ok "$req is set"
  }
}

Info "In Portal: App Service -> Environment variables -> confirm PP_REFRESH_TOKEN shows Resolved."
Info "Deploy check: production must include backend/powerPlatform/delegatedAuth.js and @azure/msal-node."

Write-Host ""
if ($failed) {
  Write-Host "Verification FAILED - fix items above, then re-run." -ForegroundColor Red
  exit 1
}
Write-Host "Verification PASSED (config). Next: trigger inventory_sync as admin and confirm job success." -ForegroundColor Green
