require("dotenv").config();
const dv = require("../dataverse/client");

// Usage: node scripts/get-entity.js <logicalName>
// Prints the Web API entity-set name + key attributes for a Dataverse table.
const logicalName = process.argv[2] || "admin_pva";

(async () => {
  if (!dv.dataverseEnabled) {
    console.error("Dataverse not configured.");
    process.exit(1);
  }
  try {
    const json = await dv.dvFetch(
      `${dv.orgUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${logicalName}')` +
        `?$select=LogicalName,EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute`
    );
    console.log({
      LogicalName: json.LogicalName,
      EntitySetName: json.EntitySetName,
      PrimaryIdAttribute: json.PrimaryIdAttribute,
      PrimaryNameAttribute: json.PrimaryNameAttribute,
    });
  } catch (e) {
    console.error("FAILED:", e.message);
    process.exitCode = 1;
  }
})();
