resource "azurerm_postgresql_flexible_server" "this" {
  name                          = local.postgres_name
  resource_group_name           = azurerm_resource_group.this.name
  location                      = azurerm_resource_group.this.location
  version                       = var.postgres_version
  sku_name                      = var.postgres_sku
  administrator_login           = var.pg_admin_login
  administrator_password        = random_password.pg_admin.result
  storage_mb                    = var.postgres_storage_mb
  backup_retention_days         = var.environment == "prod" ? 14 : 7
  public_network_access_enabled = !local.use_private_db
  tags                          = local.tags

  authentication {
    password_auth_enabled         = true
    active_directory_auth_enabled = false
  }

  dynamic "high_availability" {
    for_each = var.postgres_ha && startswith(var.postgres_sku, "GP_") ? [1] : []
    content {
      mode = "ZoneRedundant"
    }
  }

  lifecycle {
    ignore_changes = [zone]
  }
}

resource "azurerm_postgresql_flexible_server_database" "app" {
  name      = "runpipe"
  server_id = azurerm_postgresql_flexible_server.this.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

resource "azurerm_postgresql_flexible_server_firewall_rule" "allow_azure" {
  count            = local.allow_azure_pg ? 1 : 0
  name             = "AllowAllAzureServices"
  server_id        = azurerm_postgresql_flexible_server.this.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

resource "azurerm_postgresql_flexible_server_firewall_rule" "developer" {
  count            = (!local.use_private_db && var.developer_ip != "") ? 1 : 0
  name             = "DeveloperIp"
  server_id        = azurerm_postgresql_flexible_server.this.id
  start_ip_address = var.developer_ip
  end_ip_address   = var.developer_ip
}

resource "azurerm_postgresql_flexible_server_firewall_rule" "extra" {
  for_each = !local.use_private_db ? toset(var.extra_postgres_firewall_ips) : toset([])

  name             = "Extra-${replace(each.value, ".", "-")}"
  server_id        = azurerm_postgresql_flexible_server.this.id
  start_ip_address = each.value
  end_ip_address   = each.value
}
