output "resource_group_name" {
  value = azurerm_resource_group.this.name
}

output "api_hostname" {
  value = azurerm_linux_web_app.api.default_hostname
}

output "api_url" {
  value = "https://${azurerm_linux_web_app.api.default_hostname}"
}

output "web_hostname" {
  value = azurerm_static_web_app.web.default_host_name
}

output "web_url" {
  value = "https://${azurerm_static_web_app.web.default_host_name}"
}

output "static_web_app_api_token" {
  value       = azurerm_static_web_app.web.api_key
  sensitive   = true
  description = "GitHub secret AZURE_STATIC_WEB_APPS_API_TOKEN"
}

output "api_outbound_ip_addresses" {
  value       = azurerm_linux_web_app.api.possible_outbound_ip_address_list
  description = "If postgres_network_mode is public_app_outbound, copy these into extra_postgres_firewall_ips and re-apply."
}

output "postgres_fqdn" {
  value = azurerm_postgresql_flexible_server.this.fqdn
}

output "postgres_database" {
  value = azurerm_postgresql_flexible_server_database.app.name
}

output "postgres_admin_login" {
  value = var.pg_admin_login
}

output "key_vault_name" {
  value = azurerm_key_vault.this.name
}

output "key_vault_uri" {
  value = azurerm_key_vault.this.vault_uri
}

output "app_insights_connection_string" {
  value     = var.enable_app_insights ? azurerm_application_insights.this[0].connection_string : null
  sensitive = true
}

output "next_steps" {
  value = <<-EOT
    1. terraform output -raw static_web_app_api_token  → GitHub secret AZURE_STATIC_WEB_APPS_API_TOKEN
    2. Download the App Service publish profile (or switch the workflow to OIDC) → AZURE_WEBAPP_PUBLISH_PROFILE
    3. Add the SWA URL to Entra SPA redirect URIs
    4. If postgres_network_mode is public_app_outbound:
         terraform output -json api_outbound_ip_addresses
         → extra_postgres_firewall_ips in terraform.tfvars → terraform apply
    5. Restart the App Service if Key Vault references are still unresolved (RBAC delay)
    6. Migrate: DATABASE_URL from Key Vault secret DATABASE-URL, then:
         npm run db:migrate -w backend
         npm run db:seed -w backend
    7. Build the frontend with:
         VITE_API_BASE_URL=https://${azurerm_linux_web_app.api.default_hostname}
         VITE_ENTRA_TENANT_ID / VITE_ENTRA_CLIENT_ID
    8. Optional: store PP_REFRESH_TOKEN in Key Vault and set a Key Vault reference on the App Service
    9. Nightly Logic App (if enabled) GETs INTERNAL-JOB-TRIGGER-SECRET then POSTs inventory_sync only. Add extra POSTs in the designer for Power BI or Copilot Kit — see README §5.3.
  EOT
}
