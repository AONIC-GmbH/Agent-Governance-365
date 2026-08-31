# One-liner for an Azure Owner / User Access Administrator to grant the App Service
# managed identity permission to read Key Vault secrets (Gap 1 blocker).
#
# App: runpipe2-api
# Vault: runpipe2-kv-dev
# MI principalId: 8d04a6dc-503b-48b8-a171-2eccdeb788bd

param(
  [string]$PrincipalId = "8d04a6dc-503b-48b8-a171-2eccdeb788bd",
  [string]$VaultName = "runpipe2-kv-dev",
  [string]$ResourceGroup = "rg-runpipe-dev-2"
)

$ErrorActionPreference = "Stop"
$sub = az account show --query id -o tsv
$scope = "/subscriptions/$sub/resourceGroups/$ResourceGroup/providers/Microsoft.KeyVault/vaults/$VaultName"

az role assignment create `
  --assignee-object-id $PrincipalId `
  --assignee-principal-type ServicePrincipal `
  --role "Key Vault Secrets User" `
  --scope $scope `
  --output table
if ($LASTEXITCODE -ne 0) {
  throw "role assignment create failed (exit $LASTEXITCODE). Need Owner / User Access Administrator on the vault."
}

Write-Host "OK: Key Vault Secrets User assigned. Wait 1-2 minutes, then restart runpipe2-api and re-run verify-kv-appservice.ps1"
