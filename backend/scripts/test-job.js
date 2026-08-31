require("dotenv").config();
require("../jobs"); // registers all handlers
const registry = require("../jobs/registry");
const { pool } = require("../db");

// Usage: node scripts/test-job.js [jobType]
// Runs a job handler directly (awaited, no background) for local validation.
const jobType = process.argv[2] || "coe_sync";

(async () => {
  const handler = registry.getHandler(jobType);
  if (!handler) {
    console.error(`Unknown job type "${jobType}". Known:`, registry.listJobTypes());
    process.exit(1);
  }

  const tenantId = process.env.DEFAULT_TENANT_ID || "t1";
  const ctx = {
    runId: "test",
    jobType,
    tenantId,
    params: {},
    stats: {},
    log: (...a) => console.log("[log]", ...a),
    updateStats: async (patch) => {
      Object.assign(ctx.stats, patch);
      console.log("[stats]", JSON.stringify(ctx.stats));
    },
  };

  console.log(`Running ${jobType} for tenant=${tenantId} ...`);
  try {
    const result = await handler(ctx);
    console.log("RESULT:", JSON.stringify(result, null, 2));
  } catch (e) {
    console.error("FAILED:", e.message);
    process.exitCode = 1;
  } finally {
    if (pool) await pool.end();
  }
})();
