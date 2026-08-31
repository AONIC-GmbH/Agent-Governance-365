const { query } = require("./db");
const { buildUrlFromInventoryItem } = require("./inventoryUrls");
const { canonicalizeEnvironmentId, environmentKey } = require("./environmentIds");

// Environments are matched on their guid so `Default-{guid}`, `default-{guid}`
// and the bare `{guid}` returned by the admin APIs all resolve to one environment.
const ENV_KEY = (col) => `lower(regexp_replace(${col}, '^default-', '', 'i'))`;

function iso(row) {
  if (!row) return row;
  const out = { ...row };
  for (const key of Object.keys(out)) {
    if (out[key] instanceof Date) out[key] = out[key].toISOString();
  }
  return out;
}

function isoRows(rows) {
  return rows.map(iso);
}

// --- Projects ---

async function getProjects() {
  const { rows } = await query("SELECT * FROM projects ORDER BY created_at DESC");
  return isoRows(rows);
}

async function getProject(id) {
  const { rows } = await query(
    `SELECT p.*, pr.full_name AS owner_name, pr.email AS owner_email
       FROM projects p
       LEFT JOIN profiles pr ON pr.id = p.owner_id
      WHERE p.id = $1`,
    [id]
  );
  return rows[0] ? iso(rows[0]) : null;
}

async function createProject(input) {
  const id = `s-${Date.now()}`;
  await query(
    `INSERT INTO projects
       (id, tenant_id, name, description, owner_id, status, answers, business_unit_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      input.tenant_id,
      input.name,
      input.description,
      input.owner_id,
      input.status,
      JSON.stringify(input.answers ?? {}),
      input.business_unit_id ?? null,
    ]
  );
  if (Array.isArray(input.tag_ids)) {
    await setProjectTags(id, input.tag_ids);
  }
  return { id };
}

async function updateProject(id, updates) {
  const patch = { ...(updates || {}) };
  const tagIds = patch.tag_ids;
  delete patch.tag_ids;

  const fields = [];
  const values = [];
  let i = 1;
  for (const [key, value] of Object.entries(patch)) {
    fields.push(`${key} = $${i++}`);
    values.push(key === "answers" ? JSON.stringify(value) : value);
  }
  if (fields.length > 0) {
    values.push(id);
    const { rowCount } = await query(
      `UPDATE projects SET ${fields.join(", ")} WHERE id = $${i}`,
      values
    );
    if (rowCount === 0) return false;
  } else {
    const existing = await getProject(id);
    if (!existing) return false;
  }
  if (Array.isArray(tagIds)) {
    await setProjectTags(id, tagIds);
  }
  return true;
}

async function deleteProject(id) {
  await query("DELETE FROM project_tags WHERE project_id = $1", [id]);
  await query("DELETE FROM project_components WHERE project_id = $1", [id]);
  await query("DELETE FROM project_collaborators WHERE project_id = $1", [id]);
  const { rowCount } = await query("DELETE FROM projects WHERE id = $1", [id]);
  return rowCount > 0;
}

async function getPendingProjects() {
  const { rows } = await query(
    `SELECT p.*,
            bu.name AS business_unit_name,
            own.full_name AS owner_name,
            own.email AS owner_email
       FROM projects p
       LEFT JOIN business_units bu ON bu.id = p.business_unit_id
       LEFT JOIN profiles own ON own.id = p.owner_id
      WHERE p.status = 'pending'
         OR p.production_access_status = 'pending'
         OR p.production_deploy_status = 'pending'
      ORDER BY p.created_at DESC`
  );
  if (rows.length === 0) return [];

  const projectIds = rows.map((p) => p.id);
  const { rows: collabRows } = await query(
    `SELECT pc.project_id, pr.id, pr.full_name, pr.email
       FROM project_collaborators pc
       JOIN profiles pr ON pr.id = pc.user_id
      WHERE pc.project_id = ANY($1::text[])
      ORDER BY pr.full_name`,
    [projectIds]
  );
  const { rows: typeRows } = await query(
    `SELECT DISTINCT pc.project_id, c.type
       FROM project_components pc
       JOIN components c ON c.id = pc.component_id
      WHERE pc.project_id = ANY($1::text[])
        AND c.status <> 'archived'
      ORDER BY c.type`,
    [projectIds]
  );
  const { rows: tagRows } = await query(
    `SELECT pt.project_id, td.id, td.group_key, td.name
       FROM project_tags pt
       JOIN project_tag_definitions td ON td.id = pt.tag_id
      WHERE pt.project_id = ANY($1::text[])
      ORDER BY td.group_key, td.sort_order, td.name`,
    [projectIds]
  );

  const collabByProject = new Map();
  for (const c of collabRows) {
    if (!collabByProject.has(c.project_id)) collabByProject.set(c.project_id, []);
    collabByProject.get(c.project_id).push({
      id: c.id,
      full_name: c.full_name,
      email: c.email,
    });
  }
  const typesByProject = new Map();
  for (const row of typeRows) {
    if (!typesByProject.has(row.project_id)) typesByProject.set(row.project_id, []);
    typesByProject.get(row.project_id).push(row.type);
  }
  const tagsByProject = new Map();
  for (const t of tagRows) {
    if (!tagsByProject.has(t.project_id)) tagsByProject.set(t.project_id, []);
    tagsByProject.get(t.project_id).push({
      id: t.id,
      group_key: t.group_key,
      name: t.name,
    });
  }

  return rows.map((p) =>
    iso({
      ...p,
      owner_name: p.owner_name || null,
      owner_email: p.owner_email || null,
      business_unit_name: p.business_unit_name || null,
      collaborators: collabByProject.get(p.id) || [],
      component_types: typesByProject.get(p.id) || [],
      tags: tagsByProject.get(p.id) || [],
    })
  );
}

async function getAllProjectsSummary() {
  const { rows } = await query("SELECT id, name, service_user, owner_id FROM projects");
  return rows;
}

async function clearProjectServiceUserByName(serviceUserName) {
  await query("UPDATE projects SET service_user = NULL WHERE service_user = $1", [serviceUserName]);
}

async function assignProjectServiceUser(projectId, serviceUserName) {
  return updateProject(projectId, { service_user: serviceUserName });
}

async function unassignProjectServiceUser(projectId) {
  return updateProject(projectId, { service_user: null });
}

// --- Components ---

async function getComponents(ownerId) {
  const { rows } = await query(
    `SELECT c.*,
            i.modified_at_src AS modified_at
       FROM components c
       LEFT JOIN inventory_items i ON i.id = c.source_inventory_id
      WHERE c.owner_id = $1
      ORDER BY c.created_at DESC`,
    [ownerId]
  );
  return isoRows(rows);
}

// Tenant-wide component list for admins (includes owner profile + assignment flag).
async function getAdminComponents(tenantId) {
  const { rows } = await query(
    `SELECT c.*,
            p.full_name AS owner_name,
            p.email AS owner_email,
            EXISTS (
              SELECT 1 FROM project_components pc WHERE pc.component_id = c.id
            ) AS is_assigned
       FROM components c
       LEFT JOIN profiles p ON p.id = c.owner_id
      WHERE c.tenant_id = $1
      ORDER BY c.name ASC, c.created_at DESC`,
    [tenantId]
  );
  return isoRows(rows);
}

/**
 * Admin click-through: component + linked inventory slim details + project.
 */
async function getAdminComponentDetail(tenantId, componentId) {
  const { extractComponentInventoryDetails } = require("./inventory/componentDetails");
  const { buildUrlFromInventoryItem } = require("./inventoryUrls");

  const { rows } = await query(
    `SELECT c.*,
            p.full_name AS owner_name,
            p.email AS owner_email,
            proj.id AS project_id,
            proj.name AS project_name,
            i.id AS inventory_id,
            i.resource_id AS inventory_resource_id,
            i.kind AS inventory_kind,
            i.environment_id AS inventory_environment_id,
            i.scope_type AS inventory_scope_type,
            i.scope_id AS inventory_scope_id,
            i.owner_external AS inventory_owner_external,
            i.owner_aad_id AS inventory_owner_aad_id,
            i.created_at_src AS inventory_created_at_src,
            i.modified_at_src AS inventory_modified_at_src,
            i.raw AS inventory_raw,
            e.display_name AS environment_name,
            e.environment_type AS environment_type,
            ws_inv.display_name AS workspace_name,
            ws_inv.raw AS workspace_raw
       FROM components c
       LEFT JOIN profiles p ON p.id = c.owner_id
       LEFT JOIN project_components pc ON pc.component_id = c.id
       LEFT JOIN projects proj ON proj.id = pc.project_id
       LEFT JOIN inventory_items i ON i.id = c.source_inventory_id
       LEFT JOIN environments e
         ON e.tenant_id = c.tenant_id
        AND i.environment_id IS NOT NULL
        AND ${ENV_KEY("e.environment_id")} = ${ENV_KEY("i.environment_id")}
       LEFT JOIN inventory_items ws_inv
         ON ws_inv.tenant_id = c.tenant_id
        AND ws_inv.kind = 'powerbi_workspace'
        AND i.scope_type = 'workspace'
        AND i.scope_id IS NOT NULL
        AND lower(ws_inv.resource_id) = lower(i.scope_id)
      WHERE c.tenant_id = $1 AND c.id = $2
      LIMIT 1`,
    [tenantId, componentId]
  );
  if (!rows.length) {
    const err = new Error("Component not found");
    err.statusCode = 404;
    throw err;
  }

  const row = iso(rows[0]);
  const kind = row.inventory_kind || row.type;
  let inventory_details = null;
  let open_url = row.url || null;

  if (row.inventory_id) {
    inventory_details = extractComponentInventoryDetails(kind, row.inventory_raw, {
      owner_external: row.inventory_owner_external,
      owner_aad_id: row.inventory_owner_aad_id,
      created_at_src: row.inventory_created_at_src,
      modified_at_src: row.inventory_modified_at_src,
      environment_type: row.environment_type,
      scope_id: row.inventory_scope_id,
      workspace_name: row.workspace_name,
      workspace_raw: row.workspace_raw,
    });

    if (!open_url) {
      open_url =
        buildUrlFromInventoryItem({
          kind,
          resource_id: row.inventory_resource_id,
          environment_id: row.inventory_environment_id,
          scope_id: row.inventory_scope_id,
          display_name: row.name,
          raw: row.inventory_raw,
        }) || null;
    }
  }

  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: row.name,
    type: row.type,
    status: row.status,
    environments: row.environments,
    url: row.url,
    open_url,
    owner_id: row.owner_id,
    owner_name: row.owner_name,
    owner_email: row.owner_email,
    source_inventory_id: row.source_inventory_id,
    is_assigned: Boolean(row.project_id),
    project_id: row.project_id || null,
    project_name: row.project_name || null,
    environment_name: row.environment_name || null,
    environment_type: row.environment_type || null,
    inventory_details,
  };
}

async function getComponentsByIds(ids) {
  if (ids.length === 0) return [];
  const { rows } = await query("SELECT * FROM components WHERE id = ANY($1)", [ids]);
  return isoRows(rows);
}

async function insertComponents(rows) {
  const inserted = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const id = `c-${Date.now()}-${i}`;
    await query(
      `INSERT INTO components (id, tenant_id, name, type, environments, owner_id, status, url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, r.tenant_id, r.name, r.type, r.environments, r.owner_id, r.status, r.url]
    );
    inserted.push(
      iso({
        id,
        tenant_id: r.tenant_id,
        name: r.name,
        type: r.type,
        environments: r.environments,
        owner_id: r.owner_id,
        created_at: new Date(),
        status: r.status,
        url: r.url,
      })
    );
  }
  return inserted;
}

