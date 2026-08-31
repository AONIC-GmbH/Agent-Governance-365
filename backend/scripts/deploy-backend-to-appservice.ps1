# Stages backend like .github/workflows/backend.yml and deploys to runpipe2-api.
# Deploys local workspace including powerPlatform/ + @azure/msal-node (Gap 1).
# Requires: az login with rights to deploy the web app.
#
# Usage: .\backend\scripts\deploy-backend-to-appservice.ps1

param(
  [string]$ResourceGroup = "rg-runpipe-dev-2",
  [string]$AppName = "runpipe2-api"
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$backendSrc = Join-Path $repoRoot "backend"
$stage = Join-Path $env:TEMP "runpipe-backend-deploy"
$zip = Join-Path $env:TEMP "runpipe-backend-deploy.zip"

Write-Host "Staging backend from $backendSrc -> $stage"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Path $stage | Out-Null

# Mirror CI: copy backend without node_modules/.env, then npm install --omit=dev
$exclude = @("node_modules", ".env", ".pp-refresh-token")
Get-ChildItem -Path $backendSrc -Force | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object {
  Copy-Item -Path $_.FullName -Destination (Join-Path $stage $_.Name) -Recurse -Force
}

Push-Location $stage
try {
  npm install --omit=dev --no-package-lock
  if (-not (Test-Path "node_modules\@azure\msal-node")) {
    throw "@azure/msal-node missing after install"
  }
  if (-not (Test-Path "powerPlatform\delegatedAuth.js")) {
    throw "powerPlatform/delegatedAuth.js missing from stage"
  }
} finally {
  Pop-Location
}

if (Test-Path $zip) { Remove-Item -Force $zip }
Write-Host "Creating zip $zip"
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -Force

Write-Host "Deploying to $AppName..."
# Package already contains node_modules; Oryx rebuild fails on zip deploy.
az webapp config appsettings set --name $AppName --resource-group $ResourceGroup --settings SCM_DO_BUILD_DURING_DEPLOYMENT=false --output none
az webapp deploy --resource-group $ResourceGroup --name $AppName --src-path $zip --type zip --async false
if ($LASTEXITCODE -ne 0) { throw "az webapp deploy failed" }

Write-Host "OK: deployed. Checking health..."
Start-Sleep -Seconds 5
try {
  $h = Invoke-RestMethod -Uri "https://$AppName.azurewebsites.net/health" -TimeoutSec 60
  Write-Host ("health: " + ($h | ConvertTo-Json -Compress))
} catch {
  Write-Warning "Health check failed after deploy: $($_.Exception.Message)"
}
Write-Host "Done. Run verify-kv-appservice.ps1, then trigger inventory_sync as admin."
