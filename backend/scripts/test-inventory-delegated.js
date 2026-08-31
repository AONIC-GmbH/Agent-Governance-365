require("dotenv").config();
const pp = require("../powerPlatform/client");

// Smoke test for delegated inventory API auth (no Key Vault required — uses .env).
(async () => {
  try {
    const body = {
      TableName: "PowerPlatformResources",
      Clauses: [{ $type: "take", TakeCount: 5 }],
      Options: { Top: 5, Skip: 0, SkipToken: "" },
    };
    const result = await pp.queryResources(body);
    const rows = result.data || [];
    console.log(`OK: ${rows.length} row(s) returned`);
    rows.forEach((r) => console.log(`  - ${r.type}: ${r.properties?.displayName || r.name}`));
  } catch (e) {
    console.error("FAILED:", e.message);
    process.exitCode = 1;
  }
})();
