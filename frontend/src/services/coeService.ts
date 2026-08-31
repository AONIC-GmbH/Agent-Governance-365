import { isMockMode } from "@/lib/devConfig";

import * as mock from "@/data/mockCoeData";



export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:7071";

let accessTokenProvider: (() => Promise<string | null>) | null = null;

export function setAccessTokenProvider(provider: () => Promise<string | null>) {
  accessTokenProvider = provider;
}

export async function syncAuthSession(accessToken: string) {
  return apiFetch<{ profile: Profile; isAdmin: boolean }>("/auth/sync", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (accessTokenProvider) {
    const token = await accessTokenProvider();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {

    const detail = await response.text().catch(() => "");

    throw new Error(`API ${path}: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ""}`);

  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();

  return text ? (JSON.parse(text) as T) : (undefined as T);

}



async function apiResult<T>(path: string, init?: RequestInit): Promise<{ data: T | null; error: { message: string } | null }> {

  try {

    const data = await apiFetch<T>(path, init);

    return { data: (data ?? null) as T | null, error: null };

  } catch (e) {

    return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };

  }

}



export interface DbComponent {

  id: string;

  tenant_id: string;

  name: string;

  type: string;

  environments: string[];

  owner_id: string | null;

  created_at: string;

  /** Inventory last-modified when linked; otherwise null. */
  modified_at?: string | null;

  status: string;

  url: string;

}



export interface DbProject {

  id: string;

  tenant_id: string;

  name: string;

  description: string;

  owner_id: string | null;

  status: string;

  created_at: string;

  service_user: string | null;

  production_access_status: string;

  production_deploy_status?: string;

  answers: Record<string, string>;

  business_unit_id?: string | null;

  owner_name?: string | null;

  owner_email?: string | null;

}



export interface Profile {

  id: string;

  tenant_id: string;

  full_name: string;

  email: string;

}



export interface ProfileSummary {

  id: string;

  full_name: string;

  email: string;

}



export interface CreateProjectInput {

  tenant_id: string;

  name: string;

  description: string;

  owner_id: string;

  status: string;

  answers: Record<string, string>;

  business_unit_id?: string | null;

  tag_ids?: string[];

}



export interface ComponentInsertRow {

  name: string;

  type: string;

  environments: string[];

  url: string;

  status: string;

  tenant_id: string;

  owner_id: string;

}



export interface ProfileWithDetails {

  id: string;

  full_name: string;

  email: string;

  role: "admin" | "user";

  projects: {
    id: string;
    name: string;
    service_user: string | null;
    status: string;
    membership: "owner" | "collaborator";
  }[];

  unmanagedComponents: number;

  archivedComponents: number;

}



export interface ServiceUserEntry {

  id: string;

  name: string;

  assigned_to: string | null;

  assigned_user: ProfileSummary | null;

  projects: { id: string; name: string; owner_name: string }[];

}



// --- Profiles ---



export async function getProfile(userId: string) {

  if (isMockMode) return mock.mockGetProfile(userId);

  return apiResult<Profile>(`/profiles/${encodeURIComponent(userId)}`);

}



export async function getUserRoles(userId: string) {

  if (isMockMode) return mock.mockGetUserRoles(userId);

  const data = await apiFetch<{ role: string }[]>(`/profiles/${encodeURIComponent(userId)}/roles`);

  return { data, error: null };

}



// --- Components ---



export async function getComponents(ownerId: string): Promise<DbComponent[]> {

  return apiFetch<DbComponent[]>(`/components?owner_id=${encodeURIComponent(ownerId)}`);

}



export async function getComponentsByIds(ids: string[]): Promise<DbComponent[]> {

  if (ids.length === 0) return [];

  return apiFetch<DbComponent[]>(`/components?ids=${ids.map(encodeURIComponent).join(",")}`);

}



export async function insertComponents(rows: ComponentInsertRow[]) {

  return apiResult(`/components`, { method: "POST", body: JSON.stringify(rows) });

}



export async function getAssignedComponentIds(): Promise<string[]> {

  return apiFetch<string[]>("/components/assigned-ids");

}



export async function getMyComponentIds(ownerId: string): Promise<string[]> {

  return apiFetch<string[]>(`/components/my-ids?owner_id=${encodeURIComponent(ownerId)}`);

}



export async function deleteComponents(ids: string[]) {

  return apiResult("/components", { method: "DELETE", body: JSON.stringify({ ids }) });

}



export async function archiveComponent(id: string) {

  return apiResult(`/components/${encodeURIComponent(id)}/archive`, { method: "PATCH" });

}



// --- Projects ---



export async function getProjects(_ownerId?: string): Promise<DbProject[]> {

  return apiFetch<DbProject[]>("/projects");

}



export async function getProject(id: string): Promise<DbProject> {

  return apiFetch<DbProject>(`/projects/${encodeURIComponent(id)}`);

}



export async function createProject(input: CreateProjectInput) {

  return apiResult<{ id: string }>("/projects", { method: "POST", body: JSON.stringify(input) });

}



export async function updateProject(id: string, updates: Record<string, unknown>) {

  return apiResult(`/projects/${encodeURIComponent(id)}`, {

    method: "PATCH",

    body: JSON.stringify(updates),

  });

}



export async function deleteProject(id: string) {

  return apiResult(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" });

}



export async function requestDevAccess(projectId: string) {

  return updateProject(projectId, { status: "pending" });

}



export async function requestProdAccess(projectId: string) {

  return updateProject(projectId, { production_access_status: "pending" });

}



export async function requestDeployAccess(projectId: string) {

  return updateProject(projectId, { production_deploy_status: "pending" });

}



export async function setProjectServiceUser(projectId: string, serviceUser: string) {

  return updateProject(projectId, { service_user: serviceUser });

}



export async function grantDevAccess(projectId: string) {

  return updateProject(projectId, { status: "approved" });

}



export async function grantProdAccess(projectId: string) {

  return updateProject(projectId, { production_access_status: "granted" });

}



export async function grantDeployAccess(projectId: string) {

  return updateProject(projectId, { production_deploy_status: "granted" });

}



export interface PendingProject extends DbProject {
  owner_name?: string | null;
  owner_email?: string | null;
  business_unit_name?: string | null;
  collaborators?: ProfileSummary[];
  component_types?: string[];
  tags?: { id: string; group_key: string; name: string }[];
}

export async function getPendingProjects() {
  return apiFetch<PendingProject[]>("/admin/pending-projects");
}



export async function getAllProjectsSummary() {

  return apiFetch<{ id: string; name: string; service_user: string | null; owner_id: string | null }[]>(

    "/projects/summary"

  );

}



export async function clearProjectServiceUserByName(serviceUserName: string) {

  return apiResult(`/projects/service-user/${encodeURIComponent(serviceUserName)}`, { method: "DELETE" });

}



export async function assignProjectServiceUser(projectId: string, serviceUserName: string) {

  return apiResult(`/projects/${encodeURIComponent(projectId)}/service-user`, {

    method: "PATCH",

    body: JSON.stringify({ service_user: serviceUserName }),

  });

}



export async function unassignProjectServiceUser(projectId: string) {

  return apiResult(`/projects/${encodeURIComponent(projectId)}/service-user`, { method: "DELETE" });

}



// --- Project components ---



export async function getProjectComponentIds(projectId: string): Promise<string[]> {

  return apiFetch<string[]>(`/project-components?project_id=${encodeURIComponent(projectId)}`);

}



export async function getProjectComponents(projectId: string): Promise<DbComponent[]> {

  const componentIds = await getProjectComponentIds(projectId);

  if (componentIds.length === 0) return [];

  return getComponentsByIds(componentIds);

}



export async function getAllProjectComponents(): Promise<{ component_id: string; project_id: string }[]> {

  return apiFetch("/project-components");

}



export async function addProjectComponents(rows: { project_id: string; component_id: string }[]) {

  return apiResult("/project-components", { method: "POST", body: JSON.stringify(rows) });

}



export async function removeProjectComponent(projectId: string, componentId: string) {

  return apiResult("/project-components", {

    method: "DELETE",

    body: JSON.stringify({ project_id: projectId, component_id: componentId }),

  });

}



// --- Project collaborators ---



export async function getMyCollaboratorProjectIds(userId: string): Promise<Set<string>> {

  const ids = await apiFetch<string[]>(`/project-collaborators?user_id=${encodeURIComponent(userId)}`);

  return new Set(ids);

}



export async function getProjectCollaborators(projectId: string): Promise<ProfileSummary[]> {

  return apiFetch<ProfileSummary[]>(`/project-collaborators?project_id=${encodeURIComponent(projectId)}`);

}



export async function addProjectCollaborator(projectId: string, userId: string) {

  return apiResult("/project-collaborators", {

    method: "POST",

    body: JSON.stringify({ project_id: projectId, user_id: userId }),

  });

}



export async function addProjectCollaborators(rows: { project_id: string; user_id: string }[]) {

  return apiResult("/project-collaborators", { method: "POST", body: JSON.stringify(rows) });

}



export async function removeProjectCollaborator(projectId: string, userId: string) {

  return apiResult("/project-collaborators", {

    method: "DELETE",

    body: JSON.stringify({ project_id: projectId, user_id: userId }),

  });

}



// --- Profiles ---



export async function getProfilesByIds(ids: string[]): Promise<ProfileSummary[]> {

  if (ids.length === 0) return [];

  return apiFetch<ProfileSummary[]>("/profiles/by-ids", {

    method: "POST",

    body: JSON.stringify({ ids }),

  });

}



export async function getTenantProfiles(excludeUserId: string): Promise<ProfileSummary[]> {

  return apiFetch<ProfileSummary[]>(`/profiles?exclude=${encodeURIComponent(excludeUserId)}`);

}



// Searches the signed-in user's Entra/AD tenant directory (via the backend Graph

// proxy). Returns [] when Graph isn't configured on the backend.

export async function searchDirectoryUsers(query: string): Promise<ProfileSummary[]> {

  const q = query.trim();

  return apiFetch<ProfileSummary[]>(`/directory/users${q ? `?q=${encodeURIComponent(q)}` : ""}`);

}



export async function getAllProfiles(): Promise<ProfileSummary[]> {

  return apiFetch<ProfileSummary[]>("/profiles");

}



export async function getAdminUsers(): Promise<ProfileWithDetails[]> {
  return apiFetch<ProfileWithDetails[]>("/admin/users");
}

export interface AdminComponent extends DbComponent {
  owner_name: string | null;
  owner_email: string | null;
  is_assigned: boolean;
}

export type AdminComponentInventoryDetails = {
  family: "agent" | "powerapp" | "cloudflow" | "powerbi" | "unknown";
  // agent
  created_in?: string | null;
  orchestration?: string | null;
  model?: string | null;
  authentication?: string | null;
  channels?: string[];
  last_published_at?: string | null;
  is_published?: boolean;
  web_search_enabled?: boolean;
  connector_count?: number;
  connector_operations?: number | null;
  entire_tenant_share?: boolean;
  shared_with_viewers?: {
    user_count: number;
    group_count: number;
    entire_tenant: boolean;
  } | null;
  schema_name?: string | null;
  // apps / flows
  created_at?: string | null;
  last_modified_at?: string | null;
  is_quarantined?: boolean;
  logical_name?: string | null;
  app_module_id?: string | null;
  app_kind?: string;
  trigger?: string | null;
  trigger_operation?: string | null;
  workflow_entity_id?: string | null;
  // power bi
  pbi_kind?: string;
  workspace_id?: string | null;
  workspace_name?: string | null;
  workspace_type?: string | null;
  workspace_state?: string | null;
  report_type?: string | null;
  dataset_id?: string | null;
  created_by?: string | null;
  modified_by?: string | null;
  modified_at?: string | null;
  is_on_dedicated_capacity?: boolean | null;
  capacity_id?: string | null;
  environment_type?: string | null;
};

export interface AdminComponentDetail {
  id: string;
  tenant_id: string;
  name: string;
  type: string;
  status: string;
  environments: string[] | null;
  url: string | null;
  open_url: string | null;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  source_inventory_id: string | null;
  is_assigned: boolean;
  project_id: string | null;
  project_name: string | null;
  environment_name: string | null;
  environment_type: string | null;
  inventory_details: AdminComponentInventoryDetails | null;
}

export async function getAdminComponents(): Promise<AdminComponent[]> {
  return apiFetch<AdminComponent[]>("/admin/components");
}

export async function getAdminComponentDetail(id: string): Promise<AdminComponentDetail> {
  return apiFetch<AdminComponentDetail>(`/admin/components/${encodeURIComponent(id)}`);
}

export interface JobRun {
  id: string;
  tenant_id: string;
  job_type: string;
  trigger: string;
  status: string;
  stats: Record<string, unknown>;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export async function runAdminJob(jobType: string, params: Record<string, unknown> = {}) {
  return apiResult<JobRun>(`/admin/jobs/${encodeURIComponent(jobType)}/run`, {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export interface InventorySource {
  job_type: string;
  label: string;
  configured: boolean;
}

export async function getInventorySources() {
  return apiFetch<{ sources: InventorySource[] }>("/admin/jobs/inventory-sources");
}

export async function runConfiguredInventorySyncs() {
  return apiResult<{
    started: JobRun[];
    skipped: { job_type: string; label: string; reason: string }[];
    already_running: { job_type: string; label: string }[];
    failed: { job_type: string; label: string; error: string }[];
  }>("/admin/jobs/sync-configured/run", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function listAdminJobRuns(opts?: { type?: string; status?: string; limit?: number }) {
  const q = new URLSearchParams();
  if (opts?.type) q.set("type", opts.type);
  if (opts?.status) q.set("status", opts.status);
  if (opts?.limit) q.set("limit", String(opts.limit));
  const qs = q.toString();
  return apiFetch<JobRun[]>(`/admin/jobs/runs${qs ? `?${qs}` : ""}`);
}

export async function getAdminJobRun(id: string) {
  return apiFetch<JobRun>(`/admin/jobs/runs/${encodeURIComponent(id)}`);
}

export interface PpEnvironment {
  id: string;
  tenant_id?: string;
  environment_id: string;
  display_name: string | null;
  environment_type: string | null;
  region: string | null;
  is_managed: boolean | null;
  is_active?: boolean;
  last_synced_at: string | null;
}

export interface PpWorkspace {
  id: string;
  tenant_id?: string;
  workspace_id: string;
  display_name: string | null;
  workspace_type: string | null;
  state: string | null;
  is_active?: boolean;
  last_synced_at: string | null;
}

/** @deprecated use listEnvironments */
export interface InventoryEnvironment {
  id: string;
  resource_id: string;
  display_name: string | null;
  environment_type?: string | null;
  region?: string | null;
  is_managed?: boolean | null;
  last_synced_at: string | null;
}

export interface ComponentImportSettings {
  tenant_id: string;
  kinds: string[];
  environment_ids: string[];
  workspace_ids: string[];
  updated_at: string | null;
  updated_by: string | null;
}

export interface ComponentImportPreview {
  count: number;
  by_kind: Record<string, number>;
}

export async function listEnvironments() {
  return apiFetch<PpEnvironment[]>("/admin/environments");
}

export async function listWorkspaces() {
  return apiFetch<PpWorkspace[]>("/admin/workspaces");
}

/** @deprecated prefer listEnvironments */
export async function listInventoryEnvironments() {
  return apiFetch<InventoryEnvironment[]>("/admin/inventory/environments");
}

export async function getComponentImportSettings() {
  return apiFetch<ComponentImportSettings>("/admin/component-import-settings");
}

export async function saveComponentImportSettings(input: {
  kinds: string[];
  environment_ids: string[];
  workspace_ids: string[];
}) {
  return apiResult<ComponentImportSettings>("/admin/component-import-settings", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function previewComponentImport(opts: {
  kinds: string[];
  environment_ids: string[];
  workspace_ids: string[];
}) {
  const q = new URLSearchParams();
  if (opts.kinds.length) q.set("kinds", opts.kinds.join(","));
  if (opts.environment_ids.length) q.set("environment_ids", opts.environment_ids.join(","));
  if (opts.workspace_ids.length) q.set("workspace_ids", opts.workspace_ids.join(","));
  const qs = q.toString();
  return apiFetch<ComponentImportPreview>(
    `/admin/component-import-preview${qs ? `?${qs}` : ""}`
  );
}

export interface AgentInventoryDetails {
  created_in: string | null;
  orchestration: string | null;
  model: string | null;
  authentication: string | null;
  channels: string[];
  last_published_at: string | null;
  is_published: boolean;
  created_at: string | null;
  owner_external: string | null;
  owner_aad_id: string | null;
  environment_type: string | null;
  shared_with_viewers: {
    user_count: number;
    group_count: number;
    entire_tenant: boolean;
  } | null;
  shared_with_editors: {
    user_count: number;
    group_count: number;
    entire_tenant: boolean;
  } | null;
  entire_tenant_share: boolean;
  connector_count: number;
  connector_operations: number | null;
  connector_ids: string[];
  web_search_enabled: boolean;
  is_managed: boolean | null;
  is_quarantined: boolean;
  schema_name: string | null;
}

export interface AgentCreditRow {
  agent_key: string;
  inventory_item_id: string | null;
  agent_resource_id: string | null;
  display_name: string;
  environment_id: string | null;
  environment_name: string | null;
  environment_type?: string | null;
  project_id: string | null;
  project_name: string | null;
  business_unit_id: string | null;
  business_unit_name: string | null;
  inventory_details?: AgentInventoryDetails | null;
  billed_credits: number;
  unbilled_credits: number;
  euro: number;
  billed_euro: number;
  unbilled_euro: number;
}

export interface AgentCreditsResponse {
  from: string;
  to: string;
  business_unit_id: string | null;
  billed_credits_total: number;
  unbilled_credits_total: number;
  euro_total: number;
  billed_euro_total: number;
  unbilled_euro_total: number;
  count: number;
  items: AgentCreditRow[];
}

export async function listAgentCredits(opts: {
  from: string;
  to: string;
  business_unit_id?: string;
}) {
  const q = new URLSearchParams();
  q.set("from", opts.from);
  q.set("to", opts.to);
  if (opts.business_unit_id) q.set("business_unit_id", opts.business_unit_id);
  return apiFetch<AgentCreditsResponse>(`/admin/agent-credits?${q.toString()}`);
}

export interface CreditRateCard {
  id: string;
  tenant_id: string;
  label: string;
  euro_per_credit: number;
  effective_from: string;
  effective_to: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function listCreditRateCards() {
  return apiFetch<CreditRateCard[]>("/admin/credit-rate-cards");
}

export async function saveCreditRateCards(
  cards: {
    label?: string;
    euro_per_credit: number;
    effective_from: string;
    effective_to?: string | null;
  }[]
) {
  return apiFetch<CreditRateCard[]>("/admin/credit-rate-cards", {
    method: "PUT",
    body: JSON.stringify({ cards }),
  });
}

// --- Tenants ---



export interface Tenant {

  id: string;

  name: string;

  tool_name: string;

  created_at: string;

  has_logo: boolean;

  logo_version?: string | null;

}



export interface TenantEmailDomain {

  id: string;

  tenant_id: string;

  domain: string;

  created_at: string;

}



export interface BusinessUnit {

  id: string;

  tenant_id: string;

  name: string;

  sort_order: number;

  is_active: boolean;

  created_at: string;

}



export interface ComplianceQuestion {

  id: string;

  tenant_id: string;

  prompt: string;

  answer_type: "text" | "select";

  options: string[];

  required: boolean;

  sort_order: number;

  is_active: boolean;

  created_at: string;

}



export async function getPublicBranding() {

  return apiFetch<Tenant>("/branding");

}



export async function getTenant(tenantId: string) {

  return apiFetch<Tenant>(`/tenants/${encodeURIComponent(tenantId)}`);

}



export function tenantLogoUrl(tenantId: string, cacheBust?: number | string) {

  const base = `${API_BASE_URL}/tenants/${encodeURIComponent(tenantId)}/logo`;

  return cacheBust != null ? `${base}?v=${cacheBust}` : base;

}



export async function updateTenant(

  tenantId: string,

  fields: { name?: string; tool_name?: string }

) {

  return apiResult<Tenant>(`/tenants/${encodeURIComponent(tenantId)}`, {

    method: "PATCH",

    body: JSON.stringify(fields),

  });

}



export async function uploadTenantLogo(tenantId: string, file: File) {

  const headers: Record<string, string> = {

    "Content-Type": file.type || "application/octet-stream",

  };

  if (accessTokenProvider) {

    const token = await accessTokenProvider();

    if (token) headers.Authorization = `Bearer ${token}`;

  }

  try {

    const response = await fetch(`${API_BASE_URL}/tenants/${encodeURIComponent(tenantId)}/logo`, {

      method: "PUT",

      headers,

      body: file,

    });

    if (!response.ok) {

      const detail = await response.text().catch(() => "");

      return { data: null, error: { message: detail || `Upload failed (${response.status})` } };

    }

    const data = (await response.json()) as { ok: boolean; has_logo: boolean };

    return { data, error: null };

  } catch (e) {

    return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };

  }

}



export async function deleteTenantLogo(tenantId: string) {

  return apiResult(`/tenants/${encodeURIComponent(tenantId)}/logo`, { method: "DELETE" });

}



export async function getTenantEmailDomains(tenantId: string) {

  return apiFetch<TenantEmailDomain[]>(`/tenants/${encodeURIComponent(tenantId)}/email-domains`);

}



export async function addTenantEmailDomain(tenantId: string, domain: string) {

  return apiResult(`/tenants/${encodeURIComponent(tenantId)}/email-domains`, {

    method: "POST",

    body: JSON.stringify({ domain }),

  });

}



export async function deleteTenantEmailDomain(id: string) {

  return apiResult(`/email-domains/${encodeURIComponent(id)}`, { method: "DELETE" });

}



export async function listBusinessUnits(tenantId: string, opts?: { activeOnly?: boolean }) {

  const q = opts?.activeOnly ? "?active=1" : "";

  return apiFetch<BusinessUnit[]>(`/tenants/${encodeURIComponent(tenantId)}/business-units${q}`);

}



export async function createBusinessUnit(tenantId: string, input: { name: string; sort_order?: number }) {

  return apiResult<BusinessUnit>(`/tenants/${encodeURIComponent(tenantId)}/business-units`, {

    method: "POST",

    body: JSON.stringify(input),

  });

}



export async function updateBusinessUnit(

  tenantId: string,

  unitId: string,

  patch: { name?: string; sort_order?: number; is_active?: boolean }

) {

  return apiResult<BusinessUnit>(

    `/tenants/${encodeURIComponent(tenantId)}/business-units/${encodeURIComponent(unitId)}`,

    { method: "PATCH", body: JSON.stringify(patch) }

  );

}



export async function deactivateBusinessUnit(tenantId: string, unitId: string) {

  return apiResult<BusinessUnit>(

    `/tenants/${encodeURIComponent(tenantId)}/business-units/${encodeURIComponent(unitId)}`,

    { method: "DELETE" }

  );

}



export async function listComplianceQuestions(tenantId: string, opts?: { activeOnly?: boolean }) {

  const q = opts?.activeOnly ? "?active=1" : "";

  return apiFetch<ComplianceQuestion[]>(

    `/tenants/${encodeURIComponent(tenantId)}/compliance-questions${q}`

  );

}



export async function createComplianceQuestion(

  tenantId: string,

  input: {

    prompt: string;

    answer_type: "text" | "select";

    options?: string[];

    required?: boolean;

    sort_order?: number;

  }

) {

  return apiResult<ComplianceQuestion>(

    `/tenants/${encodeURIComponent(tenantId)}/compliance-questions`,

    { method: "POST", body: JSON.stringify(input) }

  );

}



export async function updateComplianceQuestion(

  tenantId: string,

  questionId: string,

  patch: Partial<{

    prompt: string;

    answer_type: "text" | "select";

    options: string[];

    required: boolean;

    sort_order: number;

    is_active: boolean;

  }>

) {

  return apiResult<ComplianceQuestion>(

    `/tenants/${encodeURIComponent(tenantId)}/compliance-questions/${encodeURIComponent(questionId)}`,

    { method: "PATCH", body: JSON.stringify(patch) }

  );

}



export async function deactivateComplianceQuestion(tenantId: string, questionId: string) {

  return apiResult<ComplianceQuestion>(

    `/tenants/${encodeURIComponent(tenantId)}/compliance-questions/${encodeURIComponent(questionId)}`,

    { method: "DELETE" }

  );

}



export interface ProjectTagDefinition {

  id: string;

  tenant_id: string;

  group_key: "domain" | "capability" | string;

  name: string;

  sort_order: number;

  is_active: boolean;

  created_at?: string;

}



export async function listProjectTags(opts?: { activeOnly?: boolean }) {

  const q = opts?.activeOnly === false ? "?active=0" : "";

  return apiFetch<ProjectTagDefinition[]>(`/project-tags${q}`);

}



export async function listProjectTagsForTenant(tenantId: string, opts?: { activeOnly?: boolean }) {

  const q = opts?.activeOnly ? "?active=1" : "";

  return apiFetch<ProjectTagDefinition[]>(

    `/tenants/${encodeURIComponent(tenantId)}/project-tags${q}`

  );

}



export async function getProjectTags(projectId: string) {

  return apiFetch<ProjectTagDefinition[]>(`/projects/${encodeURIComponent(projectId)}/tags`);

}



export async function createProjectTag(

  tenantId: string,

  input: { name: string; group_key: "domain" | "capability"; sort_order?: number }

) {

  return apiResult<ProjectTagDefinition>(`/tenants/${encodeURIComponent(tenantId)}/project-tags`, {

    method: "POST",

    body: JSON.stringify(input),

  });

}



export async function updateProjectTag(

  tenantId: string,

  tagId: string,

  patch: { name?: string; group_key?: string; sort_order?: number; is_active?: boolean }

) {

  return apiResult<ProjectTagDefinition>(

    `/tenants/${encodeURIComponent(tenantId)}/project-tags/${encodeURIComponent(tagId)}`,

    { method: "PATCH", body: JSON.stringify(patch) }

  );

}



export async function deactivateProjectTag(tenantId: string, tagId: string) {

  return apiResult<ProjectTagDefinition>(

    `/tenants/${encodeURIComponent(tenantId)}/project-tags/${encodeURIComponent(tagId)}`,

    { method: "DELETE" }

  );

}



// --- User roles ---



export async function updateUserRole(userId: string, role: "admin" | "user") {

  return apiResult(`/admin/users/${encodeURIComponent(userId)}/role`, {

    method: "PATCH",

    body: JSON.stringify({ role }),

  });

}



// --- Service users ---



export async function getServiceUsersWithDetails(): Promise<ServiceUserEntry[]> {

  return apiFetch<ServiceUserEntry[]>("/service-users");

}



export async function createServiceUser(name: string, tenantId: string, assignedTo: string | null) {

  return apiResult("/service-users", {

    method: "POST",

    body: JSON.stringify({ name, tenant_id: tenantId, assigned_to: assignedTo }),

  });

}



export async function deleteServiceUser(id: string, name: string) {

  return apiResult(`/service-users/${encodeURIComponent(id)}`, {

    method: "DELETE",

    body: JSON.stringify({ name }),

  });

}



export async function updateServiceUserAssignment(serviceUserId: string, userId: string | null) {

  return apiResult(`/service-users/${encodeURIComponent(serviceUserId)}/assignment`, {

    method: "PATCH",

    body: JSON.stringify({ assigned_to: userId }),

  });

}

