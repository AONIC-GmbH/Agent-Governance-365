require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const store = require("./store");
const graph = require("./graph");
const jobs = require("./jobs");
const { optionalAuth, requireAuth, claimsFromUser, authEnabled } = require("./middleware/auth");
const { validateLogoUpload, publicTenant, LOGO_MAX_BYTES } = require("./branding");

const app = express();
const PORT = process.env.PORT || 7071;
const storageMode =
  process.env.USE_MEMORY_STORE === "1" || !process.env.DATABASE_URL
    ? "memory"
    : "postgres";

// Allowed browser origins: localhost (dev) plus any configured via
// ALLOWED_ORIGINS (comma-separated), e.g. the deployed frontend URL.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        /^http:\/\/localhost:\d+$/.test(origin) ||
        /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) ||
        allowedOrigins.includes(origin)
      ) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
  })
);
app.use((req, res, next) => {
  if (req.method === "PUT" && /^\/tenants\/[^/]+\/logo$/.test(req.path)) {
    return next();
  }
  return express.json()(req, res, next);
});
app.use(optionalAuth);

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

function notFound(res, message = "Not found") {
  return res.status(404).json({ error: message });
}

// Requires the caller to have the `admin` role. Assumes requireAuth has already
// run (so req.user is set). Falls open only when auth is globally disabled
// (e.g. local mock mode without Entra configured).
const requireAdmin = asyncHandler(async (req, res, next) => {
  if (!authEnabled) return next();
  const claims = claimsFromUser(req.user);
  const roles = await store.getUserRoles(claims.id);
  if (!roles.some((r) => r.role === "admin")) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
});

// Resolves the app tenant of the authenticated caller, derived server-side and
// never trusted from the client. Falls back to DEFAULT_TENANT_ID (single-tenant
// deployment / local mock mode).
async function callerTenantId(req) {
  let tenantId = process.env.DEFAULT_TENANT_ID || "t1";
  if (authEnabled && req.user) {
    const claims = claimsFromUser(req.user);
    const profile = await store.getProfile(claims.id);
    tenantId =
      profile?.tenant_id ||
      (await store.resolveTenantByEmail(claims.email)) ||
      tenantId;
  }
  return tenantId;
}

// A collaborator must have a profiles row (project_collaborators.user_id FK). For
// a directory user picked from Microsoft Graph who has never logged in, create a
// lightweight stub profile (id = Entra object id) so they can be linked now; it
// reconciles automatically on their first login (same id via /auth/sync).
async function ensureCollaboratorProfile(userId, tenantId) {
  if (!userId) return { ok: false, status: 400, error: "user_id required" };
  const existing = await store.getProfile(userId);
  if (existing) return { ok: true };
  if (!graph.graphEnabled) {
    return { ok: false, status: 400, error: "Directory lookup not configured" };
  }
  const u = await graph.getDirectoryUser(userId);
  if (!u) return { ok: false, status: 404, error: "User not found in directory" };
  await store.upsertProfile({
    id: u.id,
    tenant_id: tenantId,
    full_name: u.full_name,
    email: u.email,
  });
  await store.ensureUserRole(u.id, "user");
  return { ok: true };
}

// --- Health ---

app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    message: "Backend is running",
    storage: storageMode,
    auth: authEnabled ? "entra" : "disabled",
    endpoints: ["/health", "/auth/sync", "/projects", "/components"],
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", storage: storageMode, auth: authEnabled ? "entra" : "disabled" });
});

// --- Internal job trigger (machine callers, e.g. nightly timer) ---

const INTERNAL_JOB_TRIGGER_SECRET = process.env.INTERNAL_JOB_TRIGGER_SECRET || "";

// Compare secrets without leaking length via early return on size mismatch.
// Hash both sides first so crypto.timingSafeEqual always runs on fixed 32-byte digests.
function timingSafeEqual(a, b) {
  const digA = crypto.createHash("sha256").update(String(a), "utf8").digest();
  const digB = crypto.createHash("sha256").update(String(b), "utf8").digest();
  return crypto.timingSafeEqual(digA, digB);
}

