resource "azurerm_virtual_network" "this" {
  count               = local.use_private_db ? 1 : 0
  name                = "${var.prefix}-vnet-${var.environment}"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  address_space       = ["10.42.0.0/16"]
  tags                = local.tags
}

resource "azurerm_subnet" "appservice" {
  count                = local.use_private_db ? 1 : 0
  name                 = "snet-appservice"
  resource_group_name  = azurerm_resource_group.this.name
  virtual_network_name = azurerm_virtual_network.this[0].name
  address_prefixes     = ["10.42.1.0/24"]

  delegation {
    name = "web"
    service_delegation {
      name = "Microsoft.Web/serverFarms"
      actions = [
        "Microsoft.Network/virtualNetworks/subnets/action",
      ]
    }
  }
}

resource "azurerm_subnet" "privatelink" {
  count                            = local.use_private_db ? 1 : 0
  name                             = "snet-privatelink"
  resource_group_name              = azurerm_resource_group.this.name
  virtual_network_name             = azurerm_virtual_network.this[0].name
  address_prefixes                 = ["10.42.2.0/24"]
  private_endpoint_network_policies = "Disabled"
}

resource "azurerm_private_dns_zone" "postgres" {
  count               = local.use_private_db ? 1 : 0
  name                = "privatelink.postgres.database.azure.com"
  resource_group_name = azurerm_resource_group.this.name
  tags                = local.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "postgres" {
  count                 = local.use_private_db ? 1 : 0
  name                  = "${var.prefix}-pg-dns"
  resource_group_name   = azurerm_resource_group.this.name
  private_dns_zone_name = azurerm_private_dns_zone.postgres[0].name
  virtual_network_id    = azurerm_virtual_network.this[0].id
}

resource "azurerm_private_endpoint" "postgres" {
  count               = local.use_private_db ? 1 : 0
  name                = "${var.prefix}-pe-pg-${var.environment}"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  subnet_id           = azurerm_subnet.privatelink[0].id
  tags                = local.tags

  private_service_connection {
    name                           = "pg"
    private_connection_resource_id = azurerm_postgresql_flexible_server.this.id
    subresource_names              = ["postgresqlServer"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "pg"
    private_dns_zone_ids = [azurerm_private_dns_zone.postgres[0].id]
  }
}
