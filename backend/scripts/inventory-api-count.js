require("dotenv").config();
const pp = require("../powerPlatform/client");

const RESOURCE_TYPES = {
  "microsoft.powerplatform/environments": "environment",
  "microsoft.powerapps/canvasapps": "canvasapp",
  "microsoft.powerapps/modeldrivenapps": "modeldrivenapp",
  "microsoft.powerautomate/cloudflows": "cloudflow",
  "microsoft.copilotstudio/agents": "agent",
};

function buildQueryBody() {
  return {
    TableName: "PowerPlatformResources",
    Clauses: [
      {
        $type: "where",
        FieldName: "type",
        Operator: "in~",
        Values: Object.keys(RESOURCE_TYPES).map((t) => `'${t}'`),
      },
    ],
    Options: { Top: 1000, Skip: 0, SkipToken: "" },
  };
}

(async () => {
  if (!pp.ppEnabled) throw new Error("PP inventory auth not configured");

  const byType = {};
  const byKind = {};
  let pages = 0;
  let total = 0;

  for await (const page of pp.queryAllPages(buildQueryBody())) {
    pages++;
    for (const rec of page) {
      total++;
      const rt = rec.type || "(unknown)";
      const kind = RESOURCE_TYPES[rt] || rt;
      byType[rt] = (byType[rt] || 0) + 1;
      byKind[kind] = (byKind[kind] || 0) + 1;
    }
    process.stdout.write(`\rPages: ${pages}, rows: ${total}`);
  }
  console.log("\n\n=== Inventory API (live count, no DB) ===");
  console.log("\nBy resource_type:");
  console.table(
    Object.entries(byType)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([resource_type, count]) => ({ resource_type, count }))
  );
  console.log("\nBy kind:");
  console.table(
    Object.entries(byKind)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([kind, count]) => ({ kind, count }))
  );
  console.log(`\nTotal: ${total} across ${pages} page(s)`);
})().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exitCode = 1;
});