// Thin entry point for a timer-triggered Azure Function / Logic App to kick off
// a job (e.g. nightly inventory_sync). Defined BEFORE the global requireAuth so
// it isn't behind user (Entra) auth; instead it's gated by a shared secret
// header. NOTE: stopgap until the P0 "proper API access tokens" item lands.
app.post(
  "/internal/jobs/:jobType/run",
  asyncHandler(async (req, res) => {
    if (!INTERNAL_JOB_TRIGGER_SECRET) {
      return res.status(503).json({ error: "Internal job trigger not configured" });
    }
    const provided = req.get("x-internal-job-secret") || "";
    if (!timingSafeEqual(provided, INTERNAL_JOB_TRIGGER_SECRET)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const tenantId = req.body?.tenant_id || process.env.DEFAULT_TENANT_ID || "t1";
    try {
      const run = await jobs.startJob(req.params.jobType, {
        tenantId,
        trigger: "scheduled",
        requestedBy: null,
        params: req.body?.params || {},
      });
      res.status(202).json({ id: run.id, status: run.status, job_type: run.job_type });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      throw err;
    }
  })
);

// --- Public branding (login screen + <img> tags, which cannot send a token) ---

app.get(
  "/branding",
  asyncHandler(async (_req, res) => {
    const tenantId = process.env.DEFAULT_TENANT_ID || "t1";
    const tenant = await store.getTenant(tenantId);
    if (!tenant) return notFound(res, "Tenant not found");
    res.json(publicTenant(tenant));
  })
);

app.get(
  "/tenants/:id/logo",
  asyncHandler(async (req, res) => {
    const logo = await store.getTenantLogo(req.params.id);
    if (!logo) return notFound(res, "Logo not found");
    res.setHeader("Content-Type", logo.contentType);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.send(Buffer.isBuffer(logo.bytes) ? logo.bytes : Buffer.from(logo.bytes));
  })
);

// Everything below requires a valid Entra token. Only "/", "/health", the public
// branding reads and the secret-gated "/internal/*" above are public. When auth is
// globally disabled (local mock mode), requireAuth is a no-op so local development
// still works.
app.use(requireAuth);

// --- Auth sync (Entra login → upsert profile) ---

app.post(
  "/auth/sync",
  asyncHandler(async (req, res) => {
    const claims = claimsFromUser(req.user);
    // Single-tenant deployment: users whose email domain isn't explicitly mapped
    // fall back to DEFAULT_TENANT_ID, so subsidiary domains in the same Entra
    // directory all land in the one app tenant. See README "Single-tenant assumption".
    let tenantId =
      (await store.resolveTenantByEmail(claims.email)) ||
      process.env.DEFAULT_TENANT_ID ||
      "t1";

    const profile = await store.upsertProfile({
      id: claims.id,
      tenant_id: tenantId,
      full_name: claims.full_name,
      email: claims.email,
    });
    await store.ensureUserRole(claims.id, "user");

    const roles = await store.getUserRoles(claims.id);
    res.json({
      profile,
      isAdmin: roles.some((r) => r.role === "admin"),
    });
  })
);

// --- Projects ---

app.get(
  "/projects",
  asyncHandler(async (_req, res) => {
    res.json(await store.getProjects());
  })
);

app.get(
  "/projects/summary",
  asyncHandler(async (_req, res) => {
    res.json(await store.getAllProjectsSummary());
  })
);

app.get(
  "/projects/pending",
  asyncHandler(async (_req, res) => {
    res.json(await store.getPendingProjects());
  })
);

app.get(
  "/projects/:id",
  asyncHandler(async (req, res) => {
    const project = await store.getProject(req.params.id);
    if (!project) return notFound(res, "Project not found");
    res.json(project);
  })
);

app.post(
  "/projects",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const tenantId = body.tenant_id;
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });
    if (!String(body.name || "").trim()) {
      return res.status(400).json({ error: "name required" });
    }
    if (!String(body.description || "").trim()) {
      return res.status(400).json({ error: "description required" });
    }

    if (body.business_unit_id) {
      const unit = await store.getBusinessUnit(tenantId, body.business_unit_id);
      if (!unit || !unit.is_active) {
        return res.status(400).json({ error: "Invalid or inactive business_unit_id" });
      }
    } else {
      const units = await store.listBusinessUnits(tenantId, { activeOnly: true });
      if (units.length > 0) {
        return res.status(400).json({ error: "business_unit_id required" });
      }
    }

    const questions = await store.listComplianceQuestions(tenantId, { activeOnly: true });
    const answers = body.answers && typeof body.answers === "object" ? body.answers : {};
    for (const q of questions) {
      if (q.required && !String(answers[q.id] || "").trim()) {
        return res.status(400).json({ error: `Answer required for question: ${q.prompt}` });
      }
    }

    if (Array.isArray(body.tag_ids)) {
      const tagIds = [...new Set(body.tag_ids.map(String))];
      const activeTags = await store.listProjectTagDefinitions(tenantId, { activeOnly: true });
      const activeTagIds = new Set(activeTags.map((t) => t.id));
      for (const tid of tagIds) {
        if (!activeTagIds.has(tid)) {
          return res.status(400).json({ error: `Invalid or inactive tag_id: ${tid}` });
        }
      }
      body.tag_ids = tagIds;
    }

    const result = await store.createProject(body);
    res.status(201).json(result);
  })
);