async function getAssignedComponentIds() {
  const { rows } = await query("SELECT component_id FROM project_components");
  return rows.map((r) => r.component_id);
}

async function getMyComponentIds(ownerId) {
  const { rows } = await query("SELECT id FROM components WHERE owner_id = $1", [ownerId]);
  return rows.map((r) => r.id);
}

async function deleteComponents(ids) {
  await query("DELETE FROM components WHERE id = ANY($1)", [ids]);
}

async function archiveComponent(id) {
  const { rowCount } = await query("UPDATE components SET status = 'archived' WHERE id = $1", [id]);
  return rowCount > 0;
}

// --- Project components ---

async function getProjectComponentIds(projectId) {
  const { rows } = await query(
    "SELECT component_id FROM project_components WHERE project_id = $1",
    [projectId]
  );
  return rows.map((r) => r.component_id);
}

async function getAllProjectComponents() {
  const { rows } = await query("SELECT project_id, component_id FROM project_components");
  return rows;
}

async function addProjectComponents(rows) {
  for (const row of rows) {
    await query("DELETE FROM project_components WHERE component_id = $1", [row.component_id]);
    await query(
      "INSERT INTO project_components (project_id, component_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [row.project_id, row.component_id]
    );
    await query("UPDATE components SET status = 'assigned' WHERE id = $1", [row.component_id]);
  }
}

async function removeProjectComponent(projectId, componentId) {
  const { rowCount } = await query(
    "DELETE FROM project_components WHERE project_id = $1 AND component_id = $2",
    [projectId, componentId]
  );
  if (rowCount === 0) return false;
  const { rows } = await query(
    "SELECT 1 FROM project_components WHERE component_id = $1 LIMIT 1",
    [componentId]
  );
  if (rows.length === 0) {
    await query(
      "UPDATE components SET status = 'unassigned' WHERE id = $1 AND status = 'assigned'",
      [componentId]
    );
  }
  return true;
}

// --- Project collaborators ---

async function getMyCollaboratorProjectIds(userId) {
  const { rows } = await query(
    "SELECT project_id FROM project_collaborators WHERE user_id = $1",
    [userId]
  );
  return rows.map((r) => r.project_id);
}

async function getProjectCollaboratorUserIds(projectId) {
  const { rows } = await query(
    "SELECT user_id FROM project_collaborators WHERE project_id = $1",
    [projectId]
  );
  return rows.map((r) => r.user_id);
}

async function addProjectCollaborator(projectId, userId) {
  await query(
    "INSERT INTO project_collaborators (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [projectId, userId]
  );
}

async function addProjectCollaborators(rows) {
  for (const row of rows) {
    await addProjectCollaborator(row.project_id, row.user_id);
  }
}

async function removeProjectCollaborator(projectId, userId) {
  await query(
    "DELETE FROM project_collaborators WHERE project_id = $1 AND user_id = $2",
    [projectId, userId]
  );
}

// --- Profiles ---

async function getProfile(userId) {
  const { rows } = await query("SELECT * FROM profiles WHERE id = $1", [userId]);
  return rows[0] ? iso(rows[0]) : null;
}

