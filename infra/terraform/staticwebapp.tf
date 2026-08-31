resource "azurerm_static_web_app" "web" {
  name                = local.web_name
  resource_group_name = azurerm_resource_group.this.name
  location            = local.swa_location
  sku_tier            = var.swa_sku
  sku_size            = var.swa_sku
  tags                = local.tags
}
