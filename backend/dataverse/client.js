require("dotenv").config();
const { ClientSecretCredential } = require("@azure/identity");

const API_PATH = "/api/data/v9.2";
const MAX_RETRIES = 5;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Build a Dataverse Web API client for a specific org.
 * Used for CoE (DATAVERSE_*) and Copilot Agent Kit (COPILOT_KIT_DATAVERSE_*).
 */
function createDataverseClient({
  orgUrl: rawOrgUrl,
  tenantId,
  clientId,
  clientSecret,
  label = "Dataverse",
} = {}) {
  const orgUrl = String(rawOrgUrl || "").replace(/\/+$/, "");
  const enabled =
    Boolean(tenantId && clientId && clientSecret && orgUrl) &&
    orgUrl.startsWith("https://") &&
    !orgUrl.startsWith("https://your");

  let credential = null;
  function getCredential() {
    if (!credential) {
      credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    }
    return credential;
  }

  async function getAccessToken() {
    const token = await getCredential().getToken(`${orgUrl}/.default`);
    if (!token?.token) throw new Error(`Failed to acquire ${label} token`);
    return token.token;
  }

  async function dvFetch(absoluteUrl, attempt = 0) {
    if (!enabled) throw new Error(`${label} integration is not configured`);
    const accessToken = await getAccessToken();
    const res = await fetch(absoluteUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        Prefer: 'odata.maxpagesize=5000,odata.include-annotations="*"',
      },
    });

    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitSec =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : Math.min(2 ** attempt, 30);
      await sleep(waitSec * 1000);
      return dvFetch(absoluteUrl, attempt + 1);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const err = new Error(`${label} ${res.status}: ${detail.slice(0, 500)}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  async function* getAllRows(entitySet) {
    let url = `${orgUrl}${API_PATH}/${entitySet}`;
    while (url) {
      const json = await dvFetch(url);
      yield json.value || [];
      url = json["@odata.nextLink"] || null;
    }
  }

  return {
    enabled,
    orgUrl,
    getAccessToken,
    dvFetch,
    getAllRows,
    label,
  };
}

function envCreds(prefix) {
  const tenantId =
    process.env[`${prefix}_TENANT_ID`] ||
    process.env.DATAVERSE_TENANT_ID ||
    process.env.PP_TENANT_ID ||
    process.env.ENTRA_TENANT_ID;
  const clientId =
    process.env[`${prefix}_CLIENT_ID`] ||
    process.env.DATAVERSE_CLIENT_ID ||
    process.env.PP_CLIENT_ID;
  const clientSecret =
    process.env[`${prefix}_CLIENT_SECRET`] ||
    process.env.DATAVERSE_CLIENT_SECRET ||
    process.env.PP_CLIENT_SECRET;
  return { tenantId, clientId, clientSecret };
}

// CoE Starter Kit environment (legacy DATAVERSE_* vars).
const coe = createDataverseClient({
  orgUrl: process.env.DATAVERSE_URL,
  ...envCreds("DATAVERSE"),
  label: "Dataverse/CoE",
});

// Copilot Agent Kit environment (usage history). Falls back to DATAVERSE_* credentials
// but requires its own org URL.
const kit = createDataverseClient({
  orgUrl: process.env.COPILOT_KIT_DATAVERSE_URL || "",
  tenantId:
    process.env.COPILOT_KIT_DATAVERSE_TENANT_ID ||
    process.env.DATAVERSE_TENANT_ID ||
    process.env.PP_TENANT_ID ||
    process.env.ENTRA_TENANT_ID,
  clientId:
    process.env.COPILOT_KIT_DATAVERSE_CLIENT_ID ||
    process.env.DATAVERSE_CLIENT_ID ||
    process.env.PP_CLIENT_ID,
  clientSecret:
    process.env.COPILOT_KIT_DATAVERSE_CLIENT_SECRET ||
    process.env.DATAVERSE_CLIENT_SECRET ||
    process.env.PP_CLIENT_SECRET,
  label: "Dataverse/CopilotKit",
});

// Backward-compatible CoE exports used by coeSync.js
module.exports = {
  createDataverseClient,
  coe,
  kit,
  dataverseEnabled: coe.enabled,
  orgUrl: coe.orgUrl,
  getAccessToken: coe.getAccessToken,
  dvFetch: coe.dvFetch,
  getAllRows: coe.getAllRows,
};
