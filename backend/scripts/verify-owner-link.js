require("dotenv").config();
const { pool, query } = require("../db");
const dv = require("../dataverse/client");

// Compares runpipe profiles.id (Entra oid from JWT) with CoE owner lookup GUIDs.
const email = String(process.argv[2] || "")
  .trim()
  .toLowerCase();
if (!email) {
  console.error("Usage: node scripts/verify-owner-link.js <email>");
  process.exit(1);
}

(async () => {
  try {
    const prof = await query(
      "SELECT id, email, full_name FROM profiles WHERE lower(email) = $1",
      [email]
    );
    const profile = prof.rows[0];
    console.log("Runpipe profile:", profile || "(not found)");

    if (dv.dataverseEnabled) {
      const json = await dv.dvFetch(
        `${dv.orgUrl}/api/data/v9.2/admin_makers?$top=1&$filter=admin_userprincipalname eq '${email}'`
      );
      const maker = (json.value || [])[0];
      if (maker) {
        console.log("\nCoE admin_makers row keys:", Object.keys(maker).sort().join(", "));
        console.log("\nCoE maker fields:");
        for (const [k, v] of Object.entries(maker)) {
          if (/id|object|aad|azure|entra|principal|email|upn|guid/i.test(k)) {
            console.log(`  ${k} = ${v}`);
          }
        }
        if (profile) {
          console.log("\nMatch check:");
          console.log(`  profiles.id == admin_makerid?  ${profile.id === maker.admin_makerid}`);
        }
      } else {
        console.log("\nNo CoE maker row for", email);
      }
    }

    if (profile) {
      const inv = await query(
        `SELECT count(*) AS cnt FROM inventory_items WHERE owner_aad_id = $1`,
        [profile.id]
      );
      console.log(`\nInventory items with owner_aad_id = profiles.id (${profile.id}): ${inv.rows[0].cnt}`);

      const inv2 = await query(
        `SELECT owner_aad_id, count(*) AS cnt
           FROM inventory_items
          WHERE lower(owner_external) LIKE $1 OR owner_aad_id IS NOT NULL
          GROUP BY owner_aad_id
          ORDER BY cnt DESC
          LIMIT 5`,
        [`%${email.split("@")[0]}%`]
      );
      console.log("\nSample owner_aad_id values for similar owners:");
      console.table(inv2.rows);
    }
  } catch (e) {
    console.error("FAILED:", e.message);
    process.exitCode = 1;
  } finally {
    if (pool) await pool.end();
  }
})();
