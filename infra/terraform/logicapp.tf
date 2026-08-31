# Nightly job: GET INTERNAL-JOB-TRIGGER-SECRET, then POST inventory_sync only.
# Additional POSTs (powerbi_inventory_sync, copilot_kit_usage_sync) are added in
# the Logic App designer when those inventories are needed — see README §5.3.

resource "azurerm_logic_app_workflow" "nightly" {
  count               = var.enable_nightly_jobs ? 1 : 0
  name                = "${var.prefix}-nightly-${var.environment}"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  tags                = local.tags

  identity {
    type = "SystemAssigned"
  }
}

resource "azurerm_logic_app_trigger_recurrence" "nightly" {
  count        = var.enable_nightly_jobs ? 1 : 0
  name         = "every-night"
  logic_app_id = azurerm_logic_app_workflow.nightly[0].id
  frequency    = "Day"
  interval     = 1
  start_time   = format("2026-01-01T%02d:00:00Z", var.nightly_job_hour_utc)
}

# Consumption Logic Apps cannot resolve App Service @Microsoft.KeyVault(...) refs.
# Fetch the secret at runtime with the Logic App managed identity.
resource "azurerm_logic_app_action_custom" "get_job_secret" {
  count        = var.enable_nightly_jobs ? 1 : 0
  name         = "get-job-secret"
  logic_app_id = azurerm_logic_app_workflow.nightly[0].id
  body = jsonencode({
    type = "Http"
    inputs = {
      method = "GET"
      uri    = "${azurerm_key_vault.this.vault_uri}secrets/${azurerm_key_vault_secret.job_trigger.name}?api-version=7.4"
      authentication = {
        type = "ManagedServiceIdentity"
      }
    }
  })

  depends_on = [
    azurerm_logic_app_trigger_recurrence.nightly,
    azurerm_role_assignment.logic_app_kv_secrets,
  ]
}

resource "azurerm_logic_app_action_custom" "inventory_sync" {
  count        = var.enable_nightly_jobs ? 1 : 0
  name         = "trigger-inventory-sync"
  logic_app_id = azurerm_logic_app_workflow.nightly[0].id
  body = jsonencode({
    type = "Http"
    inputs = {
      method = "POST"
      uri    = "https://${azurerm_linux_web_app.api.default_hostname}/internal/jobs/inventory_sync/run"
      headers = {
        "Content-Type"          = "application/json"
        "x-internal-job-secret" = "@body('get-job-secret')?['value']"
      }
      body = {
        tenant_id = var.default_tenant_id
      }
    }
    runAfter = {
      "get-job-secret" = ["Succeeded"]
    }
  })

  depends_on = [azurerm_logic_app_action_custom.get_job_secret]
}
