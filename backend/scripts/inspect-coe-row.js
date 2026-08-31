require("dotenv").config();
const dv = require("../dataverse/client");

// Usage: node scripts/inspect-coe-row.js <entitySet>
// Dumps column names of one row plus values for env/owner/maker-ish columns.
const entitySet = process.argv[2] || "admin_pvas";
const VALUE_HINTS = ["environment", "owner", "maker", "email", "createdby", "createdon", "modifiedon", "region", "location", "displayname", "name"];

(async () => {
  if (!dv.dataverseEnabled) {
    console.error("Dataverse not configured.");
    process.exit(1);
  }
  try {
    const json = await dv.dvFetch(`${dv.orgUrl}/api/data/v9.2/${entitySet}?$top=1`);
    const row = (json.value || [])[0];
    if (!row) {
      console.log(`${entitySet}: no rows`);
      return;
    }
    console.log(`=== ${entitySet} columns ===`);
    console.log(Object.keys(row).sort().join("\n"));
    console.log(`\n--- relevant values ---`);
    for (const key of Object.keys(row).sort()) {
      const k = key.toLowerCase();
      if (VALUE_HINTS.some((h) => k.includes(h))) console.log(`${key} = ${JSON.stringify(row[key])}`);
    }
  } catch (e) {
    console.error("FAILED:", e.message);
    process.exitCode = 1;
  }
})();