app.patch(
  "/projects/:id",
  asyncHandler(async (req, res) => {
    const project = await store.getProject(req.params.id);
    if (!project) return notFound(res, "Project not found");
    const body = { ...(req.body || {}) };
    if (body.name !== undefined && !String(body.name || "").trim()) {
      return res.status(400).json({ error: "name required" });
    }
    if (body.description !== undefined && !String(body.description || "").trim()) {
      return res.status(400).json({ error: "description required" });
    }
    if (Array.isArray(body.tag_ids)) {
      const tagIds = [...new Set(body.tag_ids.map(String))];
      const activeTags = await store.listProjectTagDefinitions(project.tenant_id, {
        activeOnly: true,
      });
      const activeTagIds = new Set(activeTags.map((t) => t.id));
      for (const tid of tagIds) {
        if (!activeTagIds.has(tid)) {
          return res.status(400).json({ error: `Invalid or inactive tag_id: ${tid}` });
        }
      }
      body.tag_ids = tagIds;
    }
    if (!(await store.updateProject(req.params.id, body))) return notFound(res, "Project not found");
    res.json({ ok: true });
  })
);

app.delete(
  "/projects/:id",
  asyncHandler(async (req, res) => {
    if (!(await store.deleteProject(req.params.id))) return notFound(res, "Project not found");
    res.status(204).send();
  })
);

app.patch(
  "/projects/:id/service-user",
  asyncHandler(async (req, res) => {
    const { service_user } = req.body;
    if (!(await store.assignProjectServiceUser(req.params.id, service_user ?? null))) {
      return notFound(res, "Project not found");
    }
    res.json({ ok: true });
  })
);

app.delete(
  "/projects/:id/service-user",
  asyncHandler(async (req, res) => {
    if (!(await store.unassignProjectServiceUser(req.params.id))) return notFound(res, "Project not found");
    res.json({ ok: true });
  })
);

app.delete(
  "/projects/service-user/:name",
  asyncHandler(async (req, res) => {
    await store.clearProjectServiceUserByName(req.params.name);
    res.json({ ok: true });
  })
);

// --- Components ---

app.get(
  "/components",
  asyncHandler(async (req, res) => {
    const { owner_id, ids } = req.query;
    if (ids) {
      const idList = String(ids).split(",").filter(Boolean);
      return res.json(await store.getComponentsByIds(idList));
    }
    if (owner_id) {
      return res.json(await store.getComponents(String(owner_id)));
    }
    return res.status(400).json({ error: "owner_id or ids query param required" });
  })
);

app.get(
  "/components/assigned-ids",
  asyncHandler(async (_req, res) => {
    res.json(await store.getAssignedComponentIds());
  })
);

app.get(
  "/components/my-ids",
  asyncHandler(async (req, res) => {
    const ownerId = req.query.owner_id;
    if (!ownerId) return res.status(400).json({ error: "owner_id required" });
    res.json(await store.getMyComponentIds(String(ownerId)));
  })
);

app.post(
  "/components",
  asyncHandler(async (req, res) => {
    const rows = Array.isArray(req.body) ? req.body : [req.body];
    const inserted = await store.insertComponents(rows);
    res.status(201).json(inserted);
  })
);