async function getProfilesByIds(ids) {
  if (ids.length === 0) return [];
  const { rows } = await query("SELECT id, full_name, email FROM profiles WHERE id = ANY($1)", [ids]);
  return rows;
}

async function getTenantProfiles(tenantId, excludeUserId) {
  const { rows } = await query(
    "SELECT id, full_name, email FROM profiles WHERE tenant_id = $1 AND id != $2 ORDER BY full_name",
    [tenantId, excludeUserId]
  );
  return rows;
}

async function getAllProfiles() {
  const { rows } = await query("SELECT id, full_name, email FROM profiles");
  return rows;
}

async function getUserRoles(userId) {
  const { rows } = await query("SELECT role FROM user_roles WHERE user_id = $1", [userId]);
  return rows.map((r) => ({ role: r.role }));
}

async function getAdminUsers() {
  const { rows: profiles } = await query("SELECT * FROM profiles");
  const { rows: projects } = await query("SELECT * FROM projects");
  const { rows: components } = await query("SELECT * FROM components");
  const { rows: projectComponents } = await query("SELECT component_id FROM project_components");
  const { rows: collaborators } = await query("SELECT project_id, user_id FROM project_collaborators");
  const { rows: userRoles } = await query("SELECT user_id, role FROM user_roles");

  const assignedComponentIds = new Set(projectComponents.map((pc) => pc.component_id));
  const rolesMap = new Map(userRoles.map((r) => [r.user_id, r.role]));
  const projectsById = new Map(projects.map((pr) => [pr.id, pr]));
  const collabByUser = new Map();
  for (const c of collaborators) {
    if (!collabByUser.has(c.user_id)) collabByUser.set(c.user_id, []);
    collabByUser.get(c.user_id).push(c.project_id);
  }

  return profiles.map((p) => {
    const owned = projects
      .filter((pr) => pr.owner_id === p.id)
      .map((pr) => ({
        id: pr.id,
        name: pr.name,
        service_user: pr.service_user,
        status: pr.status,
        membership: "owner",
      }));
    const collabIds = new Set(owned.map((pr) => pr.id));
    const collab = (collabByUser.get(p.id) || [])
      .map((projectId) => projectsById.get(projectId))
      .filter((pr) => pr && !collabIds.has(pr.id))
      .map((pr) => ({
        id: pr.id,
        name: pr.name,
        service_user: pr.service_user,
        status: pr.status,
        membership: "collaborator",
      }));
    const userProjects = [...owned, ...collab].sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    return {
      id: p.id,
      full_name: p.full_name,
      email: p.email,
      role: rolesMap.get(p.id) ?? "user",
      projects: userProjects,
      unmanagedComponents: components.filter(
        (c) => c.owner_id === p.id && !assignedComponentIds.has(c.id) && c.status !== "archived"
      ).length,
      archivedComponents: components.filter(
        (c) => c.owner_id === p.id && c.status === "archived"
      ).length,
    };
  });
}

async function updateUserRole(userId, role) {
  await query(
    `INSERT INTO user_roles (id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, role) DO UPDATE SET role = EXCLUDED.role`,
    [`ur-${userId}-${role}`, userId, role]
  );
}

async function upsertProfile({ id, tenant_id, full_name, email }) {
  const { rows } = await query(
    `INSERT INTO profiles (id, tenant_id, full_name, email)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email
     RETURNING *`,
    [id, tenant_id, full_name, email]
  );
  return iso(rows[0]);
}

async function ensureUserRole(userId, role = "user") {
  await query(
    `INSERT INTO user_roles (id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [`ur-${userId}-${role}`, userId, role]
  );
}

async function resolveTenantByEmail(email) {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  const { rows } = await query(
    "SELECT tenant_id FROM tenant_email_domains WHERE LOWER(domain) = $1 LIMIT 1",
    [domain]
  );
  return rows[0]?.tenant_id ?? null;
}

// --- Tenants ---

async function getTenant(tenantId) {
  const { rows } = await query(
    `SELECT id, name, tool_name, created_at, logo_bytes, logo_content_type
       FROM tenants WHERE id = $1`,
    [tenantId]
  );
  return rows[0] ? iso(rows[0]) : null;
}

async function updateTenant(tenantId, fields) {
  const patch = typeof fields === "string" ? { name: fields } : fields || {};
  const sets = [];
  const values = [];
  let i = 1;
  if (patch.name != null) {
    sets.push(`name = $${i++}`);
    values.push(patch.name);
  }
  if (patch.tool_name != null) {
    sets.push(`tool_name = $${i++}`);
    values.push(patch.tool_name);
  }
  if (sets.length === 0) return;
  values.push(tenantId);
  await query(`UPDATE tenants SET ${sets.join(", ")} WHERE id = $${i}`, values);
}

async function getTenantLogo(tenantId) {
  const { rows } = await query(
    `SELECT logo_bytes, logo_content_type FROM tenants WHERE id = $1`,
    [tenantId]
  );
  const row = rows[0];
  if (!row?.logo_bytes) return null;
  return {
    bytes: row.logo_bytes,
    contentType: row.logo_content_type || "application/octet-stream",
  };
}

async function setTenantLogo(tenantId, bytes, contentType) {
  const { rowCount } = await query(
    `UPDATE tenants SET logo_bytes = $1, logo_content_type = $2 WHERE id = $3`,
    [bytes, contentType, tenantId]
  );
  return rowCount > 0;
}

async function clearTenantLogo(tenantId) {
  const { rowCount } = await query(
    `UPDATE tenants SET logo_bytes = NULL, logo_content_type = NULL WHERE id = $1`,
    [tenantId]
  );
  return rowCount > 0;
}

async function getTenantEmailDomains(tenantId) {
  const { rows } = await query(
    "SELECT * FROM tenant_email_domains WHERE tenant_id = $1 ORDER BY created_at",
    [tenantId]
  );
  return isoRows(rows);
}

async function addTenantEmailDomain(tenantId, domain) {
  await query(
    "INSERT INTO tenant_email_domains (id, tenant_id, domain) VALUES ($1, $2, $3)",
    [`d-${Date.now()}`, tenantId, domain]
  );
}

async function deleteTenantEmailDomain(id) {
  await query("DELETE FROM tenant_email_domains WHERE id = $1", [id]);
}

// --- Business units ---

async function listBusinessUnits(tenantId, { activeOnly = false } = {}) {
  const clauses = ["tenant_id = $1"];
  const values = [tenantId];
  if (activeOnly) clauses.push("is_active = true");
  const { rows } = await query(
    `SELECT id, tenant_id, name, sort_order, is_active, created_at
       FROM business_units
      WHERE ${clauses.join(" AND ")}
      ORDER BY sort_order ASC, name ASC`,
    values
  );
  return isoRows(rows);
}

async function getBusinessUnit(tenantId, id) {
  const { rows } = await query(
    `SELECT id, tenant_id, name, sort_order, is_active, created_at
       FROM business_units WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  );
  return rows[0] ? iso(rows[0]) : null;
}

async function createBusinessUnit(tenantId, { name, sort_order }) {
  const { rows } = await query(
    `INSERT INTO business_units (id, tenant_id, name, sort_order, is_active)
     VALUES ($1, $2, $3, $4, true)
     RETURNING id, tenant_id, name, sort_order, is_active, created_at`,
    [`bu-${Date.now()}`, tenantId, name.trim(), sort_order ?? 0]
  );
  return iso(rows[0]);
}

