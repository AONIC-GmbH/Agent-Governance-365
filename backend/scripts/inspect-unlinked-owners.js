require("dotenv").config();
const { pool, query } = require("../db");
const dv = require("../dataverse/client");

// Samples inventory owner_aad_id values that do NOT join to profiles and
// compares them to CoE admin_makers (makerid vs recordguidasstring vs UPN).
(async () => {
  try {
    const unlinked = await query(
      `SELECT i.owner_aad_id, count(*) AS cnt
         FROM inventory_items i
         LEFT JOIN profiles p ON p.id = i.owner_aad_id
        WHERE i.owner_aad_id IS NOT NULL AND p.id IS NULL
        GROUP BY i.owner_aad_id
        ORDER BY cnt DESC
        LIMIT 5`
    );
    console.log("Top unlinked owner_aad_id values (no matching profile):\n");

    for (const row of unlinked.rows) {
      const id = row.owner_aad_id;
      console.log(`--- owner_aad_id=${id} (${row.cnt} items) ---`);
      try {
        const json = await dv.dvFetch(
          `${dv.orgUrl}/api/data/v9.2/admin_makers(${id})` +
            `?$select=admin_makerid,admin_recordguidasstring,admin_userprincipalname,admin_useremail,admin_displayname`
        );
        console.log(
          `  makerid=${json.admin_makerid}\n` +
            `  recordguidasstring=${json.admin_recordguidasstring}\n` +
            `  upn=${json.admin_userprincipalname}\n` +
            `  email=${json.admin_useremail}\n` +
            `  name=${json.admin_displayname}\n` +
            `  makerid==email oid? ${json.admin_makerid === json.admin_recordguidasstring}`
        );
      } catch (e) {
        console.log(`  (no admin_makers row: ${e.message})`);
      }
    }
  } catch (e) {
    console.error("FAILED:", e.message);
    process.exitCode = 1;
  } finally {
    if (pool) await pool.end();
  }
})();
