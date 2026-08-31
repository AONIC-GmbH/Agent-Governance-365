# Configures Key Vault + App Service for delegated inventory_sync (Gap 1).
# Prerequisites: az login, Key Vault Secrets Officer (secrets), Contributor on App Service,
# and User Access Administrator (or Owner) to assign Key Vault Secrets User to the app MI.
#
# Usage (from repo root):
#   .\backend\scripts\configure-kv-appservice.ps1
#   .\backend\scripts\configure-kv-appservice.ps1 -SkipSecretUpload -RefreshTokenSecretName runpipev2-dev-pp-sync-refreshToken
#   .\backend\scripts\configure-kv-appservice.ps1 -RefreshTokenPath .\backend\.pp-refresh-token

param(
  [string]$VaultName = "runpipe2-kv-dev",
  [string]$ResourceGroup = "rg-runpipe-dev-2",
  [string]$AppName = "runpipe2-api",
  # Prefer plan name; vault already has runpipev2-dev-pp-sync-refreshToken
  [string]$RefreshTokenSecretName = "runpipev2-dev-pp-sync-refreshToken",
  [string]$RefreshTokenPath = "",
  [string]$InventoryClientId = "",
  [switch]$SkipSecretUpload,
  [switch]$SkipRestart
)

$ErrorActionPreference = "Stop"

function Resolve-RefreshTokenPath {
  if ($RefreshTokenPath) { return $RefreshTokenPath }
  $candidates = @(
    Join-Path $PSScriptRoot "..\.pp-refresh-token"
    Join-Path (Get-Location) "backend\.pp-refresh-token"
    Join-Path (Get-Location) ".pp-refresh-token"
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { return (Resolve-Path $c).Path }
  }
  return $null
}