async function updateBusinessUnit(tenantId, id, patch) {
  const sets = [];
  const values = [];
  let i = 1;
  if (patch.name != null) {
    sets.push(`name = $${i++}`);
    values.push(String(patch.name).trim());
  }
  if (patch.sort_order != null) {
    sets.push(`sort_order = $${i++}`);
    values.push(Number(patch.sort_order));
  }
  if (patch.is_active != null) {
    sets.push(`is_active = $${i++}`);
    values.push(Boolean(patch.is_active));
  }
  if (sets.length === 0) return getBusinessUnit(tenantId, id);
  values.push(tenantId, id);
  const { rows } = await query(
    `UPDATE business_units SET ${sets.join(", ")}
      WHERE tenant_id = $${i++} AND id = $${i}
     RETURNING id, tenant_id, name, sort_order, is_active, created_at`,
    values
  );
  return rows[0] ? iso(rows[0]) : null;
}

async function deactivateBusinessUnit(tenantId, id) {
  return updateBusinessUnit(tenantId, id, { is_active: false });
}

// --- Compliance questions ---

async function listComplianceQuestions(tenantId, { activeOnly = false } = {}) {
  const clauses = ["tenant_id = $1"];
  const values = [tenantId];
  if (activeOnly) clauses.push("is_active = true");
  const { rows } = await query(
    `SELECT id, tenant_id, prompt, answer_type, options, required, sort_order, is_active, created_at
       FROM compliance_questions
      WHERE ${clauses.join(" AND ")}
      ORDER BY sort_order ASC, created_at ASC`,
    values
  );
  return isoRows(rows);
}

async function getComplianceQuestion(tenantId, id) {
  const { rows } = await query(
    `SELECT id, tenant_id, prompt, answer_type, options, required, sort_order, is_active, created_at
       FROM compliance_questions WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  );
  return rows[0] ? iso(rows[0]) : null;
}

async function createComplianceQuestion(tenantId, input) {
  const answerType = input.answer_type === "select" ? "select" : "text";
  const options = answerType === "select" ? input.options || [] : [];
  const { rows } = await query(
    `INSERT INTO compliance_questions
       (id, tenant_id, prompt, answer_type, options, required, sort_order, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true)
     RETURNING id, tenant_id, prompt, answer_type, options, required, sort_order, is_active, created_at`,
    [
      `cq-${Date.now()}`,
      tenantId,
      String(input.prompt || "").trim(),
      answerType,
      options,
      input.required !== false,
      input.sort_order ?? 0,
    ]
  );
  return iso(rows[0]);
}

async function updateComplianceQuestion(tenantId, id, patch) {
  const sets = [];
  const values = [];
  let i = 1;
  if (patch.prompt != null) {
    sets.push(`prompt = $${i++}`);
    values.push(String(patch.prompt).trim());
  }
  if (patch.answer_type != null) {
    sets.push(`answer_type = $${i++}`);
    values.push(patch.answer_type === "select" ? "select" : "text");
  }
  if (patch.options != null) {
    sets.push(`options = $${i++}`);
    values.push(Array.isArray(patch.options) ? patch.options : []);
  }
  if (patch.required != null) {
    sets.push(`required = $${i++}`);
    values.push(Boolean(patch.required));
  }
  if (patch.sort_order != null) {
    sets.push(`sort_order = $${i++}`);
    values.push(Number(patch.sort_order));
  }
  if (patch.is_active != null) {
    sets.push(`is_active = $${i++}`);
    values.push(Boolean(patch.is_active));
  }
  if (sets.length === 0) return getComplianceQuestion(tenantId, id);
  values.push(tenantId, id);
  const { rows } = await query(
    `UPDATE compliance_questions SET ${sets.join(", ")}
      WHERE tenant_id = $${i++} AND id = $${i}
     RETURNING id, tenant_id, prompt, answer_type, options, required, sort_order, is_active, created_at`,
    values
  );
  return rows[0] ? iso(rows[0]) : null;
}

async function deactivateComplianceQuestion(tenantId, id) {
  return updateComplianceQuestion(tenantId, id, { is_active: false });
}

// --- Project tags (Discovery) ---

async function listProjectTagDefinitions(tenantId, { activeOnly = false } = {}) {
  const clauses = ["tenant_id = $1"];
  const values = [tenantId];
  if (activeOnly) clauses.push("is_active = true");
  const { rows } = await query(
    `SELECT id, tenant_id, group_key, name, sort_order, is_active, created_at
       FROM project_tag_definitions
      WHERE ${clauses.join(" AND ")}
      ORDER BY group_key ASC, sort_order ASC, name ASC`,
    values
  );
  return isoRows(rows);
}

async function getProjectTagDefinition(tenantId, id) {
  const { rows } = await query(
    `SELECT id, tenant_id, group_key, name, sort_order, is_active, created_at
       FROM project_tag_definitions WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  );
  return rows[0] ? iso(rows[0]) : null;
}

async function createProjectTagDefinition(tenantId, input) {
  const groupKey = input.group_key === "capability" ? "capability" : "domain";
  const { rows } = await query(
    `INSERT INTO project_tag_definitions (id, tenant_id, group_key, name, sort_order, is_active)
     VALUES ($1, $2, $3, $4, $5, true)
     RETURNING id, tenant_id, group_key, name, sort_order, is_active, created_at`,
    [`tag-${Date.now()}`, tenantId, groupKey, String(input.name || "").trim(), input.sort_order ?? 0]
  );
  return iso(rows[0]);
}

async function updateProjectTagDefinition(tenantId, id, patch) {
  const sets = [];
  const values = [];
  let i = 1;
  if (patch.name != null) {
    sets.push(`name = $${i++}`);
    values.push(String(patch.name).trim());
  }
  if (patch.group_key != null) {
    sets.push(`group_key = $${i++}`);
    values.push(patch.group_key === "capability" ? "capability" : "domain");
  }
  if (patch.sort_order != null) {
    sets.push(`sort_order = $${i++}`);
    values.push(Number(patch.sort_order));
  }
  if (patch.is_active != null) {
    sets.push(`is_active = $${i++}`);
    values.push(Boolean(patch.is_active));
  }
  if (sets.length === 0) return getProjectTagDefinition(tenantId, id);
  values.push(tenantId, id);
  const { rows } = await query(
    `UPDATE project_tag_definitions SET ${sets.join(", ")}
      WHERE tenant_id = $${i++} AND id = $${i}
     RETURNING id, tenant_id, group_key, name, sort_order, is_active, created_at`,
    values
  );
  return rows[0] ? iso(rows[0]) : null;
}

async function deactivateProjectTagDefinition(tenantId, id) {
  return updateProjectTagDefinition(tenantId, id, { is_active: false });
}

async function getProjectTagIds(projectId) {
  const { rows } = await query(
    "SELECT tag_id FROM project_tags WHERE project_id = $1",
    [projectId]
  );
  return rows.map((r) => r.tag_id);
}

async function setProjectTags(projectId, tagIds) {
  const ids = [...new Set((tagIds || []).map(String).filter(Boolean))];
  await query("DELETE FROM project_tags WHERE project_id = $1", [projectId]);
  for (const tagId of ids) {
    await query(
      "INSERT INTO project_tags (project_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [projectId, tagId]
    );
  }
}

