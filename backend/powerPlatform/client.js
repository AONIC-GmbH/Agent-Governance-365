require("dotenv").config();
const { ClientSecretCredential } = require("@azure/identity");
const delegated = require("./delegatedAuth");

// Power Platform Inventory API client. Supports:
//   PP_INVENTORY_AUTH=delegated  → refresh token (inventory API; recommended)
//   (default / legacy)           → app-only client credentials (403 on resourcequery)
//
// Config (see backend/.env.example):
//   PP_TENANT_ID, PP_API_BASE_URL
// Delegated: PP_INVENTORY_CLIENT_ID, PP_INVENTORY_CLIENT_SECRET, PP_REFRESH_TOKEN
// App-only:  PP_CLIENT_ID, PP_CLIENT_SECRET
const tenantId = process.env.PP_TENANT_ID || process.env.ENTRA_TENANT_ID;
const clientId = process.env.PP_CLIENT_ID;
const clientSecret = process.env.PP_CLIENT_SECRET;
const baseUrl = (process.env.PP_API_BASE_URL || "https://api.powerplatform.com").replace(/\/+$/, "");

const useDelegated = process.env.PP_INVENTORY_AUTH === "delegated";

const spEnabled =
  Boolean(tenantId && clientId && clientSecret) &&
  !String(tenantId).startsWith("your-") &&
  !String(clientId).startsWith("your-") &&
  !String(clientSecret).startsWith("your-");

const ppEnabled = useDelegated ? delegated.delegatedEnabled : spEnabled;

const SCOPE = "https://api.powerplatform.com/.default";
const API_VERSION = "2024-10-01";
const MAX_RETRIES = 5;

let credential = null;
function getCredential() {
  if (!credential) {
    credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  }
  return credential;
}

// ClientSecretCredential caches tokens internally and refreshes near expiry.
async function getAccessToken() {
  if (useDelegated) return delegated.getDelegatedAccessToken();
  const token = await getCredential().getToken(SCOPE);
  if (!token?.token) throw new Error("Failed to acquire Power Platform API token");
  return token.token;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// POST a single Resource Graph query to the inventory API, with retry/backoff on
// 429 (throttling, honoring Retry-After) and transient 5xx responses.
async function queryResources(body, attempt = 0) {
  if (!ppEnabled) {
    throw new Error(
      useDelegated
        ? "Delegated PP inventory auth is not configured (PP_INVENTORY_CLIENT_ID, PP_REFRESH_TOKEN)"
        : "Power Platform integration is not configured"
    );
  }
  const accessToken = await getAccessToken();
  const url = `${baseUrl}/resourcequery/resources/query?api-version=${API_VERSION}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitSec = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : Math.min(2 ** attempt, 30);
    await sleep(waitSec * 1000);
    return queryResources(body, attempt + 1);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Inventory API ${res.status}: ${detail.slice(0, 500)}`);
  }
  return res.json();
}

// Async generator that walks all pages of a PowerPlatformResources query.
// Uses Options.Skip offset paging — skipToken from this API currently returns
// the same page when passed back (verified 2026-07). Stops when a page is
// empty, shorter than Top, or Skip reaches totalRecords.
async function* queryAllPages(baseBody) {
  const top = baseBody.Options?.Top || 1000;
  let skip = baseBody.Options?.Skip || 0;
  let totalRecords = null;

  while (true) {
    const body = {
      ...baseBody,
      Options: { Top: top, Skip: skip, SkipToken: "" },
    };
    const result = await queryResources(body);
    const data = result.data || [];
    if (typeof result.totalRecords === "number") totalRecords = result.totalRecords;

    if (data.length) yield data;

    skip += data.length;
    if (!data.length || data.length < top) break;
    if (totalRecords != null && skip >= totalRecords) break;
  }
}

module.exports = { ppEnabled, baseUrl, queryResources, queryAllPages };
