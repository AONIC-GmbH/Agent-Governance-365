/**
 * Smoke-test Power BI Admin Scanner API credentials (no secrets printed).
 * Usage: node scripts/test-powerbi-api.js
 */
require("dotenv").config();
const pbi = require("../powerBi/client");
const { ClientSecretCredential } = require("@azure/identity");

const tenantId = process.env.PP_TENANT_ID || process.env.ENTRA_TENANT_ID;
const clientId = process.env.PBI_CLIENT_ID;
const clientSecret = process.env.PBI_CLIENT_SECRET;
const SCOPE = "https://analysis.windows.net/powerbi/api/.default";

async function main() {
  console.log("pbiEnabled:", pbi.pbiEnabled);
  if (!pbi.pbiEnabled) {
    console.error("PBI not configured — set PBI_CLIENT_ID / PBI_CLIENT_SECRET and tenant.");
    process.exit(1);
  }

  console.log("1) Acquiring token for", SCOPE);
  try {
    const cred = new ClientSecretCredential(tenantId, clientId, clientSecret);
    const token = await cred.getToken(SCOPE);
    console.log("   OK — token acquired, expires:", token.expiresOnTimestamp
      ? new Date(token.expiresOnTimestamp).toISOString()
      : "(unknown)");
  } catch (err) {
    console.error("   FAIL — token:", err.message);
    process.exit(1);
  }

  console.log("2) GET /v1.0/myorg/admin/workspaces/modified?excludePersonalWorkspaces=true");
  try {
    const ids = await pbi.getModifiedWorkspaceIds({ excludePersonalWorkspaces: true });
    console.log("   OK — workspace count:", ids.length);
    if (ids.length) console.log("   sample id:", ids[0]);
  } catch (err) {
    console.error("   FAIL — modified workspaces:", err.message);
    process.exit(1);
  }

  console.log("3) Scanner getInfo on first workspace (if any)");
  try {
    const ids = await pbi.getModifiedWorkspaceIds({ excludePersonalWorkspaces: true });
    if (!ids.length) {
      console.log("   SKIP — no workspaces returned");
      process.exit(0);
    }
    const result = await pbi.scanWorkspaces(ids.slice(0, 1));
    const ws = result?.workspaces?.[0];
    console.log("   OK — scan completed");
    console.log("   workspace:", ws?.name || ws?.id || "(none)");
    console.log("   reports:", (ws?.reports || []).length);
    console.log("   dashboards:", (ws?.dashboards || []).length);
  } catch (err) {
    console.error("   FAIL — scan:", err.message);
    process.exit(1);
  }

  console.log("All Power BI API checks passed.");
}

main().catch((err) => {
  console.error("Unexpected:", err);
  process.exit(1);
});
