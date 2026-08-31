require("dotenv").config();
const { pool, query } = require("./../db");

(async () => {
  try {
    const summary = await query(
      `SELECT kind,
              count(*)                                   AS total,
              count(display_name)                        AS with_name,
              count(environment_id)                      AS with_env,
              count(owner_external)                      AS with_owner,
              count(owner_aad_id)                        AS with_owner_aad
         FROM inventory_items
        GROUP BY kind
        ORDER BY kind`
    );
    console.log("Mapping coverage by kind:");
    console.table(summary.rows);

    const linked = await query(
      `SELECT count(*) FILTER (WHERE i.owner_aad_id IS NOT NULL)                         AS with_owner_aad,
              count(*) FILTER (WHERE p.id IS NOT NULL)                                   AS linked_to_profile
         FROM inventory_items i
         LEFT JOIN profiles p ON p.id = i.owner_aad_id`
    );
    console.log("\nEntra link (owner_aad_id -> profiles.id):");
    console.table(linked.rows);

    const sample = await query(
      `SELECT kind, resource_type, display_name, environment_id, owner_external, location
         FROM inventory_items
        ORDER BY kind, display_name
        LIMIT 8`
    );
    console.log("\nSample rows:");
    console.table(sample.rows);
  } catch (e) {
    console.error("FAILED:", e.message);
    process.exitCode = 1;
  } finally {
    if (pool) await pool.end();
  }
})();