async function listDiscoveryProjects(tenantId, { q, domain, capability, business_unit_id } = {}) {
  const clauses = ["p.tenant_id = $1", "p.status <> 'draft'"];
  const values = [tenantId];
  let i = 2;

  if (q && String(q).trim()) {
    clauses.push(`(p.name ILIKE $${i} OR p.description ILIKE $${i})`);
    values.push(`%${String(q).trim()}%`);
    i++;
  }
  if (business_unit_id) {
    clauses.push(`p.business_unit_id = $${i++}`);
    values.push(String(business_unit_id));
  }
  if (domain) {
    clauses.push(`EXISTS (
      SELECT 1 FROM project_tags pt
      JOIN project_tag_definitions td ON td.id = pt.tag_id
      WHERE pt.project_id = p.id AND td.group_key = 'domain' AND td.id = $${i}
    )`);
    values.push(String(domain));
    i++;
  }
  if (capability) {
    clauses.push(`EXISTS (
      SELECT 1 FROM project_tags pt
      JOIN project_tag_definitions td ON td.id = pt.tag_id
      WHERE pt.project_id = p.id AND td.group_key = 'capability' AND td.id = $${i}
    )`);
    values.push(String(capability));
    i++;
  }

  const { rows: projects } = await query(
    `SELECT p.id, p.tenant_id, p.name, p.description, p.owner_id, p.status, p.created_at,
            p.business_unit_id,
            bu.name AS business_unit_name,
            own.full_name AS owner_name, own.email AS owner_email
       FROM projects p
       LEFT JOIN business_units bu ON bu.id = p.business_unit_id
       LEFT JOIN profiles own ON own.id = p.owner_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY p.created_at DESC`,
    values
  );

  if (projects.length === 0) return [];

  const projectIds = projects.map((p) => p.id);
  const { rows: tagRows } = await query(
    `SELECT pt.project_id, td.id, td.group_key, td.name
       FROM project_tags pt
       JOIN project_tag_definitions td ON td.id = pt.tag_id
      WHERE pt.project_id = ANY($1::text[])
      ORDER BY td.group_key, td.sort_order, td.name`,
    [projectIds]
  );
  const { rows: collabRows } = await query(
    `SELECT pc.project_id, pr.id, pr.full_name
       FROM project_collaborators pc
       JOIN profiles pr ON pr.id = pc.user_id
      WHERE pc.project_id = ANY($1::text[])
      ORDER BY pr.full_name`,
    [projectIds]
  );
  const { rows: typeRows } = await query(
    `SELECT DISTINCT pc.project_id, c.type
       FROM project_components pc
       JOIN components c ON c.id = pc.component_id
      WHERE pc.project_id = ANY($1::text[])
        AND c.status <> 'archived'
      ORDER BY c.type`,
    [projectIds]
  );

  const tagsByProject = new Map();
  for (const t of tagRows) {
    if (!tagsByProject.has(t.project_id)) tagsByProject.set(t.project_id, []);
    tagsByProject.get(t.project_id).push({
      id: t.id,
      group_key: t.group_key,
      name: t.name,
    });
  }
  const collabByProject = new Map();
  for (const c of collabRows) {
    if (!collabByProject.has(c.project_id)) collabByProject.set(c.project_id, []);
    collabByProject.get(c.project_id).push({ id: c.id, full_name: c.full_name });
  }
  const typesByProject = new Map();
  for (const row of typeRows) {
    if (!typesByProject.has(row.project_id)) typesByProject.set(row.project_id, []);
    typesByProject.get(row.project_id).push(row.type);
  }

  return projects.map((p) =>
    iso({
      id: p.id,
      tenant_id: p.tenant_id,
      name: p.name,
      description: p.description,
      status: p.status,
      created_at: p.created_at,
      business_unit_id: p.business_unit_id,
      business_unit_name: p.business_unit_name,
      owner: p.owner_id
        ? { id: p.owner_id, full_name: p.owner_name, email: p.owner_email }
        : null,
      collaborators: collabByProject.get(p.id) || [],
      tags: tagsByProject.get(p.id) || [],
      component_types: typesByProject.get(p.id) || [],
    })
  );
}

// --- Service users ---

async function getServiceUsersWithDetails() {
  const { rows: serviceUsers } = await query(
    "SELECT id, name, assigned_to FROM service_users ORDER BY name"
  );
  const { rows: projects } = await query("SELECT id, name, service_user, owner_id FROM projects");
  const { rows: profiles } = await query("SELECT id, full_name, email FROM profiles");
  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  return serviceUsers.map((su) => ({
    id: su.id,
    name: su.name,
    assigned_to: su.assigned_to,
    assigned_user: su.assigned_to ? profileMap.get(su.assigned_to) ?? null : null,
    projects: projects
      .filter((p) => p.service_user === su.name)
      .map((p) => ({
        id: p.id,
        name: p.name,
        owner_name: p.owner_id ? profileMap.get(p.owner_id)?.full_name ?? "–" : "–",
      })),
  }));
}

async function createServiceUser(name, tenantId, assignedTo) {
  await query(
    "INSERT INTO service_users (id, name, tenant_id, assigned_to) VALUES ($1, $2, $3, $4)",
    [`su-${Date.now()}`, name, tenantId, assignedTo]
  );
}

async function deleteServiceUser(id, name) {
  await clearProjectServiceUserByName(name);
  await query("DELETE FROM service_users WHERE id = $1", [id]);
}

async function updateServiceUserAssignment(serviceUserId, userId) {
  await query("UPDATE service_users SET assigned_to = $1 WHERE id = $2", [userId, serviceUserId]);
}

// --- Job runs ---

async function createJobRun({ tenant_id, job_type, trigger, requested_by = null, params = {} }) {
  // The uq_job_runs_active partial index throws 23505 if a run of this
  // (tenant, job_type) is already 'running' — the runner maps that to 409.
  const { rows } = await query(
    `INSERT INTO job_runs (tenant_id, job_type, trigger, status, requested_by, params)
     VALUES ($1, $2, $3, 'running', $4, $5)
     RETURNING *`,
    [tenant_id, job_type, trigger, requested_by, JSON.stringify(params ?? {})]
  );
  return iso(rows[0]);
}