app.delete(
  "/components",
  asyncHandler(async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: "ids array required" });
    await store.deleteComponents(ids);
    res.status(204).send();
  })
);

app.patch(
  "/components/:id/archive",
  asyncHandler(async (req, res) => {
    if (!(await store.archiveComponent(req.params.id))) return notFound(res, "Component not found");
    res.json({ ok: true });
  })
);

// --- Project components ---

app.get(
  "/project-components",
  asyncHandler(async (req, res) => {
    const { project_id } = req.query;
    if (project_id) {
      return res.json(await store.getProjectComponentIds(String(project_id)));
    }
    res.json(await store.getAllProjectComponents());
  })
);

app.post(
  "/project-components",
  asyncHandler(async (req, res) => {
    const rows = Array.isArray(req.body) ? req.body : [req.body];
    await store.addProjectComponents(rows);
    res.status(201).json({ ok: true });
  })
);

app.delete(
  "/project-components",
  asyncHandler(async (req, res) => {
    const { project_id, component_id } = req.body || {};
    if (!project_id || !component_id) {
      return res.status(400).json({ error: "project_id and component_id required" });
    }
    if (!(await store.removeProjectComponent(project_id, component_id))) {
      return notFound(res, "Project component not found");
    }
    res.status(204).send();
  })
);

// --- Project collaborators ---

app.get(
  "/project-collaborators",
  asyncHandler(async (req, res) => {
    const { project_id, user_id } = req.query;
    if (project_id) {
      const userIds = await store.getProjectCollaboratorUserIds(String(project_id));
      return res.json(await store.getProfilesByIds(userIds));
    }
    if (user_id) {
      return res.json(await store.getMyCollaboratorProjectIds(String(user_id)));
    }
    return res.status(400).json({ error: "project_id or user_id required" });
  })
);

app.post(
  "/project-collaborators",
  asyncHandler(async (req, res) => {
    const body = req.body;
    const rows = Array.isArray(body)
      ? body
      : [{ project_id: body.project_id, user_id: body.user_id }];
    const tenantId = await callerTenantId(req);

    for (const row of rows) {
      const ensured = await ensureCollaboratorProfile(row.user_id, tenantId);
      if (!ensured.ok) return res.status(ensured.status).json({ error: ensured.error });
    }

    await store.addProjectCollaborators(rows);
    res.status(201).json({ ok: true });
  })
);

app.delete(
  "/project-collaborators",
  asyncHandler(async (req, res) => {
    const { project_id, user_id } = req.body;
    await store.removeProjectCollaborator(project_id, user_id);
    res.status(204).send();
  })
);

// --- Directory (Microsoft Graph) ---

// Searches the caller's Entra/AD tenant directory for the collaborator picker.
// Auth is required (applied globally). When Graph isn't configured (no client
// secret), returns an empty list so the UI degrades gracefully.
app.get(
  "/directory/users",
  asyncHandler(async (req, res) => {
    if (!graph.graphEnabled) return res.json([]);
    const q = req.query.q ? String(req.query.q) : "";
    res.json(await graph.searchDirectoryUsers(q));
  })
);

// --- Profiles ---

app.get(
  "/profiles",
  asyncHandler(async (req, res) => {
    const { exclude } = req.query;
    if (exclude) {
      // Colleague picker fallback: return only people in the caller's own app
      // tenant, excluding the caller. Tenant is derived from the authenticated
      // user server-side and never trusted from the client. The `exclude` param
      // is a hint used only when auth is globally disabled (local mock mode).
      const excludeId = authEnabled && req.user ? claimsFromUser(req.user).id : String(exclude);
      const tenantId = await callerTenantId(req);
      return res.json(await store.getTenantProfiles(tenantId, excludeId));
    }
    res.json(await store.getAllProfiles());
  })
);

app.post(
  "/profiles/by-ids",
  asyncHandler(async (req, res) => {
    const { ids } = req.body;
    res.json(await store.getProfilesByIds(ids ?? []));
  })
);

app.get(
  "/profiles/:id/roles",
  asyncHandler(async (req, res) => {
    res.json(await store.getUserRoles(req.params.id));
  })
);

