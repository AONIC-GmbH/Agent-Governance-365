require("dotenv").config();
const dv = require("../dataverse/client");

// Usage: node scripts/find-maker.js <substring>
// Searches CoE admin_makers by display name or UPN substring.
const term = String(process.argv[2] || "")
  .trim()
  .toLowerCase();
if (!term) {
  console.error("Usage: node scripts/find-maker.js <substring>");
  process.exit(1);
}

(async () => {
  if (!dv.dataverseEnabled) return console.error("Dataverse not configured.");
  try {
    const json = await dv.dvFetch(
      `${dv.orgUrl}/api/data/v9.2/admin_makers` +
        `?$select=admin_makerid,admin_userprincipalname,admin_useremail,admin_displayname` +
        `&$filter=contains(admin_userprincipalname,'${term}') or contains(admin_displayname,'${term}')`
    );
    const rows = json.value || [];
    if (!rows.length) return console.log(`No makers matching "${term}".`);
    rows.forEach((m) =>
      console.log(
        `oid=${m.admin_makerid}  upn=${m.admin_userprincipalname}  email=${m.admin_useremail}  name=${m.admin_displayname}`
      )
    );
  } catch (e) {
    console.error("FAILED:", e.message);
    process.exitCode = 1;
  }
})();