async function updateJobRun(id, updates) {
  const fields = [];
  const values = [];
  let i = 1;
  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = $${i++}`);
    values.push(key === "stats" || key === "params" ? JSON.stringify(value) : value);
  }
  if (fields.length === 0) return;
  values.push(id);
  await query(`UPDATE job_runs SET ${fields.join(", ")} WHERE id = $${i}`, values);
}

async function getJobRun(id) {
  const { rows } = await query("SELECT * FROM job_runs WHERE id = $1", [id]);
  return rows[0] ? iso(rows[0]) : null;
}

async function listJobRuns({ tenant_id, job_type, status, limit = 50 }) {
  const clauses = ["tenant_id = $1"];
  const values = [tenant_id];
  let i = 2;
  if (job_type) {
    clauses.push(`job_type = $${i++}`);
    values.push(job_type);
  }
  if (status) {
    clauses.push(`status = $${i++}`);
    values.push(status);
  }
  values.push(limit);
  const { rows } = await query(
    `SELECT * FROM job_runs WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT $${i}`,
    values
  );
  return isoRows(rows);
}

async function reapStaleJobRuns(timeoutMs) {
  const { rowCount } = await query(
    `UPDATE job_runs
       SET status = 'failed', error = 'Timed out / interrupted', finished_at = now()
     WHERE status = 'running'
       AND started_at < now() - ($1::bigint * interval '1 millisecond')`,
    [timeoutMs]
  );
  return rowCount;
}

// --- Inventory items ---

async function upsertInventoryItems(tenantId, items, syncedAt) {
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
    await query(
      `INSERT INTO inventory_items
        (tenant_id, resource_id, resource_type, kind, display_name, environment_id,
         scope_type, scope_id, location, owner_external, owner_aad_id, created_at_src,
         modified_at_src, raw, last_synced_at, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, true)
       ON CONFLICT (tenant_id, resource_type, resource_id) DO UPDATE SET
         kind = EXCLUDED.kind,
         display_name = EXCLUDED.display_name,
         environment_id = EXCLUDED.environment_id,
         scope_type = EXCLUDED.scope_type,
         scope_id = EXCLUDED.scope_id,
         location = EXCLUDED.location,
         owner_external = COALESCE(EXCLUDED.owner_external, inventory_items.owner_external),
         owner_aad_id = COALESCE(EXCLUDED.owner_aad_id, inventory_items.owner_aad_id),
         created_at_src = EXCLUDED.created_at_src,
         modified_at_src = EXCLUDED.modified_at_src,
         raw = EXCLUDED.raw,
         last_synced_at = EXCLUDED.last_synced_at,
         is_active = true`,
      [
        tenantId,
        resourceId,
        it.resource_type,
        it.kind,
        it.display_name ?? null,
        environmentId,
        scopeType,
        scopeId,
        it.location ?? null,
        it.owner_external ?? null,
        it.owner_aad_id ?? null,
        it.created_at_src ?? null,
        it.modified_at_src ?? null,
        JSON.stringify(it.raw ?? {}),
        syncedAt,
      ]
    );
    count++;
  }
  return count;
}

// Soft-delete: anything of the synced types not seen in this run (older
// last_synced_at) is marked inactive, preserving history and component links.
async function deactivateStaleInventory(tenantId, syncedAt, resourceTypes) {
  const { rowCount } = await query(
    `UPDATE inventory_items SET is_active = false
     WHERE tenant_id = $1 AND is_active = true AND last_synced_at < $2
       AND resource_type = ANY($3)`,
    [tenantId, syncedAt, resourceTypes]
  );
  return rowCount;
}

async function getInventoryItems({ tenant_id, kind, activeOnly = true, limit = 500 }) {
  const clauses = ["tenant_id = $1"];
  const values = [tenant_id];
  let i = 2;
  if (activeOnly) clauses.push("is_active = true");
  if (kind) {
    clauses.push(`kind = $${i++}`);
    values.push(kind);
  }
  values.push(limit);
  const { rows } = await query(
    `SELECT * FROM inventory_items WHERE ${clauses.join(" AND ")} ORDER BY kind, display_name LIMIT $${i}`,
    values
  );
  return isoRows(rows);
}

async function getInventoryItem(tenantId, id) {
  const { rows } = await query(
    `SELECT * FROM inventory_items WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  );
  return iso(rows[0] || null);
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

async function getComponentImportSettings(tenantId) {
  const { rows } = await query(
    `SELECT tenant_id, kinds, environment_ids, workspace_ids, updated_at, updated_by
       FROM component_import_settings WHERE tenant_id = $1`,
    [tenantId]
  );
  if (!rows[0]) {
    return {
      tenant_id: tenantId,
      kinds: [],
      environment_ids: [],
      workspace_ids: [],
      updated_at: null,
      updated_by: null,
    };
  }
  return iso(rows[0]);
}

async function upsertComponentImportSettings(
  tenantId,
  { kinds, environment_ids, workspace_ids, updated_by }
) {
  const { rows } = await query(
    `INSERT INTO component_import_settings
       (tenant_id, kinds, environment_ids, workspace_ids, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (tenant_id) DO UPDATE SET
       kinds = EXCLUDED.kinds,
       environment_ids = EXCLUDED.environment_ids,
       workspace_ids = EXCLUDED.workspace_ids,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()
     RETURNING tenant_id, kinds, environment_ids, workspace_ids, updated_at, updated_by`,
    [
      tenantId,
      kinds || [],
      (environment_ids || []).map((id) => canonicalizeEnvironmentId(id)),
      workspace_ids || [],
      updated_by ?? null,
    ]
  );
  return iso(rows[0]);
}

async function listEnvironments(tenantId, { activeOnly = true } = {}) {
  const clauses = ["tenant_id = $1"];
  const values = [tenantId];
  if (activeOnly) clauses.push("is_active = true");
  const { rows } = await query(
    `SELECT id, tenant_id, environment_id, display_name, environment_type, region,
            is_managed, is_active, source_inventory_id, last_synced_at
       FROM environments
      WHERE ${clauses.join(" AND ")}
      ORDER BY display_name NULLS LAST, environment_id`,
    values
  );
  return isoRows(rows);
}

/** Upsert curated environments from inventory_items seen in this sync; soft-deactivate the rest. */
async function syncEnvironmentsFromInventory(tenantId, syncedAt) {
  const { rows: items } = await query(
    `SELECT id, resource_id, display_name, location, raw
       FROM inventory_items
      WHERE tenant_id = $1
        AND kind = 'environment'
        AND resource_type LIKE 'microsoft.%'
        AND is_active = true
        AND last_synced_at >= $2::timestamptz`,
    [tenantId, syncedAt]
  );

  let upserted = 0;
  for (const it of items) {
    const raw = typeof it.raw === "string" ? JSON.parse(it.raw || "{}") : it.raw || {};
    const props = raw.properties || {};
    const isManaged =
      typeof props.isManaged === "boolean"
        ? props.isManaged
        : props.isManaged == null
          ? null
          : String(props.isManaged).toLowerCase() === "true";
    const values = [
      tenantId,
      canonicalizeEnvironmentId(it.resource_id),
      it.display_name ?? props.displayName ?? null,
      props.environmentType ?? null,
      it.location ?? null,
      isManaged,
      it.id,
      syncedAt,
    ];
    // Match on the guid so a row stored under another spelling is updated, not duplicated.
    const { rowCount } = await query(
      `UPDATE environments
          SET environment_id = $2,
              display_name = $3,
              environment_type = $4,
              region = $5,
              is_managed = $6,
              is_active = true,
              source_inventory_id = $7,
              last_synced_at = $8
        WHERE tenant_id = $1
          AND ${ENV_KEY("environment_id")} = ${ENV_KEY("$2")}`,
      values
    );
    if (!rowCount) {
      await query(
        `INSERT INTO environments
           (tenant_id, environment_id, display_name, environment_type, region, is_managed,
            is_active, source_inventory_id, last_synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)`,
        values
      );
    }
    upserted++;
  }

  const { rowCount: deactivated } = await query(
    `UPDATE environments SET is_active = false
      WHERE tenant_id = $1 AND is_active = true AND last_synced_at < $2::timestamptz`,
    [tenantId, syncedAt]
  );

  return { environments_upserted: upserted, environments_deactivated: deactivated || 0 };
}

