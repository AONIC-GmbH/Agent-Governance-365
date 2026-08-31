resource "azurerm_service_plan" "this" {
  name                = "${var.prefix}-plan-${var.environment}"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  os_type             = "Linux"
  sku_name            = var.app_service_sku
  tags                = local.tags
}

resource "azurerm_linux_web_app" "api" {
  name                = local.api_name
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  service_plan_id     = azurerm_service_plan.this.id
  https_only          = true
  tags                = local.tags

  virtual_network_subnet_id = local.use_private_db ? azurerm_subnet.appservice[0].id : null

  identity {
    type = "SystemAssigned"
  }

  site_config {
    always_on                         = local.always_on
    ftps_state                        = "Disabled"
    health_check_path                 = local.always_on ? "/health" : null
    health_check_eviction_time_in_min = local.always_on ? 5 : null
    minimum_tls_version               = "1.2"

    application_stack {
      node_version = var.node_version
    }
  }

  app_settings = merge(
    {
      WEBSITE_RUN_FROM_PACKAGE          = "1"
      SCM_DO_BUILD_DURING_DEPLOYMENT    = "false"
      DATABASE_SSL                      = "true"
      DATABASE_URL                      = local.kv_ref.database_url
      DEFAULT_TENANT_ID                 = var.default_tenant_id
      INTERNAL_JOB_TRIGGER_SECRET       = local.kv_ref.job_secret
      ALLOWED_ORIGINS                   = "https://${azurerm_static_web_app.web.default_host_name}"
    },
    var.entra_tenant_id != "" ? { ENTRA_TENANT_ID = var.entra_tenant_id } : {},
    var.entra_client_id != "" ? { ENTRA_CLIENT_ID = var.entra_client_id } : {},
    var.enable_app_insights ? {
      APPLICATIONINSIGHTS_CONNECTION_STRING = azurerm_application_insights.this[0].connection_string
      ApplicationInsightsAgent_EXTENSION_VERSION = "~3"
    } : {},
  )

  lifecycle {
    ignore_changes = [
      # Deployed by GitHub Actions / zip deploy; don't clobber extra settings from scripts.
      app_settings["PP_REFRESH_TOKEN"],
      app_settings["PP_INVENTORY_AUTH"],
      app_settings["PP_INVENTORY_CLIENT_ID"],
      app_settings["PP_TENANT_ID"],
      app_settings["PBI_CLIENT_ID"],
      app_settings["PBI_CLIENT_SECRET"],
      app_settings["DATAVERSE_URL"],
      app_settings["DATAVERSE_CLIENT_ID"],
      app_settings["DATAVERSE_CLIENT_SECRET"],
      app_settings["ENTRA_CLIENT_SECRET"],
    ]
  }
}
