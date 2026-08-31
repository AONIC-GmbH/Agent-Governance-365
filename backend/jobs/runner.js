const store = require("../store");
const registry = require("./registry");

const STALE_TIMEOUT_MS = 30 * 60 * 1000; // a run still 'running' after 30m is presumed dead
const REAP_INTERVAL_MS = 5 * 60 * 1000;

function isUniqueViolation(err) {
  return err && err.code === "23505";
}

// Starts a job asynchronously and returns the created run row immediately (the
// HTTP request is NOT bound to the work). Concurrency is enforced by the DB
// partial unique index on (tenant, job_type) WHERE status='running'.
// trigger: manual | scheduled | chained
async function startJob(jobType, { tenantId, trigger, requestedBy = null, params = {} }) {
  const handler = registry.getHandler(jobType);
  if (!handler) {
    const err = new Error(`Unknown job type: ${jobType}`);
    err.statusCode = 404;
    throw err;
  }

  let run;
  try {
    run = await store.createJobRun({
      tenant_id: tenantId,
      job_type: jobType,
      trigger,
      requested_by: requestedBy,
      params,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const conflict = new Error(`A ${jobType} job is already running for this tenant`);
      conflict.statusCode = 409;
      throw conflict;
    }
    throw err;
  }

  runInBackground(run, handler, { tenantId, params });
  return run;
}

const PP_IMPORT_KINDS = new Set(["canvasapp", "modeldrivenapp", "cloudflow", "agent"]);
const PBI_IMPORT_KINDS = new Set(["powerbi_report", "powerbi_dashboard"]);

function importSettingsReady(settings) {
  const kinds = settings?.kinds || [];
  const hasPp = kinds.some((k) => PP_IMPORT_KINDS.has(k)) && settings.environment_ids?.length;
  const hasPbi = kinds.some((k) => PBI_IMPORT_KINDS.has(k)) && settings.workspace_ids?.length;
  return Boolean(hasPp || hasPbi);
}

/** After a successful inventory sync, promote components using saved import config. */
async function maybeChainComponentsImport(tenantId) {
  try {
    const settings = await store.getComponentImportSettings(tenantId);
    if (!importSettingsReady(settings)) {
      console.log(
        `[job chain] skip components_import for tenant ${tenantId}: no import scope configured`
      );
      return;
    }
    await startJob("components_import", {
      tenantId,
      trigger: "chained",
      params: {},
    });
  } catch (err) {
    if (err && err.statusCode === 409) {
      console.log(`[job chain] components_import already running for tenant ${tenantId}`);
      return;
    }
    console.error(`[job chain] failed to start components_import for ${tenantId}`, err);
  }
}

function runInBackground(run, handler, { tenantId, params }) {
  const ctx = {
    runId: run.id,
    jobType: run.job_type,
    tenantId,
    params,
    stats: {},
    log: (...args) => console.log(`[job ${run.job_type} ${run.id}]`, ...args),
    async updateStats(patch) {
      Object.assign(ctx.stats, patch);
      await store.updateJobRun(run.id, { stats: ctx.stats });
    },
  };

  Promise.resolve()
    .then(() => handler(ctx))
    .then(async (result) => {
      const stats = { ...ctx.stats, ...(result && typeof result === "object" ? result : {}) };
      await store.updateJobRun(run.id, {
        status: "success",
        stats,
        finished_at: new Date().toISOString(),
      });
      ctx.log("success", stats);
      if (run.job_type === "inventory_sync" || run.job_type === "powerbi_inventory_sync") {
        await maybeChainComponentsImport(tenantId);
      }
    })
    .catch(async (err) => {
      console.error(`[job ${run.job_type} ${run.id}] failed`, err);
      await store
        .updateJobRun(run.id, {
          status: "failed",
          error: String((err && err.message) || err).slice(0, 2000),
          finished_at: new Date().toISOString(),
        })
        .catch((e) => console.error("Failed to persist job failure", e));
    });
}

async function reapStaleRuns(timeoutMs = STALE_TIMEOUT_MS) {
  try {
    const n = await store.reapStaleJobRuns(timeoutMs);
    if (n) console.log(`Reaped ${n} stale job run(s)`);
  } catch (err) {
    console.error("reapStaleRuns failed", err);
  }
}

// Fire-and-forget work dies if the App Service instance recycles, leaving a run
// stuck 'running' (which holds the lock). Periodically mark such runs failed.
function startReaper({ timeoutMs = STALE_TIMEOUT_MS, intervalMs = REAP_INTERVAL_MS } = {}) {
  reapStaleRuns(timeoutMs);
  const timer = setInterval(() => reapStaleRuns(timeoutMs), intervalMs);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { startJob, startReaper, reapStaleRuns };
