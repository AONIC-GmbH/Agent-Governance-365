require("dotenv").config();
const dv = require("../dataverse/client");

// Lists Dataverse tables (entity sets) whose names hint at the resource types
// we care about, to discover the correct CoE table names for this environment.
const KEYWORDS = ["bot", "copilot", "agent", "chat", "environment", "app", "flow"];

(async () => {
  if (!dv.dataverseEnabled) {
    console.error("Dataverse not configured (set DATAVERSE_URL).");
    process.exit(1);
  }
  try {
    const json = await dv.dvFetch(
      `${dv.orgUrl}/api/data/v9.2/EntityDefinitions?$select=LogicalName,EntitySetName`
    );
    const all = json.value || [];
    const matches = all
      .filter((e) => {
        const n = (e.LogicalName || "").toLowerCase();
        return n.startsWith("admin_") && KEYWORDS.some((k) => n.includes(k));
      })
      .map((e) => `${e.LogicalName}  ->  ${e.EntitySetName}`)
      .sort();
    console.log(`Total tables: ${all.length}\nCoE matches:`);
    matches.forEach((m) => console.log("  " + m));
  } catch (e) {
    console.error("FAILED:", e.message);
    process.exitCode = 1;
  }
})();
