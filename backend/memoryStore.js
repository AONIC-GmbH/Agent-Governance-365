const { buildInitialState } = require("./seedData");
const { buildUrlFromInventoryItem } = require("./inventoryUrls");
const { canonicalizeEnvironmentId, environmentKey, lowerId } = require("./environmentIds");

let state = structuredClone(buildInitialState());

function resetStore() {
  state = structuredClone(buildInitialState());
}

// --- Projects ---

function getProjects() {
  return [...state.projects].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function getProject(id) {
  const project = state.projects.find((p) => p.id === id);
  if (!project) return null;
  const owner = project.owner_id
    ? state.profiles.find((p) => p.id === project.owner_id)
    : null;
  return {
    ...project,
    owner_name: owner?.full_name ?? null,
    owner_email: owner?.email ?? null,
  };
}

function createProject(input) {
  const id = `s-${Date.now()}`;
  const project = {
    id,
    tenant_id: input.tenant_id,
    name: input.name,
    description: input.description,
    owner_id: input.owner_id,
    status: input.status,
    created_at: new Date().toISOString(),
    service_user: null,
    production_access_status: "none",
    production_deploy_status: "none",
    answers: input.answers,
    business_unit_id: input.business_unit_id ?? null,
  };
  state.projects.unshift(project);
  if (Array.isArray(input.tag_ids)) setProjectTags(id, input.tag_ids);
  return { id };
}

function updateProject(id, updates) {
  const project = state.projects.find((p) => p.id === id);
  if (!project) return false;
  const patch = { ...(updates || {}) };
  const tagIds = patch.tag_ids;
  delete patch.tag_ids;
  Object.assign(project, patch);
  if (Array.isArray(tagIds)) setProjectTags(id, tagIds);
  return true;
}

function deleteProject(id) {
  state.projects = state.projects.filter((p) => p.id !== id);
  state.projectComponents = state.projectComponents.filter((pc) => pc.project_id !== id);
  state.projectCollaborators = state.projectCollaborators.filter((pc) => pc.project_id !== id);
  if (state.projectTags) {
    state.projectTags = state.projectTags.filter((pt) => pt.project_id !== id);
  }
  return true;
}

function getPendingProjects() {
  return state.projects
    .filter(
      (p) =>
        p.status === "pending" ||
        p.production_access_status === "pending" ||
        p.production_deploy_status === "pending"
    )
    .slice()
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map((p) => {
      const owner = p.owner_id ? state.profiles.find((pr) => pr.id === p.owner_id) : null;
      const bu = (state.businessUnits || []).find((u) => u.id === p.business_unit_id);
      const collaborators = state.projectCollaborators
        .filter((pc) => pc.project_id === p.id)
        .map((pc) => state.profiles.find((pr) => pr.id === pc.user_id))
        .filter(Boolean)
        .map((pr) => ({ id: pr.id, full_name: pr.full_name, email: pr.email }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name));
      const component_types = [
        ...new Set(
          state.projectComponents
            .filter((pc) => pc.project_id === p.id)
            .map((pc) => state.components.find((c) => c.id === pc.component_id))
            .filter((c) => c && c.status !== "archived")
            .map((c) => c.type)
        ),
      ].sort((a, b) => a.localeCompare(b));
      const tagIds = getProjectTagIds(p.id);
      const tags = tagIds
        .map((tid) => (state.projectTagDefinitions || []).find((d) => d.id === tid))
        .filter(Boolean)
        .map((t) => ({ id: t.id, group_key: t.group_key, name: t.name }));
      return {
        ...p,
        owner_name: owner?.full_name ?? null,
        owner_email: owner?.email ?? null,
        business_unit_name: bu?.name ?? null,
        collaborators,
        component_types,
        tags,
      };
    });
}

function getAllProjectsSummary() {
  return state.projects.map(({ id, name, service_user, owner_id }) => ({
    id,
    name,
    service_user,
    owner_id,
  }));
}

function clearProjectServiceUserByName(serviceUserName) {
  state.projects.forEach((p) => {
    if (p.service_user === serviceUserName) p.service_user = null;
  });
}

function assignProjectServiceUser(projectId, serviceUserName) {
  return updateProject(projectId, { service_user: serviceUserName });
}

function unassignProjectServiceUser(projectId) {
  return updateProject(projectId, { service_user: null });
}

// --- Components ---

function getComponents(ownerId) {
  return state.components
    .filter((c) => c.owner_id === ownerId)
    .map((c) => {
      const inv = c.source_inventory_id
        ? state.inventoryItems.find((i) => i.id === c.source_inventory_id)
        : null;
      return {
        ...c,
        modified_at: inv?.modified_at_src ?? null,
      };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function getAdminComponents(tenantId) {
  const assigned = new Set(state.projectComponents.map((pc) => pc.component_id));
  const profileMap = new Map(state.profiles.map((p) => [p.id, p]));
  return state.components
    .filter((c) => c.tenant_id === tenantId)
    .map((c) => {
      const owner = c.owner_id ? profileMap.get(c.owner_id) : null;
      return {
        ...c,
        owner_name: owner?.full_name ?? null,
        owner_email: owner?.email ?? null,
        is_assigned: assigned.has(c.id),
      };
    })
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function getAdminComponentDetail(tenantId, componentId) {
  const { extractComponentInventoryDetails } = require("./inventory/componentDetails");
  const { buildUrlFromInventoryItem } = require("./inventoryUrls");

  const c = state.components.find((x) => x.id === componentId && cTenant(x, tenantId));
  if (!c) {
    const err = new Error("Component not found");
    err.statusCode = 404;
    throw err;
  }

  const owner = c.owner_id ? state.profiles.find((p) => p.id === c.owner_id) : null;
  const pc = state.projectComponents.find((x) => x.component_id === c.id);
  const project = pc ? state.projects.find((p) => p.id === pc.project_id) : null;
  const inv = c.source_inventory_id
    ? state.inventoryItems.find((i) => i.id === c.source_inventory_id)
    : null;

  let environment_name = null;
  let environment_type = null;
  let workspace_name = null;
  let workspace_raw = null;
  let inventory_details = null;
  let open_url = c.url || null;

  if (inv) {
    if (inv.environment_id) {
      const env = (state.environments || []).find(
        (e) =>
          e.tenant_id === tenantId &&
          environmentKey(e.environment_id) === environmentKey(inv.environment_id)
      );
      environment_name = env?.display_name || null;
      environment_type = env?.environment_type || null;
    }
    if (inv.scope_type === "workspace" && inv.scope_id) {
      const ws = state.inventoryItems.find(
        (i) =>
          i.tenant_id === tenantId &&
          i.kind === "powerbi_workspace" &&
          lowerId(i.resource_id) === lowerId(inv.scope_id)
      );
      workspace_name = ws?.display_name || null;
      workspace_raw = ws?.raw || null;
    }

    const kind = inv.kind || c.type;
    inventory_details = extractComponentInventoryDetails(kind, inv.raw, {
      owner_external: inv.owner_external,
      owner_aad_id: inv.owner_aad_id,
      created_at_src: inv.created_at_src,
      modified_at_src: inv.modified_at_src,
      environment_type,
      scope_id: inv.scope_id,
      workspace_name,
      workspace_raw,
    });

    if (!open_url) {
      open_url = buildUrlFromInventoryItem(inv) || null;
    }
  }

  return {
    id: c.id,
    tenant_id: c.tenant_id,
    name: c.name,
    type: c.type,
    status: c.status,
    environments: c.environments,
    url: c.url,
    open_url,
    owner_id: c.owner_id,
    owner_name: owner?.full_name ?? null,
    owner_email: owner?.email ?? null,
    source_inventory_id: c.source_inventory_id || null,
    is_assigned: Boolean(project),
    project_id: project?.id || null,
    project_name: project?.name || null,
    environment_name,
    environment_type,
    inventory_details,
  };
}

function cTenant(row, tenantId) {
  return row.tenant_id === tenantId;
}

function getComponentsByIds(ids) {
  return state.components.filter((c) => ids.includes(c.id));
}

function insertComponents(rows) {
  const inserted = rows.map((r, i) => ({
    id: `c-${Date.now()}-${i}`,
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
  return inserted;
}

function getAssignedComponentIds() {
  return state.projectComponents.map((pc) => pc.component_id);
}

function getMyComponentIds(ownerId) {
  return state.components.filter((c) => c.owner_id === ownerId).map((c) => c.id);
}

function deleteComponents(ids) {
  state.components = state.components.filter((c) => !ids.includes(c.id));
}

function archiveComponent(id) {
  const comp = state.components.find((c) => c.id === id);
  if (comp) comp.status = "archived";
  return !!comp;
}

// --- Project components ---

function getProjectComponentIds(projectId) {
  return state.projectComponents
    .filter((pc) => pc.project_id === projectId)
    .map((pc) => pc.component_id);
}

function getAllProjectComponents() {
  return [...state.projectComponents];
}

function addProjectComponents(rows) {
  for (const row of rows) {
    state.projectComponents = state.projectComponents.filter(
      (pc) => pc.component_id !== row.component_id
    );
    state.projectComponents.push(row);
    const comp = state.components.find((c) => c.id === row.component_id);
    if (comp) comp.status = "assigned";
  }
}

function removeProjectComponent(projectId, componentId) {
  const before = state.projectComponents.length;
  state.projectComponents = state.projectComponents.filter(
    (pc) => !(pc.project_id === projectId && pc.component_id === componentId)
  );
  if (state.projectComponents.length === before) return false;
  const stillAssigned = state.projectComponents.some((pc) => pc.component_id === componentId);
  if (!stillAssigned) {
    const comp = state.components.find((c) => c.id === componentId);
    if (comp && comp.status === "assigned") comp.status = "unassigned";
  }
  return true;
}

// --- Project collaborators ---

function getMyCollaboratorProjectIds(userId) {
  return state.projectCollaborators
    .filter((pc) => pc.user_id === userId)
    .map((pc) => pc.project_id);
}

function getProjectCollaboratorUserIds(projectId) {
  return state.projectCollaborators
    .filter((pc) => pc.project_id === projectId)
    .map((pc) => pc.user_id);
}

function addProjectCollaborator(projectId, userId) {
  state.projectCollaborators.push({ project_id: projectId, user_id: userId });
}

function addProjectCollaborators(rows) {
  state.projectCollaborators.push(...rows);
}

function removeProjectCollaborator(projectId, userId) {
  state.projectCollaborators = state.projectCollaborators.filter(
    (pc) => !(pc.project_id === projectId && pc.user_id === userId)
  );
}

// --- Profiles ---

function getProfile(userId) {
  return state.profiles.find((p) => p.id === userId) ?? null;
}

function getProfilesByIds(ids) {
  return state.profiles.filter((p) => ids.includes(p.id));
}

function getTenantProfiles(tenantId, excludeUserId) {
  return state.profiles
    .filter((p) => p.tenant_id === tenantId && p.id !== excludeUserId)
    .map(({ id, full_name, email }) => ({ id, full_name, email }));
}

function getAllProfiles() {
  return state.profiles.map(({ id, full_name, email }) => ({ id, full_name, email }));
}

function getUserRoles(userId) {
  return state.userRoles.filter((r) => r.user_id === userId).map((r) => ({ role: r.role }));
}

function getAdminUsers() {
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
        membership: "owner",
      }));
    const ownedIds = new Set(owned.map((pr) => pr.id));
    const collab = state.projectCollaborators
      .filter((pc) => pc.user_id === p.id && !ownedIds.has(pc.project_id))
      .map((pc) => projectsById.get(pc.project_id))
      .filter(Boolean)
      .map((pr) => ({
        id: pr.id,
        name: pr.name,
        service_user: pr.service_user,
        status: pr.status,
        membership: "collaborator",
      }));
    const userProjects = [...owned, ...collab].sort((a, b) => a.name.localeCompare(b.name));

    return {
      id: p.id,
      full_name: p.full_name,
      email: p.email,
      role: rolesMap.get(p.id) ?? "user",
      projects: userProjects,
      unmanagedComponents: state.components.filter(
        (c) => c.owner_id === p.id && !assignedComponentIds.has(c.id) && c.status !== "archived"
      ).length,
      archivedComponents: state.components.filter(
        (c) => c.owner_id === p.id && c.status === "archived"
      ).length,
    };
  });
}

function updateUserRole(userId, role) {
  const entry = state.userRoles.find((r) => r.user_id === userId);
  if (entry) entry.role = role;
}

// --- Tenants ---

function getTenant(tenantId) {
  if (state.tenant.id !== tenantId) return null;
  return { ...state.tenant };
}

function updateTenant(tenantId, fields) {
  if (state.tenant.id !== tenantId) return;
  const patch = typeof fields === "string" ? { name: fields } : fields || {};
  if (patch.name != null) state.tenant.name = patch.name;
  if (patch.tool_name != null) state.tenant.tool_name = patch.tool_name;
}

function getTenantLogo(tenantId) {
  if (state.tenant.id !== tenantId || !state.tenant.logo_bytes) return null;
  return {
    bytes: state.tenant.logo_bytes,
    contentType: state.tenant.logo_content_type || "application/octet-stream",
  };
}

function setTenantLogo(tenantId, bytes, contentType) {
  if (state.tenant.id !== tenantId) return false;
  state.tenant.logo_bytes = bytes;
  state.tenant.logo_content_type = contentType;
  return true;
}

function clearTenantLogo(tenantId) {
  if (state.tenant.id !== tenantId) return false;
  state.tenant.logo_bytes = null;
  state.tenant.logo_content_type = null;
  return true;
}

function getTenantEmailDomains(tenantId) {
  return state.emailDomains
    .filter((d) => d.tenant_id === tenantId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function addTenantEmailDomain(tenantId, domain) {
  state.emailDomains.push({
    id: `d-${Date.now()}`,
    tenant_id: tenantId,
    domain,
    created_at: new Date().toISOString(),
  });
}

function deleteTenantEmailDomain(id) {
  state.emailDomains = state.emailDomains.filter((d) => d.id !== id);
}

// --- Business units ---

function listBusinessUnits(tenantId, { activeOnly = false } = {}) {
  return state.businessUnits
    .filter((u) => u.tenant_id === tenantId && (!activeOnly || u.is_active))
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

function getBusinessUnit(tenantId, id) {
  return state.businessUnits.find((u) => u.tenant_id === tenantId && u.id === id) || null;
}

function createBusinessUnit(tenantId, { name, sort_order }) {
  const row = {
    id: `bu-${Date.now()}`,
    tenant_id: tenantId,
    name: String(name || "").trim(),
    sort_order: sort_order ?? 0,
    is_active: true,
    created_at: new Date().toISOString(),
  };
  state.businessUnits.push(row);
  return { ...row };
}

function updateBusinessUnit(tenantId, id, patch) {
  const row = getBusinessUnit(tenantId, id);
  if (!row) return null;
  if (patch.name != null) row.name = String(patch.name).trim();
  if (patch.sort_order != null) row.sort_order = Number(patch.sort_order);
  if (patch.is_active != null) row.is_active = Boolean(patch.is_active);
  return { ...row };
}

function deactivateBusinessUnit(tenantId, id) {
  return updateBusinessUnit(tenantId, id, { is_active: false });
}

// --- Compliance questions ---

function listComplianceQuestions(tenantId, { activeOnly = false } = {}) {
  return state.complianceQuestions
    .filter((q) => q.tenant_id === tenantId && (!activeOnly || q.is_active))
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
}

function getComplianceQuestion(tenantId, id) {
  return state.complianceQuestions.find((q) => q.tenant_id === tenantId && q.id === id) || null;
}

function createComplianceQuestion(tenantId, input) {
  const answerType = input.answer_type === "select" ? "select" : "text";
  const row = {
    id: `cq-${Date.now()}`,
    tenant_id: tenantId,
    prompt: String(input.prompt || "").trim(),
    answer_type: answerType,
    options: answerType === "select" ? input.options || [] : [],
    required: input.required !== false,
    sort_order: input.sort_order ?? 0,
    is_active: true,
    created_at: new Date().toISOString(),
  };
  state.complianceQuestions.push(row);
  return { ...row };
}

function updateComplianceQuestion(tenantId, id, patch) {
  const row = getComplianceQuestion(tenantId, id);
  if (!row) return null;
  if (patch.prompt != null) row.prompt = String(patch.prompt).trim();
  if (patch.answer_type != null) row.answer_type = patch.answer_type === "select" ? "select" : "text";
  if (patch.options != null) row.options = Array.isArray(patch.options) ? patch.options : [];
  if (patch.required != null) row.required = Boolean(patch.required);
  if (patch.sort_order != null) row.sort_order = Number(patch.sort_order);
  if (patch.is_active != null) row.is_active = Boolean(patch.is_active);
  return { ...row };
}

function deactivateComplianceQuestion(tenantId, id) {
  return updateComplianceQuestion(tenantId, id, { is_active: false });
}

// --- Project tags (Discovery) ---

function listProjectTagDefinitions(tenantId, { activeOnly = false } = {}) {
  return (state.projectTagDefinitions || [])
    .filter((t) => t.tenant_id === tenantId && (!activeOnly || t.is_active))
    .slice()
    .sort(
      (a, b) =>
        a.group_key.localeCompare(b.group_key) ||
        a.sort_order - b.sort_order ||
        a.name.localeCompare(b.name)
    );
}

function getProjectTagDefinition(tenantId, id) {
  return (
    (state.projectTagDefinitions || []).find((t) => t.tenant_id === tenantId && t.id === id) || null
  );
}

function createProjectTagDefinition(tenantId, input) {
  if (!state.projectTagDefinitions) state.projectTagDefinitions = [];
  const row = {
    id: `tag-${Date.now()}`,
    tenant_id: tenantId,
    group_key: input.group_key === "capability" ? "capability" : "domain",
    name: String(input.name || "").trim(),
    sort_order: input.sort_order ?? 0,
    is_active: true,
    created_at: new Date().toISOString(),
  };
  state.projectTagDefinitions.push(row);
  return { ...row };
}

function updateProjectTagDefinition(tenantId, id, patch) {
  const row = getProjectTagDefinition(tenantId, id);
  if (!row) return null;
  if (patch.name != null) row.name = String(patch.name).trim();
  if (patch.group_key != null) row.group_key = patch.group_key === "capability" ? "capability" : "domain";
  if (patch.sort_order != null) row.sort_order = Number(patch.sort_order);
  if (patch.is_active != null) row.is_active = Boolean(patch.is_active);
  return { ...row };
}

function deactivateProjectTagDefinition(tenantId, id) {
  return updateProjectTagDefinition(tenantId, id, { is_active: false });
}

function getProjectTagIds(projectId) {
  return (state.projectTags || [])
    .filter((pt) => pt.project_id === projectId)
    .map((pt) => pt.tag_id);
}

function setProjectTags(projectId, tagIds) {
  if (!state.projectTags) state.projectTags = [];
  const ids = [...new Set((tagIds || []).map(String).filter(Boolean))];
  state.projectTags = state.projectTags.filter((pt) => pt.project_id !== projectId);
  for (const tagId of ids) {
    state.projectTags.push({ project_id: projectId, tag_id: tagId });
  }
}

function listDiscoveryProjects(tenantId, { q, domain, capability, business_unit_id } = {}) {
  const qNorm = q ? String(q).trim().toLowerCase() : "";
  let projects = state.projects.filter(
    (p) => p.tenant_id === tenantId && p.status !== "draft"
  );
  if (qNorm) {
    projects = projects.filter(
      (p) =>
        String(p.name || "").toLowerCase().includes(qNorm) ||
        String(p.description || "").toLowerCase().includes(qNorm)
    );
  }
  if (business_unit_id) {
    projects = projects.filter((p) => p.business_unit_id === business_unit_id);
  }
  if (domain) {
    projects = projects.filter((p) =>
      getProjectTagIds(p.id).some((tid) => {
        const t = (state.projectTagDefinitions || []).find((d) => d.id === tid);
        return t && t.group_key === "domain" && t.id === domain;
      })
    );
  }
  if (capability) {
    projects = projects.filter((p) =>
      getProjectTagIds(p.id).some((tid) => {
        const t = (state.projectTagDefinitions || []).find((d) => d.id === tid);
        return t && t.group_key === "capability" && t.id === capability;
      })
    );
  }

  return projects
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((p) => {
      const owner = state.profiles.find((pr) => pr.id === p.owner_id);
      const bu = (state.businessUnits || []).find((u) => u.id === p.business_unit_id);
      const tagIds = getProjectTagIds(p.id);
      const tags = tagIds
        .map((tid) => (state.projectTagDefinitions || []).find((d) => d.id === tid))
        .filter(Boolean)
        .map((t) => ({ id: t.id, group_key: t.group_key, name: t.name }))
        .sort(
          (a, b) => a.group_key.localeCompare(b.group_key) || a.name.localeCompare(b.name)
        );
      const collaborators = state.projectCollaborators
        .filter((pc) => pc.project_id === p.id)
        .map((pc) => state.profiles.find((pr) => pr.id === pc.user_id))
        .filter(Boolean)
        .map((pr) => ({ id: pr.id, full_name: pr.full_name }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name));
      const component_types = [
        ...new Set(
          state.projectComponents
            .filter((pc) => pc.project_id === p.id)
            .map((pc) => state.components.find((c) => c.id === pc.component_id))
            .filter((c) => c && c.status !== "archived")
            .map((c) => c.type)
        ),
      ].sort((a, b) => a.localeCompare(b));
      return {
        id: p.id,
        tenant_id: p.tenant_id,
        name: p.name,
        description: p.description,
        status: p.status,
        created_at: p.created_at,
        business_unit_id: p.business_unit_id ?? null,
        business_unit_name: bu?.name ?? null,
        owner: owner
          ? { id: owner.id, full_name: owner.full_name, email: owner.email }
          : null,
        collaborators,
        tags,
        component_types,
      };
    });
}

// --- Service users ---

function getServiceUsersWithDetails() {
  const profileMap = new Map(state.profiles.map((p) => [p.id, p]));

  return state.serviceUsers.map((su) => ({
    id: su.id,
    name: su.name,
    assigned_to: su.assigned_to,
    assigned_user: su.assigned_to ? profileMap.get(su.assigned_to) ?? null : null,
    projects: state.projects
      .filter((p) => p.service_user === su.name)
      .map((p) => ({
        id: p.id,
        name: p.name,
        owner_name: p.owner_id ? profileMap.get(p.owner_id)?.full_name ?? "–" : "–",
      })),
  }));
}

function createServiceUser(name, tenantId, assignedTo) {
  state.serviceUsers.push({
    id: `su-${Date.now()}`,
    name,
    tenant_id: tenantId,
    assigned_to: assignedTo,
  });
}

function deleteServiceUser(id, name) {
  clearProjectServiceUserByName(name);
  state.serviceUsers = state.serviceUsers.filter((su) => su.id !== id);
}

function updateServiceUserAssignment(serviceUserId, userId) {
  const su = state.serviceUsers.find((s) => s.id === serviceUserId);
  if (su) su.assigned_to = userId;
}

function upsertProfile({ id, tenant_id, full_name, email }) {
  const existing = state.profiles.find((p) => p.id === id);
  if (existing) {
    existing.full_name = full_name;
    existing.email = email;
    return existing;
  }
  const profile = {
    id,
    tenant_id,
    full_name,
    email,
    created_at: new Date().toISOString(),
  };
  state.profiles.push(profile);
  return profile;
}

function ensureUserRole(userId, role = "user") {
  const hasRole = state.userRoles.some((r) => r.user_id === userId && r.role === role);
  if (!hasRole) {
    state.userRoles.push({ user_id: userId, role });
  }
}

function resolveTenantByEmail(email) {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  const match = state.emailDomains.find((d) => d.domain.toLowerCase() === domain);
  return match?.tenant_id ?? null;
}

// --- Job runs ---

function createJobRun({ tenant_id, job_type, trigger, requested_by = null, params = {} }) {
  const active = state.jobRuns.find(
    (r) => r.tenant_id === tenant_id && r.job_type === job_type && r.status === "running"
  );
  if (active) {
    // Mirror the Postgres unique-violation code so the runner maps it to 409.
    const err = new Error("A job of this type is already running");
    err.code = "23505";
    throw err;
  }
  const now = new Date().toISOString();
  const run = {
    id: `jr-${Date.now()}`,
    tenant_id,
    job_type,
    trigger,
    status: "running",
    requested_by,
    params: params ?? {},
    stats: {},
    error: null,
    started_at: now,
    finished_at: null,
    created_at: now,
  };
  state.jobRuns.unshift(run);
  return run;
}

function updateJobRun(id, updates) {
  const run = state.jobRuns.find((r) => r.id === id);
  if (run) Object.assign(run, updates);
}

function getJobRun(id) {
  return state.jobRuns.find((r) => r.id === id) ?? null;
}

function listJobRuns({ tenant_id, job_type, status, limit = 50 }) {
  return state.jobRuns
    .filter(
      (r) =>
        r.tenant_id === tenant_id &&
        (!job_type || r.job_type === job_type) &&
        (!status || r.status === status)
    )
    .slice(0, limit);
}

function reapStaleJobRuns(timeoutMs) {
  const cutoff = Date.now() - timeoutMs;
  let n = 0;
  state.jobRuns.forEach((r) => {
    if (r.status === "running" && new Date(r.started_at).getTime() < cutoff) {
      r.status = "failed";
      r.error = "Timed out / interrupted";
      r.finished_at = new Date().toISOString();
      n++;
    }
  });
  return n;
}

// --- Inventory items ---

function upsertInventoryItems(tenantId, items, syncedAt) {
  let count = 0;
  for (const it of items) {
    const environmentId = canonicalizeEnvironmentId(it.environment_id) ?? null;
    const scopeType =
      it.scope_type ??
      (environmentId ? "environment" : it.scope_id ? "workspace" : "none");
    const scopeId =
      scopeType === "environment"
        ? canonicalizeEnvironmentId(it.scope_id ?? environmentId) ?? null
        : it.scope_id ?? environmentId ?? null;
    const resourceId =
      it.kind === "environment"
        ? canonicalizeEnvironmentId(it.resource_id)
        : it.resource_id;
    const normalized = {
      ...it,
      resource_id: resourceId,
      environment_id: environmentId,
      scope_type: scopeType,
      scope_id: scopeId,
    };
    const existing = state.inventoryItems.find(
      (r) =>
        r.tenant_id === tenantId &&
        r.resource_type === normalized.resource_type &&
        r.resource_id === normalized.resource_id
    );
    if (existing) {
      const nextOwnerAad =
        normalized.owner_aad_id != null && normalized.owner_aad_id !== ""
          ? normalized.owner_aad_id
          : existing.owner_aad_id;
      const nextOwnerExternal =
        normalized.owner_external != null && normalized.owner_external !== ""
          ? normalized.owner_external
          : existing.owner_external;
      Object.assign(existing, normalized, {
        tenant_id: tenantId,
        owner_aad_id: nextOwnerAad ?? null,
        owner_external: nextOwnerExternal ?? null,
        last_synced_at: syncedAt,
        is_active: true,
      });
    } else {
      state.inventoryItems.push({
        id: `inv-${Date.now()}-${count}`,
        tenant_id: tenantId,
        ...normalized,
        first_seen_at: syncedAt,
        last_synced_at: syncedAt,
        is_active: true,
      });
    }
    count++;
  }
  return count;
}

function deactivateStaleInventory(tenantId, syncedAt, resourceTypes) {
  const types = new Set(resourceTypes);
  const cutoff = new Date(syncedAt).getTime();
  let n = 0;
  state.inventoryItems.forEach((r) => {
    if (
      r.tenant_id === tenantId &&
      r.is_active &&
      types.has(r.resource_type) &&
      new Date(r.last_synced_at).getTime() < cutoff
    ) {
      r.is_active = false;
      n++;
    }
  });
  return n;
}

function getInventoryItems({ tenant_id, kind, activeOnly = true, limit = 500 }) {
  return state.inventoryItems
    .filter(
      (r) =>
        r.tenant_id === tenant_id &&
        (!activeOnly || r.is_active) &&
        (!kind || r.kind === kind)
    )
    .slice(0, limit);
}

function getInventoryItem(tenantId, id) {
  const row = state.inventoryItems.find((r) => r.id === id && r.tenant_id === tenantId);
  return row ? { ...row } : null;
}

const IMPORT_TYPE_BY_KIND = {
  canvasapp: "Power App",
  modeldrivenapp: "Power App",
  cloudflow: "Power Automate",
  agent: "Copilot Agent",
  powerbi_report: "Power BI",
  powerbi_dashboard: "Power BI",
};

const PP_IMPORT_KINDS = new Set(["canvasapp", "modeldrivenapp", "cloudflow", "agent"]);
const PBI_IMPORT_KINDS = new Set(["powerbi_report", "powerbi_dashboard"]);

function getComponentImportSettings(tenantId) {
  const row = state.componentImportSettings[tenantId];
  if (!row) {
    return {
      tenant_id: tenantId,
      kinds: [],
      environment_ids: [],
      workspace_ids: [],
      updated_at: null,
      updated_by: null,
    };
  }
  return { workspace_ids: [], ...row };
}

function upsertComponentImportSettings(
  tenantId,
  { kinds, environment_ids, workspace_ids, updated_by }
) {
  const row = {
    tenant_id: tenantId,
    kinds: kinds || [],
    environment_ids: (environment_ids || []).map((id) => canonicalizeEnvironmentId(id)),
    workspace_ids: workspace_ids || [],
    updated_at: new Date().toISOString(),
    updated_by: updated_by ?? null,
  };
  state.componentImportSettings[tenantId] = row;
  return { ...row };
}

function listEnvironments(tenantId, { activeOnly = true } = {}) {
  return (state.environments || [])
    .filter((e) => e.tenant_id === tenantId && (!activeOnly || e.is_active))
    .sort((a, b) => String(a.display_name || "").localeCompare(String(b.display_name || "")))
    .map((e) => ({ ...e }));
}

function syncEnvironmentsFromInventory(tenantId, syncedAt) {
  if (!state.environments) state.environments = [];
  const cutoff = new Date(syncedAt).getTime();
  const items = state.inventoryItems.filter(
    (r) =>
      r.tenant_id === tenantId &&
      r.kind === "environment" &&
      r.is_active &&
      String(r.resource_type || "").startsWith("microsoft.") &&
      new Date(r.last_synced_at).getTime() >= cutoff
  );

  let upserted = 0;
  for (const it of items) {
    const props = (it.raw && it.raw.properties) || {};
    const envId = canonicalizeEnvironmentId(it.resource_id);
    const existing = state.environments.find(
      (e) => e.tenant_id === tenantId && environmentKey(e.environment_id) === environmentKey(envId)
    );
    const row = {
      id: existing?.id || `env-${envId}`,
      tenant_id: tenantId,
      environment_id: envId,
      display_name: it.display_name ?? props.displayName ?? null,
      environment_type: props.environmentType ?? null,
      region: it.location ?? null,
      is_managed: typeof props.isManaged === "boolean" ? props.isManaged : null,
      is_active: true,
      source_inventory_id: it.id,
      last_synced_at: syncedAt,
    };
    if (existing) Object.assign(existing, row);
    else state.environments.push(row);
    upserted++;
  }

  let deactivated = 0;
  for (const e of state.environments) {
    if (
      e.tenant_id === tenantId &&
      e.is_active &&
      new Date(e.last_synced_at).getTime() < cutoff
    ) {
      e.is_active = false;
      deactivated++;
    }
  }

  return { environments_upserted: upserted, environments_deactivated: deactivated };
}

function listWorkspaces(tenantId, { activeOnly = true } = {}) {
  return (state.workspaces || [])
    .filter((w) => w.tenant_id === tenantId && (!activeOnly || w.is_active))
    .sort((a, b) => String(a.display_name || "").localeCompare(String(b.display_name || "")))
    .map((w) => ({ ...w }));
}

function syncWorkspacesFromInventory(tenantId, syncedAt) {
  if (!state.workspaces) state.workspaces = [];
  const cutoff = new Date(syncedAt).getTime();
  const items = state.inventoryItems.filter(
    (r) =>
      r.tenant_id === tenantId &&
      r.kind === "powerbi_workspace" &&
      r.resource_type === "powerbi/workspace" &&
      r.is_active &&
      new Date(r.last_synced_at).getTime() >= cutoff
  );

  let upserted = 0;
  for (const it of items) {
    const raw = it.raw || {};
    const existing = state.workspaces.find(
      (w) => w.tenant_id === tenantId && w.workspace_id === it.resource_id
    );
    const row = {
      id: existing?.id || `ws-${it.resource_id}`,
      tenant_id: tenantId,
      workspace_id: it.resource_id,
      display_name: it.display_name ?? raw.name ?? null,
      workspace_type: raw.type ?? null,
      state: raw.state ?? null,
      is_active: true,
      source_inventory_id: it.id,
      last_synced_at: syncedAt,
    };
    if (existing) Object.assign(existing, row);
    else state.workspaces.push(row);
    upserted++;
  }

  let deactivated = 0;
  for (const w of state.workspaces) {
    if (
      w.tenant_id === tenantId &&
      w.is_active &&
      new Date(w.last_synced_at).getTime() < cutoff
    ) {
      w.is_active = false;
      deactivated++;
    }
  }

  return { workspaces_upserted: upserted, workspaces_deactivated: deactivated };
}

function listInventoryEnvironments(tenantId) {
  return listEnvironments(tenantId, { activeOnly: true }).map((e) => ({
    id: e.id,
    resource_id: e.environment_id,
    display_name: e.display_name,
    environment_type: e.environment_type,
    region: e.region,
    is_managed: e.is_managed,
    last_synced_at: e.last_synced_at,
  }));
}

function hasImportableScope({ kinds, environmentIds, workspaceIds }) {
  if (!kinds?.length) return false;
  const hasPp = kinds.some((k) => PP_IMPORT_KINDS.has(k)) && environmentIds?.length;
  const hasPbi = kinds.some((k) => PBI_IMPORT_KINDS.has(k)) && workspaceIds?.length;
  return Boolean(hasPp || hasPbi);
}

function matchesImportFilters(r, kindSet, envSet, wsSet) {
  if (!kindSet.has(r.kind) || !r.is_active) return false;
  const rt = String(r.resource_type || "");
  if (rt.startsWith("microsoft.")) return envSet.has(environmentKey(r.environment_id));
  if (rt.startsWith("powerbi/")) return wsSet.has(lowerId(r.scope_id));
  return false;
}

function previewComponentImport(tenantId, { kinds, environmentIds, workspaceIds }) {
  const envIds = environmentIds || [];
  const wsIds = workspaceIds || [];
  if (!hasImportableScope({ kinds, environmentIds: envIds, workspaceIds: wsIds })) {
    return { count: 0, by_kind: {} };
  }
  const kindSet = new Set(kinds);
  const envSet = new Set(envIds.map(environmentKey));
  const wsSet = new Set(wsIds.map(lowerId));
  const by_kind = {};
  let count = 0;
  for (const r of state.inventoryItems) {
    if (r.tenant_id !== tenantId || !matchesImportFilters(r, kindSet, envSet, wsSet)) continue;
    by_kind[r.kind] = (by_kind[r.kind] || 0) + 1;
    count++;
  }
  return { count, by_kind };
}

function importComponentsFromInventory(tenantId, { kinds, environmentIds, workspaceIds }) {
  const envIds = environmentIds || [];
  const wsIds = workspaceIds || [];
  if (!hasImportableScope({ kinds, environmentIds: envIds, workspaceIds: wsIds })) {
    return { inserted: 0, updated: 0, archived: 0, unresolved_owner: 0, matched: 0 };
  }

  const envByKey = new Map(
    (state.environments || [])
      .filter((e) => e.tenant_id === tenantId)
      .map((e) => [environmentKey(e.environment_id), e])
  );
  const wsName = new Map(
    (state.workspaces || [])
      .filter((w) => w.tenant_id === tenantId)
      .map((w) => [lowerId(w.workspace_id), w.display_name || w.workspace_id])
  );
  const profileIds = new Set(
    state.profiles.filter((p) => p.tenant_id === tenantId).map((p) => p.id.toLowerCase())
  );
  const kindSet = new Set(kinds);
  const envSet = new Set(envIds.map(environmentKey));
  const wsSet = new Set(wsIds.map(lowerId));

  const items = state.inventoryItems.filter(
    (r) => r.tenant_id === tenantId && matchesImportFilters(r, kindSet, envSet, wsSet)
  );

  let inserted = 0;
  let updated = 0;
  let unresolved_owner = 0;

  for (const it of items) {
    const ownerId =
      it.owner_aad_id && profileIds.has(String(it.owner_aad_id).toLowerCase())
        ? it.owner_aad_id
        : null;
    if (!ownerId) unresolved_owner++;

    const compId = `c-${it.id}`;
    const type = IMPORT_TYPE_BY_KIND[it.kind] || it.kind;
    let locationLabel = [];
    let environmentId = null;
    if (PBI_IMPORT_KINDS.has(it.kind) && it.scope_id) {
      locationLabel = [wsName.get(lowerId(it.scope_id)) || it.scope_id];
    } else if (it.environment_id) {
      const env = envByKey.get(environmentKey(it.environment_id));
      environmentId = env?.environment_id || canonicalizeEnvironmentId(it.environment_id);
      locationLabel = [env?.display_name || environmentId];
    }
    const url = buildUrlFromInventoryItem(it);

    const existing = state.components.find((c) => c.id === compId);
    if (existing) {
      existing.name = it.display_name || "(unnamed)";
      existing.type = type;
      existing.kind = it.kind;
      existing.environments = locationLabel;
      existing.environment_id = environmentId;
      if (ownerId) existing.owner_id = ownerId;
      existing.url = url;
      existing.source_inventory_id = it.id;
      updated++;
    } else {
      state.components.push({
        id: compId,
        tenant_id: it.tenant_id || tenantId,
        name: it.display_name || "(unnamed)",
        type,
        kind: it.kind,
        environments: locationLabel,
        environment_id: environmentId,
        owner_id: ownerId,
        created_at: new Date().toISOString(),
        status: "unassigned",
        url,
        source_inventory_id: it.id,
      });
      inserted++;
    }
  }

  let archived = 0;
  for (const c of state.components) {
    if (!c.source_inventory_id || c.status === "archived") continue;
    const inv = state.inventoryItems.find((i) => i.id === c.source_inventory_id);
    if (
      inv &&
      inv.tenant_id === tenantId &&
      !inv.is_active &&
      (String(inv.resource_type || "").startsWith("microsoft.") ||
        String(inv.resource_type || "").startsWith("powerbi/"))
    ) {
      c.status = "archived";
      archived++;
    }
  }

  return {
    matched: items.length,
    inserted,
    updated,
    archived,
    unresolved_owner,
  };
}

function upsertAgentUsageDaily(tenantId, rows, syncedAt) {
  if (!state.agentUsageDaily) state.agentUsageDaily = [];
  let n = 0;
  for (const r of rows) {
    const existing = state.agentUsageDaily.find(
      (x) => x.tenant_id === tenantId && x.source_id === r.source_id
    );
    const row = {
      id: existing?.id || `aud-${r.source_id}`,
      tenant_id: tenantId,
      source_id: r.source_id,
      usage_date: r.usage_date,
      billed_credits: r.billed_credits,
      unbilled_credits: r.unbilled_credits,
      agent_resource_id: r.agent_resource_id,
      inventory_item_id: existing?.inventory_item_id ?? null,
      environment_id: r.environment_id,
      feature: r.feature,
      display_name: r.display_name,
      raw: r.raw || {},
      last_synced_at: syncedAt,
      is_active: true,
    };
    if (existing) Object.assign(existing, row);
    else state.agentUsageDaily.push(row);
    n++;
  }
  return n;
}

function deactivateStaleAgentUsage(tenantId, syncedAt) {
  if (!state.agentUsageDaily) return 0;
  let n = 0;
  for (const r of state.agentUsageDaily) {
    if (r.tenant_id === tenantId && r.is_active && r.last_synced_at < syncedAt) {
      r.is_active = false;
      n++;
    }
  }
  return n;
}

function linkAgentUsageToInventory(tenantId) {
  if (!state.agentUsageDaily) return 0;
  let n = 0;
  for (const u of state.agentUsageDaily) {
    if (u.tenant_id !== tenantId || !u.agent_resource_id) continue;
    const inv = state.inventoryItems.find(
      (i) =>
        i.tenant_id === tenantId &&
        i.kind === "agent" &&
        i.is_active &&
        lowerId(i.resource_id) === lowerId(u.agent_resource_id)
    );
    if (inv && u.inventory_item_id !== inv.id) {
      u.inventory_item_id = inv.id;
      n++;
    }
  }
  return n;
}

function listCreditRateCards(tenantId) {
  return (state.creditRateCards || [])
    .filter((c) => c.tenant_id === tenantId)
    .slice()
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))
    .map((c) => ({ ...c }));
}

function replaceCreditRateCards(tenantId, cards, updatedBy) {
  const { rangesOverlap } = require("./copilotStudio/creditRates");
  const normalized = (cards || []).map((c) => ({
    label: String(c.label || ""),
    euro_per_credit: Number(c.euro_per_credit),
    effective_from: String(c.effective_from).slice(0, 10),
    effective_to: c.effective_to ? String(c.effective_to).slice(0, 10) : null,
  }));
  for (const c of normalized) {
    if (!c.effective_from || !Number.isFinite(c.euro_per_credit) || c.euro_per_credit < 0) {
      const err = new Error("Each rate card needs effective_from and non-negative euro_per_credit");
      err.statusCode = 400;
      throw err;
    }
    if (c.effective_to && c.effective_to < c.effective_from) {
      const err = new Error("effective_to must be on or after effective_from");
      err.statusCode = 400;
      throw err;
    }
  }
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      if (
        rangesOverlap(
          normalized[i].effective_from,
          normalized[i].effective_to,
          normalized[j].effective_from,
          normalized[j].effective_to
        )
      ) {
        const err = new Error("Rate card date ranges must not overlap");
        err.statusCode = 400;
        throw err;
      }
    }
  }
  state.creditRateCards = (state.creditRateCards || []).filter((c) => c.tenant_id !== tenantId);
  const now = new Date().toISOString();
  for (const c of normalized) {
    state.creditRateCards.push({
      id: `crc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tenant_id: tenantId,
      label: c.label,
      euro_per_credit: c.euro_per_credit,
      effective_from: c.effective_from,
      effective_to: c.effective_to,
      updated_by: updatedBy ?? null,
      created_at: now,
      updated_at: now,
    });
  }
  return listCreditRateCards(tenantId);
}

function getAgentCreditsSummary(tenantId, { from, to, business_unit_id } = {}) {
  const { aggregateAgentCredits } = require("./copilotStudio/creditRates");
  const { extractAgentInventoryDetails } = require("./copilotStudio/agentInventoryDetails");
  if (!from || !to) {
    const err = new Error("from and to query params are required (YYYY-MM-DD)");
    err.statusCode = 400;
    throw err;
  }

  const envByKey = new Map(
    (state.environments || [])
      .filter((e) => e.tenant_id === tenantId)
      .map((e) => [environmentKey(e.environment_id), e])
  );
  const projectsById = new Map(state.projects.map((p) => [p.id, p]));
  const buById = new Map((state.businessUnits || []).map((b) => [b.id, b]));

  const dailyRows = [];
  for (const u of state.agentUsageDaily || []) {
    if (u.tenant_id !== tenantId || !u.is_active) continue;
    if (u.usage_date < from || u.usage_date > to) continue;

    const inv =
      (u.inventory_item_id && state.inventoryItems.find((i) => i.id === u.inventory_item_id)) ||
      state.inventoryItems.find(
        (i) =>
          i.tenant_id === tenantId &&
          i.kind === "agent" &&
          u.agent_resource_id &&
          lowerId(i.resource_id) === lowerId(u.agent_resource_id)
      );

    const comp = inv
      ? state.components.find((c) => c.source_inventory_id === inv.id)
      : null;
    const pc = comp
      ? state.projectComponents.find((x) => x.component_id === comp.id)
      : null;
    const project = pc ? projectsById.get(pc.project_id) : null;
    const bu = project?.business_unit_id ? buById.get(project.business_unit_id) : null;
    const envId = u.environment_id || inv?.environment_id || null;
    const env = envId ? envByKey.get(environmentKey(envId)) : null;

    dailyRows.push({
      usage_date: u.usage_date,
      billed_credits: u.billed_credits,
      unbilled_credits: u.unbilled_credits,
      agent_resource_id: u.agent_resource_id,
      inventory_item_id: inv?.id || u.inventory_item_id || null,
      display_name: inv?.display_name || u.display_name || u.agent_resource_id,
      environment_id: env?.environment_id || envId,
      environment_name: env?.display_name || null,
      environment_type: env?.environment_type || null,
      inventory_details: inv
        ? extractAgentInventoryDetails(inv.raw, {
            owner_external: inv.owner_external,
            owner_aad_id: inv.owner_aad_id,
            created_at_src: inv.created_at_src,
            environment_type: env?.environment_type || null,
          })
        : null,
      project_id: project?.id || null,
      project_name: project?.name || null,
      business_unit_id: project?.business_unit_id || null,
      business_unit_name: bu?.name || null,
      agent_key: lowerId(u.agent_resource_id || u.inventory_item_id || u.id),
    });
  }

  const rates = listCreditRateCards(tenantId);
  const summary = aggregateAgentCredits(dailyRows, rates, {
    businessUnitId: business_unit_id || undefined,
  });
  return {
    from,
    to,
    business_unit_id: business_unit_id || null,
    ...summary,
  };
}

module.exports = {
  resetStore,
  getProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  getPendingProjects,
  getAllProjectsSummary,
  clearProjectServiceUserByName,
  assignProjectServiceUser,
  unassignProjectServiceUser,
  getComponents,
  getAdminComponents,
  getAdminComponentDetail,
  getComponentsByIds,
  insertComponents,
  getAssignedComponentIds,
  getMyComponentIds,
  deleteComponents,
  archiveComponent,
  getProjectComponentIds,
  getAllProjectComponents,
  addProjectComponents,
  removeProjectComponent,
  getMyCollaboratorProjectIds,
  getProjectCollaboratorUserIds,
  getProfilesByIds,
  getTenantProfiles,
  getAllProfiles,
  getProfile,
  getUserRoles,
  getAdminUsers,
  updateUserRole,
  getTenant,
  updateTenant,
  getTenantLogo,
  setTenantLogo,
  clearTenantLogo,
  getTenantEmailDomains,
  addTenantEmailDomain,
  deleteTenantEmailDomain,
  listBusinessUnits,
  getBusinessUnit,
  createBusinessUnit,
  updateBusinessUnit,
  deactivateBusinessUnit,
  listComplianceQuestions,
  getComplianceQuestion,
  createComplianceQuestion,
  updateComplianceQuestion,
  deactivateComplianceQuestion,
  listProjectTagDefinitions,
  getProjectTagDefinition,
  createProjectTagDefinition,
  updateProjectTagDefinition,
  deactivateProjectTagDefinition,
  getProjectTagIds,
  setProjectTags,
  listDiscoveryProjects,
  getServiceUsersWithDetails,
  createServiceUser,
  deleteServiceUser,
  updateServiceUserAssignment,
  addProjectCollaborator,
  addProjectCollaborators,
  removeProjectCollaborator,
  upsertProfile,
  ensureUserRole,
  resolveTenantByEmail,
  createJobRun,
  updateJobRun,
  getJobRun,
  listJobRuns,
  reapStaleJobRuns,
  upsertInventoryItems,
  deactivateStaleInventory,
  getInventoryItems,
  getInventoryItem,
  getComponentImportSettings,
  upsertComponentImportSettings,
  listEnvironments,
  syncEnvironmentsFromInventory,
  listWorkspaces,
  syncWorkspacesFromInventory,
  listInventoryEnvironments,
  previewComponentImport,
  importComponentsFromInventory,
  upsertAgentUsageDaily,
  deactivateStaleAgentUsage,
  linkAgentUsageToInventory,
  listCreditRateCards,
  replaceCreditRateCards,
  getAgentCreditsSummary,
};