async function listWorkspaces(tenantId, { activeOnly = true } = {}) {
  const clauses = ["tenant_id = $1"];
  const values = [tenantId];
  if (activeOnly) clauses.push("is_active = true");
  const { rows } = await query(
    `SELECT id, tenant_id, workspace_id, display_name, workspace_type, state,
            is_active, source_inventory_id, last_synced_at
       FROM workspaces
      WHERE ${clauses.join(" AND ")}
      ORDER BY display_name NULLS LAST, workspace_id`,
    values
  );
  return isoRows(rows);
}

/** Upsert curated workspaces from inventory_items seen in this sync; soft-deactivate the rest. */
async function syncWorkspacesFromInventory(tenantId, syncedAt) {
  const { rows: items } = await query(
    `SELECT id, resource_id, display_name, raw
       FROM inventory_items
      WHERE tenant_id = $1
        AND kind = 'powerbi_workspace'
        AND resource_type = 'powerbi/workspace'
        AND is_active = true
        AND last_synced_at >= $2::timestamptz`,
    [tenantId, syncedAt]
  );

  let upserted = 0;
  for (const it of items) {
    const raw = typeof it.raw === "string" ? JSON.parse(it.raw || "{}") : it.raw || {};
    await query(
      `INSERT INTO workspaces
         (tenant_id, workspace_id, display_name, workspace_type, state,
          is_active, source_inventory_id, last_synced_at)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7)
       ON CONFLICT (tenant_id, workspace_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         workspace_type = EXCLUDED.workspace_type,
         state = EXCLUDED.state,
         is_active = true,
         source_inventory_id = EXCLUDED.source_inventory_id,
         last_synced_at = EXCLUDED.last_synced_at`,
      [
        tenantId,
        it.resource_id,
        it.display_name ?? raw.name ?? null,
        raw.type ?? null,
        raw.state ?? null,
        it.id,
        syncedAt,
      ]
    );
    upserted++;
  }

  const { rowCount: deactivated } = await query(
    `UPDATE workspaces SET is_active = false
      WHERE tenant_id = $1 AND is_active = true AND last_synced_at < $2::timestamptz`,
    [tenantId, syncedAt]
  );

  return { workspaces_upserted: upserted, workspaces_deactivated: deactivated || 0 };
}

