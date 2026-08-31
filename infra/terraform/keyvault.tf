resource "azurerm_key_vault" "this" {
  name                          = local.key_vault_name
  location                      = azurerm_resource_group.this.location
  resource_group_name           = azurerm_resource_group.this.name
  tenant_id                     = data.azurerm_client_config.current.tenant_id
  sku_name                      = "standard"
  rbac_authorization_enabled    = true
  purge_protection_enabled      = var.environment == "prod"
  soft_delete_retention_days    = var.environment == "prod" ? 90 : 7
  public_network_access_enabled = true
  tags                          = local.tags
}

resource "azurerm_role_assignment" "deployer_kv_admin" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Administrator"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_role_assignment" "api_kv_secrets" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_linux_web_app.api.identity[0].principal_id
}

resource "azurerm_role_assignment" "logic_app_kv_secrets" {
  count                = var.enable_nightly_jobs ? 1 : 0
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_logic_app_workflow.nightly[0].identity[0].principal_id
}

resource "time_sleep" "kv_rbac" {
  depends_on      = [azurerm_role_assignment.deployer_kv_admin]
  create_duration = "60s"
}

resource "azurerm_key_vault_secret" "database_url" {
  name         = "DATABASE-URL"
  value        = local.database_url
  key_vault_id = azurerm_key_vault.this.id
  depends_on   = [time_sleep.kv_rbac]
}

resource "azurerm_key_vault_secret" "job_trigger" {
  name         = "INTERNAL-JOB-TRIGGER-SECRET"
  value        = random_password.job_trigger.result
  key_vault_id = azurerm_key_vault.this.id
  depends_on   = [time_sleep.kv_rbac]
}

resource "azurerm_key_vault_secret" "pg_password" {
  name         = "POSTGRES-ADMIN-PASSWORD"
  value        = random_password.pg_admin.result
  key_vault_id = azurerm_key_vault.this.id
  depends_on   = [time_sleep.kv_rbac]
}