app.get(
  "/profiles/:id",
  asyncHandler(async (req, res) => {
    const profile = await store.getProfile(req.params.id);
    if (!profile) return notFound(res, "Profile not found");
    res.json(profile);
  })
);

// --- Admin ---

app.get(
  "/admin/users",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(await store.getAdminUsers());
  })
);

app.get(
  "/admin/components",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const tenantId = await callerTenantId(req);
    res.json(await store.getAdminComponents(tenantId));
  })
);

app.get(
  "/admin/components/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const tenantId = await callerTenantId(req);
    try {
      res.json(await store.getAdminComponentDetail(tenantId, req.params.id));
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      throw err;
    }
  })
);

const IMPORT_ALLOWED_KINDS = new Set([
  "canvasapp",
  "modeldrivenapp",
  "cloudflow",
  "agent",
  "powerbi_report",
  "powerbi_dashboard",
]);

function normalizeImportKinds(kinds) {
  if (!Array.isArray(kinds)) return [];
  return [...new Set(kinds.map(String).filter((k) => IMPORT_ALLOWED_KINDS.has(k)))];
}

function normalizeImportEnvIds(ids) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.map(String).filter(Boolean))];
}

app.get(
  "/admin/environments",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const tenantId = await callerTenantId(req);
    res.json(await store.listEnvironments(tenantId));
  })
);

app.get(
  "/admin/workspaces",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const tenantId = await callerTenantId(req);
    res.json(await store.listWorkspaces(tenantId));
  })
);

app.get(
  "/admin/inventory/environments",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const tenantId = await callerTenantId(req);
    res.json(await store.listInventoryEnvironments(tenantId));
  })
);

app.get(
  "/admin/agent-credits",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const tenantId = await callerTenantId(req);
    const from = typeof req.query.from === "string" ? req.query.from : "";
    const to = typeof req.query.to === "string" ? req.query.to : "";
    const business_unit_id =
      typeof req.query.business_unit_id === "string" ? req.query.business_unit_id : "";
    try {
      res.json(
        await store.getAgentCreditsSummary(tenantId, {
          from,
          to,
          business_unit_id: business_unit_id || undefined,
        })
      );
    } catch (err) {
      if (err.statusCode === 400) return res.status(400).json({ error: err.message });
      throw err;
    }
  })
);

app.get(
  "/admin/credit-rate-cards",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const tenantId = await callerTenantId(req);
    res.json(await store.listCreditRateCards(tenantId));
  })
);

app.put(
  "/admin/credit-rate-cards",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const tenantId = await callerTenantId(req);
    const cards = Array.isArray(req.body?.cards) ? req.body.cards : req.body;
    if (!Array.isArray(cards)) {
      return res.status(400).json({ error: "Expected { cards: [...] }" });
    }
    try {
      res.json(await store.replaceCreditRateCards(tenantId, cards, req.user?.oid || null));
    } catch (err) {
      if (err.statusCode === 400) return res.status(400).json({ error: err.message });
      throw err;
    }
  })
);

app.get(
  "/admin/component-import-settings",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const tenantId = await callerTenantId(req);
    res.json(await store.getComponentImportSettings(tenantId));
  })
);

app.put(
  "/admin/component-import-settings",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const tenantId = await callerTenantId(req);
    const updatedBy = authEnabled && req.user ? claimsFromUser(req.user).id : null;
    const kinds = normalizeImportKinds(req.body?.kinds);
    const environment_ids = normalizeImportEnvIds(req.body?.environment_ids);
    const workspace_ids = normalizeImportEnvIds(req.body?.workspace_ids);
    res.json(
      await store.upsertComponentImportSettings(tenantId, {
        kinds,
        environment_ids,
        workspace_ids,
        updated_by: updatedBy,
      })
    );
  })
);

app.get(
  "/admin/component-import-preview",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const tenantId = await callerTenantId(req);
    const kinds = normalizeImportKinds(
      typeof req.query.kinds === "string" ? req.query.kinds.split(",") : req.query.kinds
    );
    const environmentIds = normalizeImportEnvIds(
      typeof req.query.environment_ids === "string"
        ? req.query.environment_ids.split(",")
        : req.query.environment_ids
    );
    const workspaceIds = normalizeImportEnvIds(
      typeof req.query.workspace_ids === "string"
        ? req.query.workspace_ids.split(",")
        : req.query.workspace_ids
    );
    res.json(
      await store.previewComponentImport(tenantId, {
        kinds,
        environmentIds,
        workspaceIds,
      })
    );
  })
);

