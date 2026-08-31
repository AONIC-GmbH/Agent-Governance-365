require("dotenv").config();
const { pool, query } = require("../db");

const label = process.argv[2] || "inventory counts";

(async () => {
  const byType = await query(
    `SELECT resource_type,
            count(*)::int AS total,
            count(*) FILTER (WHERE is_active)::int AS active
       FROM inventory_items
      GROUP BY resource_type
      ORDER BY resource_type`
  );
  const byKind = await query(
    `SELECT kind,
            count(*)::int AS total,
            count(*) FILTER (WHERE is_active)::int AS active
       FROM inventory_items
      GROUP BY kind
      ORDER BY kind`
  );
  const components = await query(
    `SELECT count(*)::int AS total,
            count(source_inventory_id)::int AS with_source_link
       FROM components`
  );

  console.log(`\n=== ${label} ===`);
  console.log("\nBy resource_type:");
  console.table(byType.rows);
  console.log("\nBy kind:");
  console.table(byKind.rows);
  console.log("\nComponents:");
  console.table(components.rows);
})()
  .catch((e) => {
    console.error("FAILED:", e.message);
    process.exitCode = 1;
  })
  .finally(() => pool?.end());
