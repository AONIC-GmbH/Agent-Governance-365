resource "azurerm_resource_group" "this" {
  name     = local.resource_group_name
  location = var.location
  tags     = local.tags
}

resource "random_password" "pg_admin" {
  length  = 24
  special = true
}

resource "random_password" "job_trigger" {
  length  = 48
  special = false
}