app.get(
  "/admin/pending-projects",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(await store.getPendingProjects());
  })
);

app.patch(
  "/admin/users/:id/role",
  requireAdmin,
  asyncHandler(async (req, res) => {
    await store.updateUserRole(req.params.id, req.body.role);
    res.json({ ok: true });
  })
);

// --- Admin: background jobs (inventory_sync, future solution_import) ---

app.get(
  "/admin/jobs/inventory-sources",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ sources: jobs.listInventorySources() });
  })
);

// Starts every inventory-related job whose connector is configured.
app.post(
  "/admin/jobs/sync-configured/run",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const tenantId = await callerTenantId(req);
    const requestedBy = authEnabled && req.user ? claimsFromUser(req.user).id : null;
    const sources = jobs.listInventorySources();
    const configured = sources.filter((s) => s.configured);
    if (configured.length === 0) {
      return res.status(400).json({
        error: "No inventory sources are configured",
        sources,
      });
    }

    const started = [];
    const already_running = [];
    const failed = [];
    for (const source of configured) {
      try {
        const run = await jobs.startJob(source.job_type, {
          tenantId,
          trigger: "manual",
          requestedBy,
          params: req.body || {},
        });
        started.push(run);
      } catch (err) {
        if (err.statusCode === 409) {
          already_running.push({ job_type: source.job_type, label: source.label });
          continue;
        }
        failed.push({ job_type: source.job_type, label: source.label, error: err.message });
      }
    }

    res.status(202).json({
      started,
      skipped: sources.filter((s) => !s.configured).map((s) => ({
        job_type: s.job_type,
        label: s.label,
        reason: "not_configured",
      })),
      already_running,
      failed,
    });
  })
);

// "Sync now": starts a job for the caller's tenant and returns the run row
// immediately (work continues in the background). 409 if one is already running.
app.post(
  "/admin/jobs/:jobType/run",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const tenantId = await callerTenantId(req);
    const requestedBy = authEnabled && req.user ? claimsFromUser(req.user).id : null;
    try {
      const run = await jobs.startJob(req.params.jobType, {
        tenantId,
        trigger: "manual",
        requestedBy,
        params: req.body || {},
      });
      res.status(202).json(run);
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      throw err;
    }
  })
);

app.get(
  "/admin/jobs/runs",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const tenantId = await callerTenantId(req);
    const { type, status, limit } = req.query;
    res.json(
      await store.listJobRuns({
        tenant_id: tenantId,
        job_type: type ? String(type) : undefined,
        status: status ? String(status) : undefined,
        limit: limit ? Number(limit) : 50,
      })
    );
  })
);

app.get(
  "/admin/jobs/runs/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const run = await store.getJobRun(req.params.id);
    if (!run) return notFound(res, "Job run not found");
    res.json(run);
  })
);

// --- Tenants / branding (public reads are registered before requireAuth above) ---

app.get(
  "/tenants/:id",
  asyncHandler(async (req, res) => {
    const tenant = await store.getTenant(req.params.id);
    if (!tenant) return notFound(res, "Tenant not found");
    res.json(publicTenant(tenant));
  })
);

app.patch(
  "/tenants/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const tenant = await store.getTenant(req.params.id);
    if (!tenant) return notFound(res, "Tenant not found");
    const name = req.body?.name != null ? String(req.body.name).trim() : undefined;
    const tool_name = req.body?.tool_name != null ? String(req.body.tool_name).trim() : undefined;
    if (name !== undefined && !name) {
      return res.status(400).json({ error: "name cannot be empty" });
    }
    if (tool_name !== undefined && !tool_name) {
      return res.status(400).json({ error: "tool_name cannot be empty" });
    }
    await store.updateTenant(req.params.id, {
      ...(name !== undefined ? { name } : {}),
      ...(tool_name !== undefined ? { tool_name } : {}),
    });
    const updated = await store.getTenant(req.params.id);
    res.json(publicTenant(updated));
  })
);

