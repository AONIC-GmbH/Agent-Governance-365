import type { User } from "@/lib/authTypes";
import type {
  DbComponent,
  DbProject,
  Profile,
  ProfileSummary,
  ProfileWithDetails,
  ServiceUserEntry,
  ComponentInsertRow,
  CreateProjectInput,
} from "@/services/coeService";
import { mockUser, mockColleagues, mockComponents, mockProjects } from "./mockData";

export const MOCK_TENANT_ID = "t1";

const toIsoDate = (date: string) => `${date}T00:00:00.000Z`;

function buildInitialComponents(): DbComponent[] {
  return mockComponents.map((c) => ({
    id: c.id,
    tenant_id: MOCK_TENANT_ID,
    name: c.name,
    type: c.type,
    environments: c.environments,
    owner_id: c.owner,
    created_at: toIsoDate(c.createdAt),
    status: c.status,
    url: c.url,
  }));
}

function buildInitialProjects(): DbProject[] {
  return mockProjects.map((p) => ({
    id: p.id,
    tenant_id: MOCK_TENANT_ID,
    name: p.name,
    description: p.description,
    owner_id: p.owner,
    status: p.status,
    created_at: toIsoDate(p.createdAt),
    service_user: p.serviceUser ?? null,
    production_access_status: p.productionAccessStatus ?? "none",
    answers: p.answers,
    production_deploy_status: "none" as string,
  }));
}

function buildInitialProfiles(): Profile[] {
  return [
    {
      id: mockUser.id,
      tenant_id: MOCK_TENANT_ID,
      full_name: mockUser.name,
      email: mockUser.email,
    },
    ...mockColleagues.map((c) => ({
      id: c.id,
      tenant_id: MOCK_TENANT_ID,
      full_name: c.name,
      email: c.email,
    })),
  ];
}

function buildInitialProjectComponents(): { project_id: string; component_id: string }[] {
  return mockProjects.flatMap((p) =>
    p.components.map((cid) => ({ project_id: p.id, component_id: cid }))
  );
}

function buildInitialProjectCollaborators(): { project_id: string; user_id: string }[] {
  return mockProjects.flatMap((p) =>
    p.collaborators.map((uid) => ({ project_id: p.id, user_id: uid }))
  );
}

interface MockState {
  components: DbComponent[];
  projects: DbProject[];
  profiles: Profile[];
  projectComponents: { project_id: string; component_id: string }[];
  projectCollaborators: { project_id: string; user_id: string }[];
  userRoles: { user_id: string; role: "admin" | "user" }[];
  serviceUsers: { id: string; name: string; tenant_id: string; assigned_to: string | null }[];
  tenant: { id: string; name: string; created_at: string };
  emailDomains: { id: string; tenant_id: string; domain: string; created_at: string }[];
}

const initialState: MockState = {
  components: buildInitialComponents(),
  projects: buildInitialProjects(),
  profiles: buildInitialProfiles(),
  projectComponents: buildInitialProjectComponents(),
  projectCollaborators: buildInitialProjectCollaborators(),
  userRoles: [
    { user_id: mockUser.id, role: "admin" },
    ...mockColleagues.map((c) => ({ user_id: c.id, role: "user" as const })),
  ],
  serviceUsers: [
    {
      id: "su1",
      name: mockUser.serviceUser,
      tenant_id: MOCK_TENANT_ID,
      assigned_to: mockUser.id,
    },
    {
      id: "su2",
      name: "S123456@example.com",
      tenant_id: MOCK_TENANT_ID,
      assigned_to: null,
    },
  ],
  tenant: {
    id: MOCK_TENANT_ID,
    name: "Demo Organisation",
    created_at: "2025-01-01T00:00:00.000Z",
  },
  emailDomains: [
    { id: "d1", tenant_id: MOCK_TENANT_ID, domain: "example.com", created_at: "2025-01-01T00:00:00.000Z" },
  ],
};

let state: MockState = structuredClone(initialState);

export const mockAuthUser: User = {
  id: mockUser.id,
  email: mockUser.email,
  app_metadata: {},
  user_metadata: { full_name: mockUser.name },
  aud: "authenticated",
  created_at: new Date().toISOString(),
} as User;

export function getMockProfile(): Profile {
  return state.profiles.find((p) => p.id === mockUser.id)!;
}

export function getMockIsAdmin(): boolean {
  return state.userRoles.some((r) => r.user_id === mockUser.id && r.role === "admin");
}

const noError = { data: null, error: null };

// --- Reads ---

