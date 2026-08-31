require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { PublicClientApplication } = require("@azure/msal-node");

// One-time bootstrap: sign in as the inventory sync user (device code) and
// obtain a refresh token for unattended inventory_sync (delegated auth).
//
// Prereqs on app registration runpipe-v2-dev-powerplatform-sync:
//   - Authentication → Allow public client flows = Yes
//   - API permission → Power Platform API → Delegated → Query resources
//   - User must accept consent on the device-code login screen (even when admin
//     consent is not required for the permission itself)
//
// Usage (from backend/):
//   PP_TENANT_ID=... PP_INVENTORY_CLIENT_ID=... node scripts/bootstrap-inventory-token.js
const tenantId = process.env.PP_TENANT_ID || process.env.ENTRA_TENANT_ID;
const clientId = process.env.PP_INVENTORY_CLIENT_ID || process.env.PP_CLIENT_ID;
// offline_access is required for Entra to issue a refresh token
const scopes = ["https://api.powerplatform.com/.default", "offline_access"];

if (!tenantId || !clientId) {
  console.error("Set PP_TENANT_ID and PP_INVENTORY_CLIENT_ID (or PP_CLIENT_ID) in .env");
  process.exit(1);
}

const pca = new PublicClientApplication({
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
  },
});

// Newer MSAL versions may omit result.refreshToken and store it in the cache only.
function refreshTokenFromCache(app) {
  try {
    const cache = JSON.parse(app.getTokenCache().serialize());
    const entries = Object.values(cache.RefreshToken || {});
    if (entries.length) return entries[0].secret || null;
  } catch {
    // fall through
  }
  return null;
}

(async () => {
  try {
    console.log("Sign in as the inventory sync user when prompted.");
    console.log("On the consent screen, accept permissions for this app.\n");

    const result = await pca.acquireTokenByDeviceCode({
      scopes,
      deviceCodeCallback: (info) => {
        console.log(info.message);
      },
    });

    const refreshToken = result?.refreshToken || refreshTokenFromCache(pca);

    if (!refreshToken) {
      console.error("No refresh token returned.");
      console.error("Checklist:");
      console.error("  - Authentication → Allow public client flows = Yes");
      console.error("  - Sign in completed and consent accepted on the device-code page");
      console.error("  - PP_INVENTORY_CLIENT_ID matches runpipe-v2-dev-powerplatform-sync");
      console.error("  - Power Platform API delegated Query resources is granted for this user");
      if (result?.accessToken) {
        console.error("\nAccess token WAS issued — login worked; only refresh token is missing.");
        console.error("Retry after confirming offline_access (this script now requests it).");
      }
      process.exit(1);
    }

    console.log("\n=== SUCCESS ===");
    console.log("Account:", result.account?.username);
    console.log("Expires (access token):", result.expiresOn?.toISOString?.() || result.expiresOn);
    console.log("\n--- REFRESH TOKEN (store in Key Vault or PP_REFRESH_TOKEN in .env) ---\n");
    console.log(refreshToken);
    console.log("\n--- end token ---\n");

    const outFile = path.join(__dirname, "..", ".pp-refresh-token");
    fs.writeFileSync(outFile, refreshToken, "utf8");
    console.log(`Also written to ${outFile} (gitignored). Delete after storing securely.`);
  } catch (e) {
    console.error("FAILED:", e.message);
    process.exitCode = 1;
  }
})();