async function listInventoryEnvironments(tenantId) {
  // Back-compat shape for older clients; prefer listEnvironments.
  const rows = await listEnvironments(tenantId, { activeOnly: true });
  return rows.map((e) => ({
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

async function previewComponentImport(tenantId, { kinds, environmentIds, workspaceIds }) {
  const envIds = (environmentIds || []).map(environmentKey);
  const wsIds = (workspaceIds || []).map((id) => String(id).toLowerCase());
  if (!hasImportableScope({ kinds, environmentIds: environmentIds || [], workspaceIds: workspaceIds || [] })) {
    return { count: 0, by_kind: {} };
  }
  const { rows } = await query(
    `SELECT kind, count(*)::int AS cnt
       FROM inventory_items
      WHERE tenant_id = $1
        AND is_active = true
        AND kind = ANY($2::text[])
        AND (
          (resource_type LIKE 'microsoft.%' AND ${ENV_KEY("environment_id")} = ANY($3::text[]))
          OR
          (resource_type LIKE 'powerbi/%' AND lower(scope_id) = ANY($4::text[]))
        )
      GROUP BY kind
      ORDER BY kind`,
    [tenantId, kinds, envIds, wsIds]
  );
  const by_kind = {};
  let count = 0;
  for (const r of rows) {
    by_kind[r.kind] = r.cnt;
    count += r.cnt;
  }
  return { count, by_kind };
}

async function importComponentsFromInventory(tenantId, { kinds, environmentIds, workspaceIds }) {
  const selectedEnvIds = environmentIds || [];
  const selectedWsIds = workspaceIds || [];
  const envIds = selectedEnvIds.map(environmentKey);
  const wsIds = selectedWsIds.map((id) => String(id).toLowerCase());
  if (!hasImportableScope({ kinds, environmentIds: selectedEnvIds, workspaceIds: selectedWsIds })) {
    return { inserted: 0, updated: 0, archived: 0, unresolved_owner: 0, matched: 0 };
  }

  const { rows: envs } = await query(
    `SELECT environment_id, display_name FROM environments WHERE tenant_id = $1`,
    [tenantId]
  );
  const envByKey = new Map(envs.map((e) => [environmentKey(e.environment_id), e]));

  const { rows: workspaces } = await query(
    `SELECT workspace_id, display_name FROM workspaces WHERE tenant_id = $1`,
    [tenantId]
  );
  const wsName = new Map(
    workspaces.map((w) => [String(w.workspace_id).toLowerCase(), w.display_name || w.workspace_id])
  );

  const { rows: items } = await query(
    `SELECT id, kind, display_name, environment_id, scope_id, owner_aad_id, tenant_id, resource_id, raw
       FROM inventory_items
      WHERE tenant_id = $1
        AND is_active = true
        AND kind = ANY($2::text[])
        AND (
          (resource_type LIKE 'microsoft.%' AND ${ENV_KEY("environment_id")} = ANY($3::text[]))
          OR
          (resource_type LIKE 'powerbi/%' AND lower(scope_id) = ANY($4::text[]))
        )
      ORDER BY kind, display_name`,
    [tenantId, kinds, envIds, wsIds]
  );

  const { rows: profiles } = await query(`SELECT id FROM profiles WHERE tenant_id = $1`, [tenantId]);
  const profileIds = new Set(profiles.map((p) => p.id.toLowerCase()));

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
      locationLabel = [
        wsName.get(String(it.scope_id).toLowerCase()) || it.scope_id,
      ];
    } else if (it.environment_id) {
      const env = envByKey.get(environmentKey(it.environment_id));
      environmentId = env?.environment_id || canonicalizeEnvironmentId(it.environment_id);
      locationLabel = [env?.display_name || environmentId];
    }
    const url = buildUrlFromInventoryItem(it);

    const { rows } = await query(
      `INSERT INTO components
         (id, tenant_id, name, type, kind, environments, environment_id,
          owner_id, status, url, source_inventory_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'unassigned', $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         type = EXCLUDED.type,
         kind = EXCLUDED.kind,
         environments = EXCLUDED.environments,
         environment_id = EXCLUDED.environment_id,
         owner_id = COALESCE(EXCLUDED.owner_id, components.owner_id),
         url = EXCLUDED.url,
         source_inventory_id = EXCLUDED.source_inventory_id
       RETURNING (xmax = 0) AS was_inserted`,
      [
        compId,
        it.tenant_id || tenantId,
        it.display_name || "(unnamed)",
        type,
        it.kind,
        locationLabel,
        environmentId,
        ownerId,
        url,
        it.id,
      ]
    );
    if (rows[0]?.was_inserted) inserted++;
    else updated++;
  }

  const { rowCount: archived } = await query(
    `UPDATE components c
        SET status = 'archived'
       FROM inventory_items i
      WHERE c.source_inventory_id = i.id
        AND i.tenant_id = $1
        AND i.is_active = false
        AND (i.resource_type LIKE 'microsoft.%' OR i.resource_type LIKE 'powerbi/%')
        AND c.status IS DISTINCT FROM 'archived'`,
    [tenantId]
  );

  return {
    matched: items.length,
    inserted,
    updated,
    archived: archived || 0,
    unresolved_owner,
  };
}

// --- Agent usage (Copilot Kit) + credit rate cards ---

async function upsertAgentUsageDaily(tenantId, rows, syncedAt) {
  let n = 0;
  for (const r of rows) {
    await query(
      `INSERT INTO agent_usage_daily
         (tenant_id, source_id, usage_date, billed_credits, unbilled_credits,
          agent_resource_id, environment_id, feature, display_name, raw,
          last_synced_at, is_active)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::timestamptz, true)
       ON CONFLICT (tenant_id, source_id) DO UPDATE SET
         usage_date = EXCLUDED.usage_date,
         billed_credits = EXCLUDED.billed_credits,
         unbilled_credits = EXCLUDED.unbilled_credits,
         agent_resource_id = EXCLUDED.agent_resource_id,
         environment_id = EXCLUDED.environment_id,
         feature = EXCLUDED.feature,
         display_name = EXCLUDED.display_name,
         raw = EXCLUDED.raw,
         last_synced_at = EXCLUDED.last_synced_at,
         is_active = true`,
      [
        tenantId,
        r.source_id,
        r.usage_date,
        r.billed_credits,
        r.unbilled_credits,
        r.agent_resource_id,
        r.environment_id,
        r.feature,
        r.display_name,
        JSON.stringify(r.raw || {}),
        syncedAt,
      ]
    );
    n++;
  }
  return n;
}

async function deactivateStaleAgentUsage(tenantId, syncedAt) {
  const { rowCount } = await query(
    `UPDATE agent_usage_daily
        SET is_active = false
      WHERE tenant_id = $1
        AND is_active = true
        AND last_synced_at < $2::timestamptz`,
    [tenantId, syncedAt]
  );
  return rowCount || 0;
}

async function linkAgentUsageToInventory(tenantId) {
  const { rowCount } = await query(
    `UPDATE agent_usage_daily u
        SET inventory_item_id = i.id
       FROM inventory_items i
      WHERE u.tenant_id = $1
        AND i.tenant_id = $1
        AND i.kind = 'agent'
        AND i.is_active = true
        AND u.agent_resource_id IS NOT NULL
        AND lower(i.resource_id) = lower(u.agent_resource_id)
        AND u.inventory_item_id IS DISTINCT FROM i.id`,
    [tenantId]
  );
  return rowCount || 0;
}

async function listCreditRateCards(tenantId) {
  const { rows } = await query(
    `SELECT id, tenant_id, label, euro_per_credit, effective_from, effective_to,
            updated_by, created_at, updated_at
       FROM credit_rate_cards
      WHERE tenant_id = $1
      ORDER BY effective_from DESC`,
    [tenantId]
  );
  return rows.map((r) =>
    iso({
      ...r,
      euro_per_credit: Number(r.euro_per_credit),
      effective_from:
        r.effective_from instanceof Date
          ? r.effective_from.toISOString().slice(0, 10)
          : String(r.effective_from).slice(0, 10),
      effective_to: r.effective_to
        ? r.effective_to instanceof Date
          ? r.effective_to.toISOString().slice(0, 10)
          : String(r.effective_to).slice(0, 10)
        : null,
    })
  );
}

async function replaceCreditRateCards(tenantId, cards, updatedBy) {
  const { rangesOverlap } = require("./copilotStudio/creditRates");
  const normalized = (cards || []).map((c) => ({
    label: String(c.label || ""),
    euro_per_credit: Number(c.euro_per_credit),
    effective_from: String(c.effective_from).slice(0, 10),
    effective_to: c.effective_to ? String(c.effective_to).slice(0, 10) : null,
  }));
  for (const c of normalized) {
    if (!c.effective_from || !Number.isFinite(c.euro_per_credit) || c.euro_per_credit < 0) {
      throw Object.assign(new Error("Each rate card needs effective_from and non-negative euro_per_credit"), {
        statusCode: 400,
      });
    }
    if (c.effective_to && c.effective_to < c.effective_from) {
      throw Object.assign(new Error("effective_to must be on or after effective_from"), {
        statusCode: 400,
      });
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
        throw Object.assign(new Error("Rate card date ranges must not overlap"), {
          statusCode: 400,
        });
      }
    }
  }

  await query("DELETE FROM credit_rate_cards WHERE tenant_id = $1", [tenantId]);
  for (const c of normalized) {
    await query(
      `INSERT INTO credit_rate_cards
         (tenant_id, label, euro_per_credit, effective_from, effective_to, updated_by)
       VALUES ($1, $2, $3, $4::date, $5::date, $6)`,
      [
        tenantId,
        c.label,
        c.euro_per_credit,
        c.effective_from,
        c.effective_to,
        updatedBy ?? null,
      ]
    );
  }
  return listCreditRateCards(tenantId);
}

async function getAgentCreditsSummary(tenantId, { from, to, business_unit_id } = {}) {
  const { aggregateAgentCredits } = require("./copilotStudio/creditRates");
  if (!from || !to) {
    throw Object.assign(new Error("from and to query params are required (YYYY-MM-DD)"), {
      statusCode: 400,
    });
  }

  const { extractAgentInventoryDetails } = require("./copilotStudio/agentInventoryDetails");
  const { rows } = await query(
    `SELECT
        u.usage_date::text AS usage_date,
        u.billed_credits::float8 AS billed_credits,
        u.unbilled_credits::float8 AS unbilled_credits,
        u.agent_resource_id,
        u.inventory_item_id,
        COALESCE(i.display_name, u.display_name, u.agent_resource_id) AS display_name,
        COALESCE(u.environment_id, i.environment_id) AS environment_id,
        e.display_name AS environment_name,
        e.environment_type AS environment_type,
        i.raw AS inventory_raw,
        i.owner_external,
        i.owner_aad_id,
        i.created_at_src,
        p.id AS project_id,
        p.name AS project_name,
        p.business_unit_id,
        bu.name AS business_unit_name,
        lower(COALESCE(u.agent_resource_id, u.inventory_item_id, u.id)) AS agent_key
       FROM agent_usage_daily u
       LEFT JOIN inventory_items i
         ON i.id = u.inventory_item_id
         OR (i.tenant_id = u.tenant_id AND i.kind = 'agent'
             AND u.agent_resource_id IS NOT NULL
             AND lower(i.resource_id) = lower(u.agent_resource_id))
       LEFT JOIN environments e
         ON e.tenant_id = u.tenant_id
        AND ${ENV_KEY("e.environment_id")} = ${ENV_KEY("COALESCE(u.environment_id, i.environment_id)")}
       LEFT JOIN components c
         ON c.source_inventory_id = i.id
       LEFT JOIN project_components pc
         ON pc.component_id = c.id
       LEFT JOIN projects p
         ON p.id = pc.project_id
       LEFT JOIN business_units bu
         ON bu.id = p.business_unit_id
      WHERE u.tenant_id = $1
        AND u.is_active = true
        AND u.usage_date >= $2::date
        AND u.usage_date <= $3::date
      ORDER BY u.usage_date`,
    [tenantId, from, to]
  );

  const dailyRows = rows.map((row) => {
    const { inventory_raw, owner_external, owner_aad_id, created_at_src, ...rest } = row;
    const hasInventory = inventory_raw != null || owner_external || owner_aad_id;
    return {
      ...rest,
      inventory_details: hasInventory
        ? extractAgentInventoryDetails(inventory_raw, {
            owner_external,
            owner_aad_id,
            created_at_src,
            environment_type: row.environment_type,
          })
        : null,
    };
  });

  const rates = await listCreditRateCards(tenantId);
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

async function resetStore() {
  throw new Error("resetStore is not supported for Postgres");
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