export function mockGetComponents(ownerId: string): DbComponent[] {
  return state.components
    .filter((c) => c.owner_id === ownerId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function mockGetComponentsByIds(ids: string[]): DbComponent[] {
  return state.components.filter((c) => ids.includes(c.id));
}

export function mockGetProjects(): DbProject[] {
  return [...state.projects].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function mockGetProject(id: string): DbProject {
  const project = state.projects.find((p) => p.id === id);
  if (!project) throw new Error("Project not found");
  return project;
}

export function mockGetProjectComponentIds(projectId: string): string[] {
  return state.projectComponents
    .filter((pc) => pc.project_id === projectId)
    .map((pc) => pc.component_id);
}

export function mockGetAllProjectComponents() {
  return [...state.projectComponents];
}

export function mockGetMyCollaboratorProjectIds(userId: string): Set<string> {
  return new Set(
    state.projectCollaborators.filter((pc) => pc.user_id === userId).map((pc) => pc.project_id)
  );
}

export function mockGetProjectCollaborators(projectId: string): ProfileSummary[] {
  const userIds = state.projectCollaborators
    .filter((pc) => pc.project_id === projectId)
    .map((pc) => pc.user_id);
  return mockGetProfilesByIds(userIds);
}

export function mockGetProfilesByIds(ids: string[]): ProfileSummary[] {
  return state.profiles.filter((p) => ids.includes(p.id));
}

export function mockGetTenantProfiles(excludeUserId: string): ProfileSummary[] {
  return state.profiles.filter((p) => p.id !== excludeUserId);
}

export function mockGetAllProfiles(): ProfileSummary[] {
  return state.profiles.map(({ id, full_name, email }) => ({ id, full_name, email }));
}

export function mockGetAssignedComponentIds(): string[] {
  return state.projectComponents.map((pc) => pc.component_id);
}

export function mockGetMyComponentIds(ownerId: string): string[] {
  return state.components.filter((c) => c.owner_id === ownerId).map((c) => c.id);
}

export function mockGetPendingProjects() {
  return state.projects.filter(
    (p) =>
      p.status === "pending" ||
      p.production_access_status === "pending" ||
      (p as DbProject & { production_deploy_status?: string }).production_deploy_status === "pending"
  );
}

export function mockGetAllProjectsSummary() {
  return state.projects.map(({ id, name, service_user, owner_id }) => ({
    id,
    name,
    service_user,
    owner_id,
  }));
}

export function mockGetAdminUsers(): ProfileWithDetails[] {
  const assignedComponentIds = new Set(state.projectComponents.map((pc) => pc.component_id));
  const rolesMap = new Map(state.userRoles.map((r) => [r.user_id, r.role]));
  const projectsById = new Map(state.projects.map((pr) => [pr.id, pr]));

  return state.profiles.map((p) => {
    const owned = state.projects
      .filter((pr) => pr.owner_id === p.id)
      .map((pr) => ({
        id: pr.id,
        name: pr.name,
        service_user: pr.service_user,
        status: pr.status,
        membership: "owner" as const,
      }));
    const ownedIds = new Set(owned.map((pr) => pr.id));
    const collab = state.projectCollaborators
      .filter((pc) => pc.user_id === p.id && !ownedIds.has(pc.project_id))
      .map((pc) => projectsById.get(pc.project_id))
      .filter((pr): pr is NonNullable<typeof pr> => Boolean(pr))
      .map((pr) => ({
        id: pr.id,
        name: pr.name,
        service_user: pr.service_user,
        status: pr.status,
        membership: "collaborator" as const,
      }));

    return {
      id: p.id,
      full_name: p.full_name,
      email: p.email,
      role: rolesMap.get(p.id) ?? "user",
      projects: [...owned, ...collab].sort((a, b) => a.name.localeCompare(b.name)),
      unmanagedComponents: state.components.filter(
        (c) => c.owner_id === p.id && !assignedComponentIds.has(c.id) && c.status !== "archived"
      ).length,
      archivedComponents: state.components.filter(
        (c) => c.owner_id === p.id && c.status === "archived"
      ).length,
    };
  });
}

export function mockGetTenant(tenantId: string) {
  if (state.tenant.id !== tenantId) throw new Error("Tenant not found");
  return state.tenant;
}

export function mockGetTenantEmailDomains(tenantId: string) {
  return state.emailDomains
    .filter((d) => d.tenant_id === tenantId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function mockGetServiceUsersWithDetails(): ServiceUserEntry[] {
  const profileMap = new Map(state.profiles.map((p) => [p.id, p]));

  return state.serviceUsers.map((su) => ({
    id: su.id,
    name: su.name,
    assigned_to: su.assigned_to,
    assigned_user: su.assigned_to
      ? profileMap.get(su.assigned_to) ?? null
      : null,
    projects: state.projects
      .filter((p) => p.service_user === su.name)
      .map((p) => ({
        id: p.id,
        name: p.name,
        owner_name: p.owner_id ? profileMap.get(p.owner_id)?.full_name ?? "–" : "–",
      })),
  }));
}

// --- Writes (in-memory) ---

export function mockInsertComponents(rows: ComponentInsertRow[]) {
  const inserted = rows.map((r, i) => ({
    id: `c-mock-${Date.now()}-${i}`,
    tenant_id: r.tenant_id,
    name: r.name,
    type: r.type,
    environments: r.environments,
    owner_id: r.owner_id,
    created_at: new Date().toISOString(),
    status: r.status,
    url: r.url,
  }));
  state.components.push(...inserted);
  return noError;
}

export function mockDeleteComponents(ids: string[]) {
  state.components = state.components.filter((c) => !ids.includes(c.id));
  return noError;
}

export function mockArchiveComponent(id: string) {
  const comp = state.components.find((c) => c.id === id);
  if (comp) comp.status = "archived";
  return noError;
}

export function mockCreateProject(input: CreateProjectInput) {
  const id = `s-mock-${Date.now()}`;
  state.projects.unshift({
    id,
    tenant_id: input.tenant_id,
    name: input.name,
    description: input.description,
    owner_id: input.owner_id,
    status: input.status,
    created_at: new Date().toISOString(),
    service_user: null,
    production_access_status: "none",
    answers: input.answers,
    production_deploy_status: "none",
  });
  return { data: { id }, error: null };
}

export function mockUpdateProject(id: string, updates: Record<string, unknown>) {
  const project = state.projects.find((p) => p.id === id);
  if (project) Object.assign(project, updates);
  return noError;
}

export function mockDeleteProject(id: string) {
  state.projects = state.projects.filter((p) => p.id !== id);
  state.projectComponents = state.projectComponents.filter((pc) => pc.project_id !== id);
  state.projectCollaborators = state.projectCollaborators.filter((pc) => pc.project_id !== id);
  return noError;
}

export function mockAddProjectComponents(rows: { project_id: string; component_id: string }[]) {
  state.projectComponents.push(...rows);
  rows.forEach(({ component_id }) => {
    const comp = state.components.find((c) => c.id === component_id);
    if (comp) comp.status = "assigned";
  });
  return noError;
}

export function mockRemoveProjectComponent(projectId: string, componentId: string) {
  const before = state.projectComponents.length;
  state.projectComponents = state.projectComponents.filter(
    (pc) => !(pc.project_id === projectId && pc.component_id === componentId)
  );
  if (state.projectComponents.length === before) {
    return { data: null, error: { message: "Project component not found" } };
  }
  const stillAssigned = state.projectComponents.some((pc) => pc.component_id === componentId);
  if (!stillAssigned) {
    const comp = state.components.find((c) => c.id === componentId);
    if (comp && comp.status === "assigned") comp.status = "unassigned";
  }
  return noError;
}

export function mockAddProjectCollaborator(projectId: string, userId: string) {
  state.projectCollaborators.push({ project_id: projectId, user_id: userId });
  return noError;
}

export function mockAddProjectCollaborators(rows: { project_id: string; user_id: string }[]) {
  state.projectCollaborators.push(...rows);
  return noError;
}

export function mockRemoveProjectCollaborator(projectId: string, userId: string) {
  state.projectCollaborators = state.projectCollaborators.filter(
    (pc) => !(pc.project_id === projectId && pc.user_id === userId)
  );
  return noError;
}

export function mockUpdateUserRole(userId: string, role: "admin" | "user") {
  const entry = state.userRoles.find((r) => r.user_id === userId);
  if (entry) entry.role = role;
  return noError;
}

export function mockUpdateTenant(tenantId: string, name: string) {
  if (state.tenant.id === tenantId) state.tenant.name = name;
  return noError;
}

export function mockAddTenantEmailDomain(tenantId: string, domain: string) {
  state.emailDomains.push({
    id: `d-mock-${Date.now()}`,
    tenant_id: tenantId,
    domain,
    created_at: new Date().toISOString(),
  });
  return noError;
}

export function mockDeleteTenantEmailDomain(id: string) {
  state.emailDomains = state.emailDomains.filter((d) => d.id !== id);
  return noError;
}

export function mockCreateServiceUser(name: string, tenantId: string, assignedTo: string | null) {
  state.serviceUsers.push({
    id: `su-mock-${Date.now()}`,
    name,
    tenant_id: tenantId,
    assigned_to: assignedTo,
  });
  return noError;
}

export function mockDeleteServiceUser(id: string, name: string) {
  state.projects.forEach((p) => {
    if (p.service_user === name) p.service_user = null;
  });
  state.serviceUsers = state.serviceUsers.filter((su) => su.id !== id);
  return noError;
}

export function mockUpdateServiceUserAssignment(serviceUserId: string, userId: string | null) {
  const su = state.serviceUsers.find((s) => s.id === serviceUserId);
  if (su) su.assigned_to = userId;
  return noError;
}

export function mockClearProjectServiceUserByName(serviceUserName: string) {
  state.projects.forEach((p) => {
    if (p.service_user === serviceUserName) p.service_user = null;
  });
  return noError;
}

export function mockAssignProjectServiceUser(projectId: string, serviceUserName: string) {
  const project = state.projects.find((p) => p.id === projectId);
  if (project) project.service_user = serviceUserName;
  return noError;
}

export function mockUnassignProjectServiceUser(projectId: string) {
  const project = state.projects.find((p) => p.id === projectId);
  if (project) project.service_user = null;
  return noError;
}

export function mockGetProfile(userId: string) {
  const profile = state.profiles.find((p) => p.id === userId);
  return { data: profile ?? null, error: profile ? null : { message: "Not found" } };
}

export function mockGetUserRoles(userId: string) {
  return {
    data: state.userRoles.filter((r) => r.user_id === userId).map((r) => ({ role: r.role })),
    error: null,
  };
}