function Set-AppSettingsViaCmd {
  param([hashtable]$Settings)
  # Windows az.cmd treats leading @ as a batch escape; @@ becomes a single @ for Key Vault refs.
  $pairs = foreach ($k in $Settings.Keys) {
    $v = [string]$Settings[$k]
    if ($v.StartsWith("@Microsoft.KeyVault")) {
      $v = "@" + $v  # -> @@Microsoft.KeyVault(...)
    }
    # Quote values that contain parentheses
    "`"$k=$v`""
  }
  $joined = $pairs -join " "
  $line = "az webapp config appsettings set --name `"$AppName`" --resource-group `"$ResourceGroup`" --output none --settings $joined"
  Write-Host "Running: az webapp config appsettings set ... ($($Settings.Count) keys)"
  cmd /c $line
  if ($LASTEXITCODE -ne 0) { throw "Failed to set App Service application settings (exit $LASTEXITCODE)" }
}

Write-Host "=== Gap 1: Key Vault + App Service ($AppName) ==="

# --- A. Secrets ---
if (-not $SkipSecretUpload) {
  $tokenFile = Resolve-RefreshTokenPath
  if (-not $tokenFile) {
    throw "No refresh token file found. Pass -RefreshTokenPath or create backend\.pp-refresh-token (bootstrap-inventory-token.js)."
  }
  $token = (Get-Content -Raw -Path $tokenFile).Trim()
  if (-not $token) { throw "Refresh token file is empty: $tokenFile" }

  Write-Host "Setting Key Vault secret $RefreshTokenSecretName (value not printed)..."
  az keyvault secret set --vault-name $VaultName --name $RefreshTokenSecretName --value $token --output none
  if ($LASTEXITCODE -ne 0) { throw "Failed to set secret $RefreshTokenSecretName" }
  Write-Host "OK: $RefreshTokenSecretName"

  $jobSecretName = "INTERNAL-JOB-TRIGGER-SECRET"
  $existingJob = az keyvault secret list --vault-name $VaultName --query "[?name=='$jobSecretName'].name" -o tsv
  if (-not $existingJob) {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $jobSecret = [Convert]::ToBase64String($bytes)
    az keyvault secret set --vault-name $VaultName --name $jobSecretName --value $jobSecret --output none
    Write-Host "OK: created $jobSecretName"
  } else {
    Write-Host "OK: $jobSecretName already exists"
  }
} else {
  Write-Host "Skipping secret upload (-SkipSecretUpload). Ensure $RefreshTokenSecretName exists in $VaultName."
  $found = az keyvault secret list --vault-name $VaultName --query "[?name=='$RefreshTokenSecretName'].name" -o tsv
  if (-not $found) {
    throw "Secret '$RefreshTokenSecretName' not found in $VaultName. Create it or pass -RefreshTokenSecretName <existing-name>."
  }
}

# --- B. Managed identity + RBAC ---
Write-Host "Enabling system-assigned managed identity on $AppName..."
$ident = az webapp identity assign --name $AppName --resource-group $ResourceGroup -o json | ConvertFrom-Json
$principalId = $ident.principalId
if (-not $principalId) { throw "Failed to get managed identity principalId" }
Write-Host "principalId=$principalId"

$sub = az account show --query id -o tsv
$scope = "/subscriptions/$sub/resourceGroups/$ResourceGroup/providers/Microsoft.KeyVault/vaults/$VaultName"
$role = "Key Vault Secrets User"
$existingRole = az role assignment list --assignee $principalId --scope $scope --query "[?roleDefinitionName=='$role'].id" -o tsv
if ($existingRole) {
  Write-Host "OK: already has $role"
} else {
  Write-Host "Assigning $role on $VaultName..."
  az role assignment create `
    --assignee-object-id $principalId `
    --assignee-principal-type ServicePrincipal `
    --role $role `
    --scope $scope `
    --output none 2>&1 | Tee-Object -Variable roleOut
  if ($LASTEXITCODE -ne 0) {
    Write-Warning @"
Could not assign '$role' (need Owner / User Access Administrator on the vault).
Ask an admin to grant Key Vault Secrets User to App Service MI:
  principalId=$principalId
  vault=$VaultName
Or in Portal: Key Vault -> Access control (IAM) -> Add role assignment.
"@
    Write-Host $roleOut
  } else {
    Write-Host "OK: assigned $role (RBAC may take 1-2 minutes to propagate)"
  }
}

# --- C. App settings ---
if (-not $InventoryClientId) {
  $envFile = Join-Path $PSScriptRoot "..\.env"
  if (Test-Path $envFile) {
    $line = Get-Content $envFile | Where-Object { $_ -match '^\s*PP_INVENTORY_CLIENT_ID\s*=' } | Select-Object -First 1
    if ($line) {
      $InventoryClientId = ($line -replace '^\s*PP_INVENTORY_CLIENT_ID\s*=\s*', '').Trim().Trim('"').Trim("'")
    }
  }
}
if (-not $InventoryClientId) {
  throw "Pass -InventoryClientId <guid> (Entra app used for device-code / refresh)."
}

$secretUri = "https://$VaultName.vault.azure.net/secrets/$RefreshTokenSecretName/"
$kvRef = "@Microsoft.KeyVault(SecretUri=$secretUri)"

$settings = [ordered]@{
  PP_INVENTORY_AUTH      = "delegated"
  PP_INVENTORY_CLIENT_ID = $InventoryClientId
  PP_TENANT_ID           = "c989b650-28e2-456f-bbdc-d6020ef438ea"
  PP_REFRESH_TOKEN       = $kvRef
}
$jobExists = az keyvault secret list --vault-name $VaultName --query "[?name=='INTERNAL-JOB-TRIGGER-SECRET'].name" -o tsv
if ($jobExists) {
  $settings["INTERNAL_JOB_TRIGGER_SECRET"] = "@Microsoft.KeyVault(SecretUri=https://$VaultName.vault.azure.net/secrets/INTERNAL-JOB-TRIGGER-SECRET/)"
}

Set-AppSettingsViaCmd -Settings $settings
Write-Host "OK: app settings updated"
Write-Host "  PP_REFRESH_TOKEN -> $kvRef"

if (-not $SkipRestart) {
  Write-Host "Restarting $AppName..."
  az webapp restart --name $AppName --resource-group $ResourceGroup --output none
  Write-Host "OK: restarted"
}

Write-Host ""
Write-Host "=== Done ==="
Write-Host "Next: run backend\scripts\verify-kv-appservice.ps1"
Write-Host "Then as admin: POST /admin/jobs/inventory_sync/run on https://$AppName.azurewebsites.net"
Write-Host "Note: delegated-auth backend code must be deployed (push backend/** to main)."
