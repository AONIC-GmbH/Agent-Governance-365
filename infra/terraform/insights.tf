resource "azurerm_log_analytics_workspace" "this" {
  count               = var.enable_app_insights ? 1 : 0
  name                = "${var.prefix}-logs-${var.environment}"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  sku                 = "PerGB2018"
  retention_in_days   = var.environment == "prod" ? 90 : 30
  tags                = local.tags
}

resource "azurerm_application_insights" "this" {
  count               = var.enable_app_insights ? 1 : 0
  name                = "${var.prefix}-ai-${var.environment}"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  workspace_id        = azurerm_log_analytics_workspace.this[0].id
  application_type    = "web"
  tags                = local.tags
}
