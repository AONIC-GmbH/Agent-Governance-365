-- Azure Postgres schema (adapted from Supabase migrations; no auth.users dependency)

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tool_name TEXT NOT NULL DEFAULT 'Runpipe';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_bytes BYTEA;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_content_type TEXT;

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent so the whole schema can be re-applied (migrations) safely.
DO $$ BEGIN
  CREATE TYPE app_role AS ENUM ('admin', 'user');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS user_roles (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'user',
  UNIQUE (user_id, role)
);

CREATE TABLE IF NOT EXISTS components (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  environments TEXT[] NOT NULL DEFAULT '{}',
  owner_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'unassigned',
  url TEXT NOT NULL DEFAULT ''
);

-- Fine-grained artifact kind (e.g. powerbi_report), denormalized from inventory.
ALTER TABLE components ADD COLUMN IF NOT EXISTS kind TEXT;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  service_user TEXT,
  production_access_status TEXT NOT NULL DEFAULT 'none',
  production_deploy_status TEXT NOT NULL DEFAULT 'none',
  answers JSONB NOT NULL DEFAULT '{}'
);

-- A project is not environment-specific; a component carries its own location.
ALTER TABLE projects DROP COLUMN IF EXISTS environments;

-- Admin-managed organisational units (options for projects.business_unit_id).
CREATE TABLE IF NOT EXISTS business_units (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_business_units_tenant_name
  ON business_units (tenant_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_business_units_tenant_active
  ON business_units (tenant_id, is_active, sort_order);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS business_unit_id TEXT REFERENCES business_units(id) ON DELETE SET NULL;

-- Admin-configurable compliance / business-information questionnaire.
CREATE TABLE IF NOT EXISTS compliance_questions (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  prompt       TEXT NOT NULL,
  answer_type  TEXT NOT NULL DEFAULT 'text',  -- text | select
  options      TEXT[] NOT NULL DEFAULT '{}',
  required     BOOLEAN NOT NULL DEFAULT true,
  sort_order   INT NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_compliance_questions_tenant
  ON compliance_questions (tenant_id, is_active, sort_order);

-- Admin-managed Discovery tags (Domain / Capability).
CREATE TABLE IF NOT EXISTS project_tag_definitions (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  group_key   TEXT NOT NULL,  -- domain | capability
  name        TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_tag_definitions_tenant_group_name
  ON project_tag_definitions (tenant_id, group_key, lower(name));
CREATE INDEX IF NOT EXISTS idx_project_tag_definitions_tenant
  ON project_tag_definitions (tenant_id, is_active, group_key, sort_order);

CREATE TABLE IF NOT EXISTS project_tags (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag_id     TEXT NOT NULL REFERENCES project_tag_definitions(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_project_tags_tag ON project_tags (tag_id);

CREATE TABLE IF NOT EXISTS project_components (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, component_id)
);

-- One component (agent) belongs to at most one project.
DELETE FROM project_components pc
 WHERE EXISTS (
   SELECT 1 FROM project_components keep
    WHERE keep.component_id = pc.component_id
      AND keep.ctid < pc.ctid
 );
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_components_component
  ON project_components (component_id);

CREATE TABLE IF NOT EXISTS project_collaborators (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS tenant_email_domains (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, domain)
);

CREATE TABLE IF NOT EXISTS service_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assigned_to TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_components_owner ON components(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_profiles_tenant ON profiles(tenant_id);

-- Raw Power Platform inventory layer ("everything that exists in the tenant").
-- Populated by the inventory_sync job from the Power Platform Inventory API.
-- Curated `components` link here via components.source_inventory_id.
CREATE TABLE IF NOT EXISTS inventory_items (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  resource_id     TEXT NOT NULL,            -- PP resource 'name' (GUID)
  resource_type   TEXT NOT NULL,            -- e.g. microsoft.powerapps/canvasapps
  kind            TEXT NOT NULL,            -- normalized: environment|canvasapp|modeldrivenapp|cloudflow|agent
  display_name    TEXT,
  environment_id  TEXT,                     -- null for environment rows themselves
  location        TEXT,
  owner_external  TEXT,                     -- human-readable owner (UPN / display name); NOT an FK
  owner_aad_id    TEXT,                     -- Entra Object ID (JWT oid); joins to profiles.id
  created_at_src  TIMESTAMPTZ,
  modified_at_src TIMESTAMPTZ,
  raw             JSONB NOT NULL DEFAULT '{}',
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (tenant_id, resource_type, resource_id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_tenant_kind ON inventory_items(tenant_id, kind);
CREATE INDEX IF NOT EXISTS idx_inventory_env ON inventory_items(environment_id);
-- Added after initial release; idempotent for already-provisioned databases.
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS owner_aad_id TEXT;
CREATE INDEX IF NOT EXISTS idx_inventory_owner_aad ON inventory_items(owner_aad_id);

-- Explicit scope so Power BI workspaces are not stuffed into environment_id.
-- scope_type: environment | workspace | none
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS scope_type TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS scope_id TEXT;
CREATE INDEX IF NOT EXISTS idx_inventory_scope
  ON inventory_items(tenant_id, scope_type, scope_id);

-- Generic async job tracking, shared by all Power Platform jobs
-- (inventory_sync now; solution_import later). `stats`/`params` are job-specific.
CREATE TABLE IF NOT EXISTS job_runs (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_type      TEXT NOT NULL,                   -- inventory_sync | solution_import | ...
  trigger       TEXT NOT NULL,                   -- manual | scheduled | chained
  status        TEXT NOT NULL DEFAULT 'running', -- running | success | failed | canceled
  requested_by  TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  params        JSONB NOT NULL DEFAULT '{}',
  stats         JSONB NOT NULL DEFAULT '{}',
  error         TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_runs_type_status ON job_runs(tenant_id, job_type, status);

-- At most one active (running) run per (tenant, job_type): this partial unique
-- index is the concurrency lock; a concurrent trigger gets a 23505 -> 409.
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_runs_active
  ON job_runs(tenant_id, job_type)
  WHERE status = 'running';

-- Curated components optionally point back to the raw inventory item they came from.
ALTER TABLE components
  ADD COLUMN IF NOT EXISTS source_inventory_id TEXT REFERENCES inventory_items(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_components_source_inventory
  ON components(source_inventory_id)
  WHERE source_inventory_id IS NOT NULL;

-- Environment linkage is by id; `components.environments` keeps display labels only.
ALTER TABLE components ADD COLUMN IF NOT EXISTS environment_id TEXT;
CREATE INDEX IF NOT EXISTS idx_components_environment
  ON components(tenant_id, environment_id)
  WHERE environment_id IS NOT NULL;

-- Admin-selected scope for promoting inventory_items -> components (Runpipe registration).
-- Empty arrays mean "nothing selected" (import is a no-op), not "import everything".
CREATE TABLE IF NOT EXISTS component_import_settings (
  tenant_id         TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  kinds             TEXT[] NOT NULL DEFAULT '{}',
  environment_ids   TEXT[] NOT NULL DEFAULT '{}',
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        TEXT REFERENCES profiles(id) ON DELETE SET NULL
);

ALTER TABLE component_import_settings
  ADD COLUMN IF NOT EXISTS workspace_ids TEXT[] NOT NULL DEFAULT '{}';

-- First-class Power Platform environments (curated from inventory sync).
CREATE TABLE IF NOT EXISTS environments (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  environment_id      TEXT NOT NULL,
  display_name        TEXT,
  environment_type    TEXT,
  region              TEXT,
  is_managed          BOOLEAN,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  source_inventory_id TEXT REFERENCES inventory_items(id) ON DELETE SET NULL,
  last_synced_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, environment_id)
);
CREATE INDEX IF NOT EXISTS idx_environments_tenant_active
  ON environments(tenant_id, is_active);

-- First-class Power BI / Fabric workspaces (curated from powerbi_inventory_sync).
CREATE TABLE IF NOT EXISTS workspaces (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_id        TEXT NOT NULL,
  display_name        TEXT,
  workspace_type      TEXT,
  state               TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  source_inventory_id TEXT REFERENCES inventory_items(id) ON DELETE SET NULL,
  last_synced_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS idx_workspaces_tenant_active
  ON workspaces(tenant_id, is_active);

-- Power Platform emits the default environment as both `Default-{guid}` and
-- `default-{guid}`. Store one canonical spelling everywhere so ids join reliably.
UPDATE environments
   SET environment_id = 'Default-' || substring(environment_id from 9)
 WHERE environment_id ILIKE 'default-%'
   AND environment_id NOT LIKE 'Default-%';

UPDATE inventory_items
   SET environment_id = 'Default-' || substring(environment_id from 9)
 WHERE environment_id ILIKE 'default-%'
   AND environment_id NOT LIKE 'Default-%';

UPDATE inventory_items
   SET scope_id = 'Default-' || substring(scope_id from 9)
 WHERE scope_id ILIKE 'default-%'
   AND scope_id NOT LIKE 'Default-%';

UPDATE component_import_settings
   SET environment_ids = ARRAY(
     SELECT CASE
              WHEN x ILIKE 'default-%' AND x NOT LIKE 'Default-%'
                THEN 'Default-' || substring(x from 9)
              ELSE x
            END
       FROM unnest(environment_ids) AS x
   )
 WHERE EXISTS (
   SELECT 1 FROM unnest(environment_ids) AS y
    WHERE y ILIKE 'default-%' AND y NOT LIKE 'Default-%'
 );

-- The guid is the environment identity; `Default-{guid}` and the bare `{guid}`
-- returned by the admin APIs must never coexist as separate rows.
DELETE FROM environments e
 WHERE EXISTS (
   SELECT 1 FROM environments keep
    WHERE keep.tenant_id = e.tenant_id
      AND lower(regexp_replace(keep.environment_id, '^default-', '', 'i'))
        = lower(regexp_replace(e.environment_id, '^default-', '', 'i'))
      AND keep.ctid < e.ctid
 );

CREATE UNIQUE INDEX IF NOT EXISTS uq_environments_tenant_env_key
  ON environments (tenant_id, lower(regexp_replace(environment_id, '^default-', '', 'i')));

CREATE INDEX IF NOT EXISTS idx_inventory_env_key
  ON inventory_items (tenant_id, lower(regexp_replace(environment_id, '^default-', '', 'i')));

-- Point curated components at the curated environment row, resolved by guid.
UPDATE components c
   SET environment_id = COALESCE(e.environment_id, i.environment_id)
  FROM inventory_items i
  LEFT JOIN environments e
    ON e.tenant_id = i.tenant_id
   AND lower(regexp_replace(e.environment_id, '^default-', '', 'i'))
     = lower(regexp_replace(i.environment_id, '^default-', '', 'i'))
 WHERE c.source_inventory_id = i.id
   AND i.environment_id IS NOT NULL
   AND c.environment_id IS DISTINCT FROM COALESCE(e.environment_id, i.environment_id);

-- Labels follow the curated environment name once the id link exists.
UPDATE components c
   SET environments = ARRAY[e.display_name]
  FROM environments e
 WHERE c.environment_id IS NOT NULL
   AND e.tenant_id = c.tenant_id
   AND e.environment_id = c.environment_id
   AND e.display_name IS NOT NULL
   AND c.environments IS DISTINCT FROM ARRAY[e.display_name];

-- Daily Copilot credit consumption from Copilot Agent Kit (cat_agentusagehistories).
CREATE TABLE IF NOT EXISTS agent_usage_daily (
  id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_id          TEXT NOT NULL,
  usage_date         DATE NOT NULL,
  billed_credits     NUMERIC(18, 4) NOT NULL DEFAULT 0,
  unbilled_credits   NUMERIC(18, 4) NOT NULL DEFAULT 0,
  agent_resource_id  TEXT,
  inventory_item_id  TEXT REFERENCES inventory_items(id) ON DELETE SET NULL,
  environment_id     TEXT,
  feature            TEXT,
  display_name       TEXT,
  raw                JSONB NOT NULL DEFAULT '{}',
  last_synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active          BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (tenant_id, source_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_usage_daily_tenant_date
  ON agent_usage_daily (tenant_id, usage_date)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_agent_usage_daily_agent
  ON agent_usage_daily (tenant_id, agent_resource_id)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_agent_usage_daily_inventory
  ON agent_usage_daily (inventory_item_id)
  WHERE inventory_item_id IS NOT NULL;

-- Admin-configured EUR rates for credit → euro conversion by date range.
CREATE TABLE IF NOT EXISTS credit_rate_cards (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label            TEXT NOT NULL DEFAULT '',
  euro_per_credit  NUMERIC(18, 8) NOT NULL,
  effective_from   DATE NOT NULL,
  effective_to     DATE,
  updated_by       TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credit_rate_cards_tenant
  ON credit_rate_cards (tenant_id, effective_from);