app.put(
  "/tenants/:id/logo",
  requireAdmin,
  express.raw({
    type: ["image/png", "image/jpeg", "image/webp", "application/octet-stream"],
    limit: LOGO_MAX_BYTES + 1024,
  }),
  asyncHandler(async (req, res) => {
    const tenant = await store.getTenant(req.params.id);
    if (!tenant) return notFound(res, "Tenant not found");
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
    const check = validateLogoUpload(buffer, req.get("content-type"));
    if (!check.ok) return res.status(check.status).json({ error: check.error });
    await store.setTenantLogo(req.params.id, buffer, check.contentType);
    res.json({ ok: true, has_logo: true });
  })
);

app.delete(
  "/tenants/:id/logo",
  requireAdmin,
  asyncHandler(async (req, res) => {
    if (!(await store.clearTenantLogo(req.params.id))) return notFound(res, "Tenant not found");
    res.status(204).send();
  })
);

app.get(
  "/tenants/:id/email-domains",
  asyncHandler(async (req, res) => {
    res.json(await store.getTenantEmailDomains(req.params.id));
  })
);

app.post(
  "/tenants/:id/email-domains",
  requireAdmin,
  asyncHandler(async (req, res) => {
    await store.addTenantEmailDomain(req.params.id, req.body.domain);
    res.status(201).json({ ok: true });
  })
);

app.delete(
  "/email-domains/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    await store.deleteTenantEmailDomain(req.params.id);
    res.status(204).send();
  })
);

// --- Business units ---

app.get(
  "/tenants/:id/business-units",
  asyncHandler(async (req, res) => {
    const activeOnly = req.query.active === "1" || req.query.active === "true";
    res.json(await store.listBusinessUnits(req.params.id, { activeOnly }));
  })
);

app.post(
  "/tenants/:id/business-units",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    try {
      const row = await store.createBusinessUnit(req.params.id, {
        name,
        sort_order: req.body?.sort_order,
      });
      res.status(201).json(row);
    } catch (err) {
      if (err?.code === "23505") {
        return res.status(409).json({ error: "Business unit name already exists" });
      }
      throw err;
    }
  })
);

app.patch(
  "/tenants/:id/business-units/:unitId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    try {
      const row = await store.updateBusinessUnit(req.params.id, req.params.unitId, req.body || {});
      if (!row) return notFound(res, "Business unit not found");
      res.json(row);
    } catch (err) {
      if (err?.code === "23505") {
        return res.status(409).json({ error: "Business unit name already exists" });
      }
      throw err;
    }
  })
);

app.delete(
  "/tenants/:id/business-units/:unitId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const row = await store.deactivateBusinessUnit(req.params.id, req.params.unitId);
    if (!row) return notFound(res, "Business unit not found");
    res.json(row);
  })
);

// --- Compliance questions ---

app.get(
  "/tenants/:id/compliance-questions",
  asyncHandler(async (req, res) => {
    const activeOnly = req.query.active === "1" || req.query.active === "true";
    res.json(await store.listComplianceQuestions(req.params.id, { activeOnly }));
  })
);

app.post(
  "/tenants/:id/compliance-questions",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    const answer_type = req.body?.answer_type === "select" ? "select" : "text";
    const options = Array.isArray(req.body?.options)
      ? req.body.options.map((o) => String(o).trim()).filter(Boolean)
      : [];
    if (answer_type === "select" && options.length === 0) {
      return res.status(400).json({ error: "select questions need at least one option" });
    }
    const row = await store.createComplianceQuestion(req.params.id, {
      prompt,
      answer_type,
      options,
      required: req.body?.required !== false,
      sort_order: req.body?.sort_order,
    });
    res.status(201).json(row);
  })
);

app.patch(
  "/tenants/:id/compliance-questions/:questionId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const patch = { ...(req.body || {}) };
    if (patch.answer_type === "select" && Array.isArray(patch.options) && patch.options.length === 0) {
      return res.status(400).json({ error: "select questions need at least one option" });
    }
    const row = await store.updateComplianceQuestion(req.params.id, req.params.questionId, patch);
    if (!row) return notFound(res, "Question not found");
    res.json(row);
  })
);

