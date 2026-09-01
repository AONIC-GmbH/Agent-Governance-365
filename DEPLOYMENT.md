# Deployment guide

After cloning this open-source tree, follow this guide to configure identity,
optional inventory connectors, cloud resources, and deployment for **your**
tenant. Do not commit real secrets; use gitignored `.env` files locally and
App Service / Key Vault settings in Azure.

See [`README.md`](README.md#architecture) for the architecture diagram and
an overview of what Agent Governance 365 does.

---

## Prerequisites

- Node.js 22+ and npm
- A Microsoft Entra (Azure AD) tenant you can register apps in
- (Production) Azure subscription for Postgres, App Service, Static Web Apps
- Power Platform admin rights for inventory sync
- (Optional) Fabric / Power BI tenant admin API access for Power BI sync
- Dataverse access to a Copilot Agent Kit environment for usage/credits sync

---

## 1. Local quick start (no Entra)

Useful for UI and API smoke tests with the in-memory store.

```sh
npm install

# frontend/.env.development
VITE_MOCK_MODE=true
VITE_API_BASE_URL=http://localhost:7071

# backend/.env — leave DATABASE_URL unset; leave ENTRA_* as your-… placeholders
PORT=7071
DEFAULT_TENANT_ID=t1

npm run dev:all
```

- Frontend: Vite port (often `http://localhost:8080`)
- Backend: `http://localhost:7071/health`

With mock mode off and no Entra client ID, the UI uses a seeded local user and
talks to the live API (memory store if `DATABASE_URL` is unset).

---

## 2. Create Entra app registrations

You typically need **two** (optionally more) app registrations in **your**
tenant.

### 2.1 SPA (frontend login)

1. Azure Portal → Microsoft Entra ID → App registrations → **New registration**
2. Name e.g. `agent-governance-365-spa`
3. Supported account types: single tenant (recommended)
4. Redirect URI → **Single-page application**:
   - `http://localhost:8080` (and/or your Vite port)
   - `https://<your-static-web-app-hostname>`
5. Note **Application (client) ID** and **Directory (tenant) ID**
6. No client secret required for public SPA + MSAL

Frontend env:

```env
VITE_MOCK_MODE=false
VITE_API_BASE_URL=http://localhost:7071
VITE_ENTRA_TENANT_ID=<directory-tenant-id>
VITE_ENTRA_CLIENT_ID=<spa-client-id>
```

Backend JWT validation (same tenant + **same SPA client ID** as audience, or
your API app if you use a dedicated API audience):

```env
ENTRA_TENANT_ID=<directory-tenant-id>
ENTRA_CLIENT_ID=<spa-client-id>
```

### 2.2 Graph directory search (optional)

For people-picker against Microsoft Graph (`User.Read.All` **application**
permission + admin consent), create a client secret on an app (often the SPA
app or a dedicated API app) and set:

```env
ENTRA_CLIENT_SECRET=<secret>
```

Without this, directory search returns empty results; profiles already in the
DB still work.

### 2.3 Power Platform inventory sync

Inventory Resource Query requires **delegated** auth (not app-only).

1. App registration e.g. `agent-governance-365-pp-inventory`
2. Authentication → **Allow public client flows** = Yes
3. API permissions → add **Power Platform** → Delegated → **Query resources**
   (and grant consent as needed)
4. Bootstrap a refresh token as a user who can query inventory:

```sh
cd backend
# PP_TENANT_ID / PP_INVENTORY_CLIENT_ID set in .env
node scripts/bootstrap-inventory-token.js
```

Store the printed refresh token in `PP_REFRESH_TOKEN` (local) or Key Vault
(production). Never commit it.

```env
PP_INVENTORY_AUTH=delegated
PP_INVENTORY_CLIENT_ID=<pp-inventory-app-client-id>
PP_TENANT_ID=<directory-tenant-id>
PP_REFRESH_TOKEN=<refresh-token>
PP_API_BASE_URL=https://api.powerplatform.com
```

### 2.4 Power BI / Fabric inventory (optional)

1. App registration with a client secret
2. Enable Power BI / Fabric **tenant admin** APIs for service principals
   (tenant settings in the Power BI / Fabric admin portal)
3. Grant the SP access as required by your org for Admin/Scanner APIs

```env
PBI_CLIENT_ID=<pbi-app-client-id>
PBI_CLIENT_SECRET=<secret>
PBI_API_BASE_URL=https://api.powerbi.com
```

### 2.5 Copilot Agent Kit usage

Copilot credit usage is read from the Agent Kit Dataverse table
`cat_agentusagehistories`. Add the app registration as an Application User in
that environment with read access:

```env
COPILOT_KIT_DATAVERSE_URL=https://orgXXXXXXXX.crm.dynamics.com
COPILOT_KIT_DATAVERSE_TENANT_ID=<tenant-id>
COPILOT_KIT_DATAVERSE_CLIENT_ID=<sp-client-id>
COPILOT_KIT_DATAVERSE_CLIENT_SECRET=<secret>
```

Tenant/client/secret fall back to `PP_*` when unset. Leave
`COPILOT_KIT_DATAVERSE_URL` empty to skip this job.

---

## 3. Backend and frontend env reference

Copy templates and fill for your environment:

| File | Template |
|------|----------|
| `backend/.env` | [`backend/.env.example`](backend/.env.example) |
| `frontend/.env.development` | [`frontend/.env.example`](frontend/.env.example) |

### Frontend

| Variable | Purpose |
|----------|---------|
| `VITE_MOCK_MODE` | `true` = static mock data, no login |
| `VITE_API_BASE_URL` | API base URL |
| `VITE_ENTRA_TENANT_ID` | Entra directory ID |
| `VITE_ENTRA_CLIENT_ID` | SPA app client ID |
| `VITE_ENTRA_API_SCOPE` | Optional custom API scope |

### Backend (core)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres URL; **unset = in-memory store** |
| `DATABASE_SSL` | `true` for Azure Postgres |
| `USE_MEMORY_STORE` | `1` forces memory store (tests / local e2e) |
| `ENTRA_TENANT_ID` / `ENTRA_CLIENT_ID` | JWT validation; `your-…` placeholders disable auth |
| `DEFAULT_TENANT_ID` | Fallback app tenant id (seed uses `t1`) |
| `ALLOWED_ORIGINS` | Extra CORS origins (comma-separated); `localhost` and `127.0.0.1` always allowed |
| `PORT` | Default `7071` |
| `INTERNAL_JOB_TRIGGER_SECRET` | Shared secret for `POST /internal/jobs/:jobType/run` |

See [`backend/.env.example`](backend/.env.example) for Power Platform, Power BI,
Copilot Agent Kit, and Key Vault reference patterns.

---

## 4. Database

### Local / Azure Postgres

1. Create a PostgreSQL database (Azure Flexible Server recommended in cloud).
2. Allow your client IP / App Service outbound access via firewall or VNet.
3. Set `DATABASE_URL` and usually `DATABASE_SSL=true`.
4. Apply schema and optional seed:

```sh
npm run db:migrate -w backend
npm run db:seed -w backend
```

Seed creates demo tenant `t1`, profiles, and sample projects. Align
`DEFAULT_TENANT_ID` with that id unless you create your own tenant row.

### Single-tenant model

Agent Governance 365 is designed for **one customer organization** per deployment:

1. **Entra tenant** — identity directory (users may have many email domains).
2. **App tenant** (`tenants` table) — product workspace. Users map by email
   domain (`tenant_email_domains`) or fall back to `DEFAULT_TENANT_ID`.

Keep `DEFAULT_TENANT_ID` equal to your single app-tenant id so everyone lands
in the same workspace and shares inventory.

### Admin Company settings

After migrate/seed, an admin configures the deployment under **Admin → Company**:

- **Company name** and **tool name** (header / login / browser title)
- **Logo** upload (PNG/JPEG/WebP, max 512 KB; stored in Postgres)
- **Business units** — options for the required business-unit field on create project
- **Compliance questions** — configurable questionnaire (select or free text) on create project
- **Email domains** — map user email domains to this app tenant

The app tenant id itself is **not** edited in the UI; set it via `DEFAULT_TENANT_ID`
and the `tenants` row (seed uses `t1`).

---

## 5. Azure resources to create (production shape)

Generate Terraform for this layout (defaults follow a typical small Azure
setup; the wizard also lists other SKUs, regions, and network modes):

```sh
npm run setup:azure
cd infra/terraform && terraform init && terraform plan
```

See [`infra/README.md`](infra/README.md). Typical layout (names are examples — choose your own):

| Resource | Role |
|----------|------|
| Resource group | Container for all resources |
| Azure Database for PostgreSQL Flexible Server | Primary data store |
| App Service (Linux, Node 22) | Hosts Express API |
| Static Web Apps | Hosts built frontend |
| Key Vault | Secrets (`PP_REFRESH_TOKEN`, `INTERNAL_JOB_TRIGGER_SECRET`, DB password, …) |
| (Optional) Logic App or Timer Function | Nightly job trigger |
| (Optional) Application Insights | Monitoring |

### 5.1 App Service (API)

1. Create Web App, runtime **Node 22 LTS** (or custom container later).
2. Enable **system-assigned managed identity**.
3. Grant that identity **Key Vault Secrets User** on your vault.
4. Configure **Application settings** (not committed files), for example:
   - `DATABASE_URL` (or Key Vault reference)
   - `DATABASE_SSL=true`
   - `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`
   - `DEFAULT_TENANT_ID`
   - `ALLOWED_ORIGINS=https://<your-swa-hostname>`
   - `PP_*` / `PBI_*` / `COPILOT_KIT_DATAVERSE_*` as needed
   - `INTERNAL_JOB_TRIGGER_SECRET` (plain or Key Vault reference)
5. Key Vault reference form:

```text
@Microsoft.KeyVault(SecretUri=https://<vault>.vault.azure.net/secrets/<secret-name>/)
```

6. Restart the app after setting references; confirm they show as **Resolved**.
7. Deploy API code (GitHub Action zip deploy, `az webapp deploy`, or your
   org's pipeline). Ensure `node_modules` are included or built on the server
   so workspace-hoisted deps are not missing.

Health check: `GET https://<api-host>/health`

### 5.2 Static Web App (frontend)

1. Create a Static Web App linked to your repo or deploy from CI.
2. Build app with production env:

```text
VITE_MOCK_MODE=false
VITE_API_BASE_URL=https://<api-host>
VITE_ENTRA_TENANT_ID=<tenant>
VITE_ENTRA_CLIENT_ID=<spa-client-id>
```

3. Include SPA routing config (`frontend/staticwebapp.config.json`) in the
   build output so deep links work.
4. Add the SWA URL to the SPA app registration redirect URIs and to
   `ALLOWED_ORIGINS` on the API.

### 5.3 Nightly inventory (after API is live)

1. Store a long random value in Key Vault as `INTERNAL-JOB-TRIGGER-SECRET`.
2. On App Service, set `INTERNAL_JOB_TRIGGER_SECRET` to a **Key Vault reference** (not the plaintext secret):

```text
@Microsoft.KeyVault(SecretUri=https://<vault>.vault.azure.net/secrets/INTERNAL-JOB-TRIGGER-SECRET/)
```

3. Create a **Consumption Logic App** (Recurrence) with a **system-assigned managed identity**. Grant that identity **Key Vault Secrets User** on the vault.
4. Do **not** put `@Microsoft.KeyVault(...)` in the Logic App HTTP header (that string is only resolved on App Service). Instead:
   - HTTP GET `https://<vault>.vault.azure.net/secrets/INTERNAL-JOB-TRIGGER-SECRET?api-version=7.4` with **Managed identity** authentication
   - HTTP POST to the API, header from the GET body:

```http
POST https://<api-host>/internal/jobs/inventory_sync/run
Header: x-internal-job-secret: @{body('get-job-secret')?['value']}
Content-Type: application/json
Body: { "tenant_id": "t1" }
```

Terraform (`enable_nightly_jobs`) provisions **only** this flow: GET secret, then POST `inventory_sync`. It does not create POSTs for other jobs.

5. Extra HTTP POSTs (same secret header and `{ "tenant_id": "t1" }` body) can be added **in the Logic App designer** if you need those inventories. They are not in Terraform. Use the job that matches what you want to fetch:

| POST path | When to add it |
|-----------|----------------|
| `/internal/jobs/inventory_sync/run` | Power Platform inventory (included in Terraform) |
| `/internal/jobs/powerbi_inventory_sync/run` | Power BI / Fabric workspaces, reports, dashboards |
| `/internal/jobs/copilot_kit_usage_sync/run` | Copilot Agent Kit usage/credits |

Each extra action should `runAfter` the GET secret (or the previous POST). Skip any job whose connector is not configured on App Service.

6. Smoke test (reads the vault secret and POSTs `inventory_sync`):

```sh
.\backend\scripts\test-internal-job-trigger.ps1
```

Expect **202** and a job id. Confirm in Admin → Jobs (or `GET /admin/jobs/runs`).

If the secret is unset on App Service, the internal route returns **503**. A 401 usually means the Logic App header is not the vault value (wrong expression, or a Key Vault *reference* string sent as the header).

---

## 6. Deployment checklist

### First-time cloud

1. [ ] Entra SPA app + redirect URIs
2. [ ] Postgres created, firewall open to App Service
3. [ ] `db:migrate` (+ seed or create real tenant) against Azure DB
4. [ ] App Service with Node 22, MI, Key Vault access
5. [ ] App settings / Key Vault secrets configured
6. [ ] Frontend SWA build with production `VITE_*`
7. [ ] CORS `ALLOWED_ORIGINS` + Entra redirects match SWA URL
8. [ ] Manual login test on SWA URL
9. [ ] Bootstrap PP refresh token → Key Vault
10. [ ] (Optional) Logic App nightly schedule (Terraform: GET secret + `inventory_sync`; extra job POSTs in the designer if needed)
11. [ ] Copilot Agent Kit credentials configured
12. [ ] (Optional) Power BI credentials configured

### Ongoing

- Push to your deploy branch → GitHub Actions (or other CI) builds and deploys.
- Public OSS repos should keep **CI (lint/test)** in-tree; keep **org-specific
  Azure deploy workflows** (resource names, publish profiles) in a **private**
  fork or separate private repo so secrets and hostnames are not published.
- After schema changes, run `npm run db:migrate -w backend` against the target DB.
- Refresh tokens expire / revoke — re-run `bootstrap-inventory-token.js` and
  update Key Vault when inventory sync starts failing with auth errors.

---

## 7. Jobs reference

| Job type | Purpose |
|----------|---------|
| `inventory_sync` | Power Platform resource inventory → `inventory_items` / environments |
| `powerbi_inventory_sync` | Power BI workspaces/reports/dashboards |
| `copilot_kit_usage_sync` | Copilot Agent Kit usage/credits from Dataverse |
| `components_import` | Promote inventory into curated components (also chained after successful inventory syncs when Admin import settings are set) |

Triggers:

- Admin UI / `POST /admin/jobs/...` (authenticated admin)
- `POST /internal/jobs/:jobType/run` + `x-internal-job-secret` (scheduled)

---

## 8. Automated tests

```sh
npm test                 # frontend Vitest + backend unit/API tests
npm run test:e2e:install # once: Playwright Chromium
npm run test:e2e         # browser e2e (memory API on ports 7072/8081)
```

Backend tests force memory store and open auth via helpers (`USE_MEMORY_STORE=1`).
See [`e2e/README.md`](e2e/README.md).

---

## 9. Security notes for operators

- Never commit `.env`, refresh tokens, publish profiles, or Key Vault values.
- Treat shared chat/logs that contained secrets as compromised — rotate.
- `INTERNAL_JOB_TRIGGER_SECRET` must be long and random; rotate if leaked.
- Prefer Key Vault references over plain App Service secret values.
- This release assumes a **trusted single organization** per deployment.
  Hard multi-tenant isolation is out of scope.

---

## 10. Useful scripts

| Script | Purpose |
|--------|---------|
| `npm run setup:azure` | Interactive Terraform generator for Azure resources (`infra/`) |
| `backend/scripts/bootstrap-inventory-token.js` | Device-code refresh token for PP inventory |
| `backend/scripts/configure-kv-appservice.ps1` | Wire Key Vault refs on App Service (customize names) |
| `backend/scripts/verify-kv-appservice.ps1` | Verify KV references resolve |
| `backend/scripts/test-internal-job-trigger.ps1` | Smoke-test internal job POST (customize host/vault) |
