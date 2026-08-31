variable "subscription_id" {
  type        = string
  description = "Azure subscription ID (required by the azurerm 4.x provider)."
  default     = ""
}

variable "prefix" {
  type        = string
  description = "Short name used in resource names (current hosted apps use runpipe2)."
  default     = "runpipe"
}

variable "environment" {
  type        = string
  description = "Environment label (dev, staging, prod)."
  default     = "dev"
}

variable "location" {
  type        = string
  description = "Azure region for most resources."
  default     = "westeurope"
}

variable "swa_location" {
  type        = string
  description = "Static Web Apps region (subset of Azure regions). Empty = same as location when supported, else westeurope."
  default     = ""
}

variable "resource_group_name" {
  type        = string
  description = "Resource group name. Empty = rg-<prefix>-<environment>."
  default     = ""
}

variable "api_name" {
  type        = string
  description = "App Service name (globally unique). Empty = <prefix>-api[-suffix]."
  default     = ""
}

variable "web_name" {
  type        = string
  description = "Static Web App name. Empty = <prefix>-web[-suffix]."
  default     = ""
}

variable "postgres_name" {
  type        = string
  description = "Postgres Flexible Server name (globally unique). Empty = <prefix>-pg-<environment>[-suffix]."
  default     = ""
}

variable "key_vault_name" {
  type        = string
  description = "Key Vault name (3-24 chars, globally unique). Empty = derived from prefix."
  default     = ""
}

variable "name_suffix" {
  type        = string
  description = "Optional suffix for globally unique names (no leading dash)."
  default     = ""
}

variable "app_service_sku" {
  type        = string
  description = "App Service plan SKU (F1, B1, S1, P0v3, P1v3, …)."
  default     = "B1"
}

variable "node_version" {
  type        = string
  description = "Linux Web App Node stack (22-lts or 20-lts)."
  default     = "22-lts"
}

variable "postgres_sku" {
  type        = string
  description = "Postgres Flexible Server SKU (e.g. B_Standard_B1ms, GP_Standard_D2s_v3)."
  default     = "B_Standard_B1ms"
}

variable "postgres_version" {
  type        = string
  description = "PostgreSQL major version."
  default     = "16"
}

variable "postgres_storage_mb" {
  type        = number
  description = "Postgres storage in MB (32768 = 32 GB)."
  default     = 32768
}

variable "postgres_ha" {
  type        = bool
  description = "Zone-redundant HA (requires a General Purpose SKU, not burstable)."
  default     = false
}

variable "pg_admin_login" {
  type        = string
  description = "Postgres admin login (cannot be azure_superuser, admin, root, …)."
  default     = "runpipeadmin"
}

variable "postgres_network_mode" {
  type        = string
  description = "public_azure (current), public_app_outbound, or private_endpoint."
  default     = "public_azure"

  validation {
    condition     = contains(["public_azure", "public_app_outbound", "private_endpoint"], var.postgres_network_mode)
    error_message = "postgres_network_mode must be public_azure, public_app_outbound, or private_endpoint."
  }
}

variable "developer_ip" {
  type        = string
  description = "Your public IP for Postgres firewall (migrate/seed from a laptop). Empty = skip."
  default     = ""
}

variable "extra_postgres_firewall_ips" {
  type        = list(string)
  description = "Additional Postgres firewall IPs (e.g. App Service outbound IPs after the first apply)."
  default     = []
}

variable "swa_sku" {
  type        = string
  description = "Static Web App SKU: Free or Standard."
  default     = "Free"
}

variable "enable_app_insights" {
  type        = bool
  description = "Create Log Analytics + Application Insights and wire the API."
  default     = true
}

variable "enable_nightly_jobs" {
  type        = bool
  description = "Create a Logic App (system MI) that reads INTERNAL-JOB-TRIGGER-SECRET from Key Vault and POSTs inventory_sync every night."
  default     = false
}

variable "nightly_job_hour_utc" {
  type        = number
  description = "Hour (UTC) for the nightly Logic App."
  default     = 2
}

variable "entra_tenant_id" {
  type        = string
  description = "Entra directory ID for API JWT validation. Empty = set later in the portal."
  default     = ""
}

variable "entra_client_id" {
  type        = string
  description = "SPA (or API) app registration client ID. Empty = set later in the portal."
  default     = ""
}

variable "default_tenant_id" {
  type        = string
  description = "Runpipe app-tenant id (seed uses t1)."
  default     = "t1"
}

variable "tags" {
  type        = map(string)
  description = "Extra tags merged onto every resource."
  default     = {}
}
