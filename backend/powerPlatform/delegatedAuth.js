const { PublicClientApplication } = require("@azure/msal-node");

// Delegated (refresh-token) auth for the Power Platform Inventory API.
// Bootstrap via device code (public client) — do NOT send client_secret on refresh;
// Entra returns AADSTS700025 if you use ConfidentialClientApplication here.
//
// Set PP_REFRESH_TOKEN in .env (local) or Key Vault (production).
const tenantId = process.env.PP_TENANT_ID || process.env.ENTRA_TENANT_ID;
const clientId = process.env.PP_INVENTORY_CLIENT_ID || process.env.PP_CLIENT_ID;
const refreshToken = process.env.PP_REFRESH_TOKEN;
const scopes = ["https://api.powerplatform.com/.default"];

const delegatedEnabled =
  Boolean(tenantId && clientId && refreshToken) &&
  !String(clientId).startsWith("your-");

let pca = null;
function getClient() {
  if (!pca) {
    pca = new PublicClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
      },
    });
  }
  return pca;
}

async function getDelegatedAccessToken() {
  if (!delegatedEnabled) {
    throw new Error(
      "Delegated PP inventory auth is not configured (set PP_INVENTORY_CLIENT_ID and PP_REFRESH_TOKEN)"
    );
  }
  const result = await getClient().acquireTokenByRefreshToken({
    refreshToken,
    scopes,
  });
  if (!result?.accessToken) throw new Error("Failed to acquire delegated Power Platform API token");
  return result.accessToken;
}

module.exports = { delegatedEnabled, getDelegatedAccessToken };