app.delete(
  "/tenants/:id/compliance-questions/:questionId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const row = await store.deactivateComplianceQuestion(req.params.id, req.params.questionId);
    if (!row) return notFound(res, "Question not found");
    res.json(row);
  })
);

// --- Discovery + project tags ---

app.get(
  "/discovery/projects",
  asyncHandler(async (req, res) => {
    const tenantId = await callerTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant required" });
    res.json(
      await store.listDiscoveryProjects(tenantId, {
        q: req.query.q,
        domain: req.query.domain,
        capability: req.query.capability,
        business_unit_id: req.query.business_unit_id,
      })
    );
  })
);

app.get(
  "/project-tags",
  asyncHandler(async (req, res) => {
    const tenantId = await callerTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant required" });
    const activeOnly = req.query.active !== "0" && req.query.active !== "false";
    res.json(await store.listProjectTagDefinitions(tenantId, { activeOnly }));
  })
);

app.get(
  "/projects/:id/tags",
  asyncHandler(async (req, res) => {
    const project = await store.getProject(req.params.id);
    if (!project) return notFound(res, "Project not found");
    const ids = await store.getProjectTagIds(req.params.id);
    const all = await store.listProjectTagDefinitions(project.tenant_id, { activeOnly: false });
    const byId = new Map(all.map((t) => [t.id, t]));
    res.json(ids.map((id) => byId.get(id)).filter(Boolean));
  })
);

app.get(
  "/tenants/:id/project-tags",
  asyncHandler(async (req, res) => {
    const activeOnly = req.query.active === "1" || req.query.active === "true";
    res.json(await store.listProjectTagDefinitions(req.params.id, { activeOnly }));
  })
);

app.post(
  "/tenants/:id/project-tags",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    const group_key = req.body?.group_key === "capability" ? "capability" : "domain";
    try {
      const row = await store.createProjectTagDefinition(req.params.id, {
        name,
        group_key,
        sort_order: req.body?.sort_order,
      });
      res.status(201).json(row);
    } catch (err) {
      if (err?.code === "23505") {
        return res.status(409).json({ error: "Tag name already exists in this group" });
      }
      throw err;
    }
  })
);

app.patch(
  "/tenants/:id/project-tags/:tagId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    try {
      const row = await store.updateProjectTagDefinition(
        req.params.id,
        req.params.tagId,
        req.body || {}
      );
      if (!row) return notFound(res, "Tag not found");
      res.json(row);
    } catch (err) {
      if (err?.code === "23505") {
        return res.status(409).json({ error: "Tag name already exists in this group" });
      }
      throw err;
    }
  })
);

app.delete(
  "/tenants/:id/project-tags/:tagId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const row = await store.deactivateProjectTagDefinition(req.params.id, req.params.tagId);
    if (!row) return notFound(res, "Tag not found");
    res.json(row);
  })
);

// --- Service users ---

app.get(
  "/service-users",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(await store.getServiceUsersWithDetails());
  })
);

app.post(
  "/service-users",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { name, tenant_id, assigned_to } = req.body;
    await store.createServiceUser(name, tenant_id, assigned_to ?? null);
    res.status(201).json({ ok: true });
  })
);

app.delete(
  "/service-users/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { name } = req.body;
    await store.deleteServiceUser(req.params.id, name);
    res.status(204).send();
  })
);

app.patch(
  "/service-users/:id/assignment",
  requireAdmin,
  asyncHandler(async (req, res) => {
    await store.updateServiceUserAssignment(req.params.id, req.body.assigned_to ?? null);
    res.json({ ok: true });
  })
);

// Centralized error handler. Logs the full error server-side but never leaks
// internal details (messages, stack, SQL) to the client.
app.use((err, _req, res, _next) => {
  console.error(err);
  if (err && err.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "Origin not allowed" });
  }
  res.status(500).json({ error: "Internal server error" });
});

function startServer(port = PORT) {
  return app.listen(port, () => {
    console.log(`Backend listening on http://localhost:${port} (${storageMode} store)`);
    // Mark interrupted job runs (instance recycle / deploy) as failed so a dead
    // run can't hold the per-(tenant, job_type) lock forever.
    jobs.startReaper();
  });
}

module.exports = { app, startServer, PORT, storageMode };

if (require.main === module) {
  startServer();
}