# Fixes PP_REFRESH_TOKEN Key Vault reference on runpipe2-api via `az rest`
# (avoids Windows cmd/@ parenthesis mangling). Requires: az login.
#
# Usage: .\backend\scripts\fix-pp-refresh-kvref.ps1

param(
  [string]$ResourceGroup = "rg-runpipe-dev-2",
  [string]$AppName = "runpipe2-api",
  [string]$VaultName = "runpipe2-kv-dev",
  [string]$SecretName = "runpipev2-dev-pp-sync-refreshToken"
)

$ErrorActionPreference = "Stop"

$sub = (az account show --query id -o tsv).Trim()
if (-not $sub) { throw "az account show failed - run az login" }

$listUrl = "https://management.azure.com/subscriptions/$sub/resourceGroups/$ResourceGroup/providers/Microsoft.Web/sites/$AppName/config/appsettings/list?api-version=2022-03-01"
$putUrl = "https://management.azure.com/subscriptions/$sub/resourceGroups/$ResourceGroup/providers/Microsoft.Web/sites/$AppName/config/appsettings?api-version=2022-03-01"

$tmpList = Join-Path $env:TEMP "runpipe-appsettings-list.json"
$tmpPut = Join-Path $env:TEMP "runpipe-appsettings-put.json"
$mergeJs = Join-Path $PSScriptRoot "merge-pp-refresh-setting.js"

$json = az rest --method post --url $listUrl --output json
if ($LASTEXITCODE -ne 0) { throw "Failed to list appsettings" }
[System.IO.File]::WriteAllText($tmpList, $json)

$correct = "@Microsoft.KeyVault(SecretUri=https://$VaultName.vault.azure.net/secrets/$SecretName/)"
node $mergeJs $tmpList $correct $tmpPut
if ($LASTEXITCODE -ne 0) { throw "merge-pp-refresh-setting.js failed" }

# az rest --body @file  (PowerShell: quote so @file is literal for az)
az rest --method put --url $putUrl --body "@$tmpPut" --headers "Content-Type=application/json" --output none
if ($LASTEXITCODE -ne 0) { throw "Failed to PUT appsettings" }

$checkPath = Join-Path $env:TEMP "runpipe-pp-refresh-check.txt"
az rest --method post --url $listUrl --query "properties.PP_REFRESH_TOKEN" -o tsv | Set-Content -Path $checkPath -Encoding utf8
$v = (Get-Content -Raw $checkPath).Trim()
if (-not ($v.StartsWith("@Microsoft.KeyVault") -and $v.EndsWith(")"))) {
  throw "PP_REFRESH_TOKEN looks malformed after PUT (len=$($v.Length))"
}
Write-Host "OK: PP_REFRESH_TOKEN Key Vault reference set (len=$($v.Length))"

az webapp restart --name $AppName --resource-group $ResourceGroup --output none
Write-Host "OK: restarted $AppName"
Write-Host "Reminder: MI needs Key Vault Secrets User on $VaultName."
Write-Host "Next: .\backend\scripts\verify-kv-appservice.ps1"
