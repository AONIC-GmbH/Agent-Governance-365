require("dotenv").config();
const { pool, query } = require("../db");

const id = process.argv[2] || "0abd16e9-1ac9-4813-952b-d2c48fcbdec1";

(async () => {
  for (let i = 0; i < 60; i++) {
    const { rows } = await query(
      "SELECT id, status, stats, error, started_at, finished_at FROM job_runs WHERE id = $1",
      [id]
    );
    const r = rows[0];
    if (!r) {
      console.log("NOT_FOUND");
      break;
    }
    console.log(
      JSON.stringify({
        attempt: i,
        status: r.status,
        stats: r.stats,
        error: r.error,
        finished_at: r.finished_at,
      })
    );
    if (r.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
})()
  .catch((e) => {
    console.error("FAILED:", e.message);
    process.exitCode = 1;
  })
  .finally(() => pool?.end());
