# Azure infrastructure (Terraform)

This folder provisions the same **production shape** as the current hosted Runpipe
environment, with SKUs you can change:

| Resource | Current hosted example | Terraform default |
|----------|------------------------|-------------------|
| Resource group | `rg-runpipe-dev-2` | `rg-runpipe-dev` (or names from the wizard) |
| Linux App Service (Node 22) | `runpipe2-api` | `<prefix>-api-…` on plan **B1** |
| Static Web App | `runpipe2-web` | `<prefix>-web-…` **Free** |
| Postgres Flexible Server | `runpipe2-pg-dev` | `<prefix>-pg-dev-…` **B_Standard_B1ms** / v16 |
| Key Vault (RBAC) | `runpipe2-kv-dev` | `<prefix>-kv-dev-…` |
| Application Insights | (not required today) | **on** (optional in the wizard) |
| Logic App nightly job | optional | **off** unless you enable it; system MI GET secret then POST `inventory_sync` only. Extra job POSTs are added in the portal if needed. |

## Generate config

From the repo root (Node 22+):

```sh
npm run setup:azure
```

The wizard defaults to values close to the current stack and explains alternatives
(Free vs Standard SWA, F1/S1/P1v3 App Service, burstable vs general-purpose
Postgres, public firewall vs private endpoint).

Non-interactive (unique suffix, West Europe, B1 + B1ms + SWA Free + Insights):

```sh
npm run setup:azure -- --yes
```

This writes **gitignored** `infra/terraform/terraform.tfvars`. See
`terraform.tfvars.example` for every variable.

## Apply

```sh
az login
cd infra/terraform
terraform init
terraform plan
terraform apply
```

The azurerm 4.x provider needs a subscription id (`subscription_id` in tfvars, or
`ARM_SUBSCRIPTION_ID`).

Passwords are created by Terraform (`random_password`) and stored in Key Vault.
They are **not** written to tfvars. When `enable_nightly_jobs` is true, the Logic
App uses a system-assigned identity (Key Vault Secrets User) to GET the job
secret at runtime, then POSTs **only** `inventory_sync`. Extra POSTs for
`powerbi_inventory_sync` or `copilot_kit_usage_sync` are not in Terraform — add
them in the Logic App designer if you need those inventories (same secret
header). See README §5.3.

## After apply

```sh
terraform output
terraform output -raw next_steps
terraform output -raw static_web_app_api_token   # GitHub secret
```

Point `DATABASE_URL` at the Key Vault secret `DATABASE-URL` (already referenced
from App Service settings) and run:

```sh
npm run db:migrate -w backend
npm run db:seed -w backend
```

Add the Static Web App hostname to the Entra SPA redirect URIs and keep
`ALLOWED_ORIGINS` in sync (Terraform sets it from the SWA hostname).

Entra app registrations, Power Platform refresh tokens, and Power BI / Dataverse
secrets are **not** created here — see [`DEPLOYMENT.md`](../DEPLOYMENT.md).

## Remote state (optional)

Local state is fine for a first environment. For a shared/prod subscription, create
a storage account out of band and add a backend block, for example:

```hcl
terraform {
  backend "azurerm" {
    resource_group_name  = "rg-runpipe-tfstate"
    storage_account_name = "runpipetfstate"
    container_name       = "tfstate"
    key                  = "runpipe.tfstate"
  }
}
```
