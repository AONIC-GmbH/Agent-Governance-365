locals {
  suffix = var.name_suffix != "" ? "-${var.name_suffix}" : ""

  resource_group_name = var.resource_group_name != "" ? var.resource_group_name : "rg-${var.prefix}-${var.environment}"
  api_name            = var.api_name != "" ? var.api_name : "${var.prefix}-api${local.suffix}"
  web_name            = var.web_name != "" ? var.web_name : "${var.prefix}-web${local.suffix}"
  postgres_name       = var.postgres_name != "" ? var.postgres_name : "${var.prefix}-pg-${var.environment}${local.suffix}"

  kv_generated = replace("${var.prefix}-kv-${var.environment}${local.suffix}", "_", "-")
  key_vault_name = var.key_vault_name != "" ? var.key_vault_name : (
    length(local.kv_generated) <= 24 ? local.kv_generated : substr(replace(local.kv_generated, "-", ""), 0, 24)
  )

  swa_supported = toset([
    "westeurope", "eastus2", "centralus", "westus2", "eastasia", "canadacentral",
  ])
  swa_location = var.swa_location != "" ? var.swa_location : (
    contains(local.swa_supported, var.location) ? var.location : "westeurope"
  )

  always_on = !contains(["F1", "D1"], var.app_service_sku)
  use_private_db = var.postgres_network_mode == "private_endpoint"
  allow_azure_pg = var.postgres_network_mode == "public_azure"

  tags = merge(
    {
      project     = "runpipe"
      environment = var.environment
      managed_by  = "terraform"
    },
    var.tags,
  )

  database_url = format(
    "postgresql://%s:%s@%s:5432/%s?sslmode=require",
    var.pg_admin_login,
    urlencode(random_password.pg_admin.result),
    azurerm_postgresql_flexible_server.this.fqdn,
    azurerm_postgresql_flexible_server_database.app.name,
  )

  kv_ref = {
    database_url = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.database_url.versionless_id})"
    job_secret   = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.job_trigger.versionless_id})"
  }
}
