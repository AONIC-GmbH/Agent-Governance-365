require("dotenv").config();
const { ClientSecretCredential } = require("@azure/identity");

/**
 * Power BI Admin / Scanner API client (service principal).
 *
 * Config:
 *   Tenant: same as the rest of the app (PP_TENANT_ID || ENTRA_TENANT_ID) — not overridable
 *   PBI_CLIENT_ID
 *   PBI_CLIENT_SECRET
 *
 * Tenant must allow service principals to call Fabric/Power BI admin APIs.
 * Do not attach admin-consent Power BI delegated permissions to this app when using SP.
 */
const tenantId = process.env.PP_TENANT_ID || process.env.ENTRA_TENANT_ID;
const clientId = process.env.PBI_CLIENT_ID;
const clientSecret = process.env.PBI_CLIENT_SECRET;
const baseUrl = (process.env.PBI_API_BASE_URL || "https://api.powerbi.com").replace(/\/+$/, "");

const pbiEnabled =
  Boolean(tenantId && clientId && clientSecret) &&
  !String(tenantId).startsWith("your-") &&
  !String(clientId).startsWith("your-") &&
  !String(clientSecret).startsWith("your-");

const SCOPE = "https://analysis.windows.net/powerbi/api/.default";
const MAX_RETRIES = 5;
const SCAN_POLL_MS = 2000;
const SCAN_TIMEOUT_MS = 10 * 60 * 1000;

let credential = null;
function getCredential() {
  if (!credential) {
    credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  }
  return credential;
}

async function getAccessToken() {
  const token = await getCredential().getToken(SCOPE);
  if (!token?.token) throw new Error("Failed to acquire Power BI API token");
  return token.token;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pbiFetch(method, path, { body, attempt = 0 } = {}) {
  if (!pbiEnabled) {
    throw new Error(
      "Power BI integration is not configured (set PBI_CLIENT_ID / PBI_CLIENT_SECRET)"
    );
  }
  const accessToken = await getAccessToken();
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });

  if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitSec =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : Math.min(2 ** attempt, 30);
    await sleep(waitSec * 1000);
    return pbiFetch(method, path, { body, attempt: attempt + 1 });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Power BI API ${res.status}: ${detail.slice(0, 500)}`);
  }

  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

/** Workspace IDs modified recently, or all when modifiedSince is omitted. */
async function getModifiedWorkspaceIds({ excludePersonalWorkspaces = true } = {}) {
  const q = new URLSearchParams();
  if (excludePersonalWorkspaces) q.set("excludePersonalWorkspaces", "true");
  const data = await pbiFetch("GET", `/v1.0/myorg/admin/workspaces/modified?${q}`);
  // API may return a bare array of UUIDs or { workspaces: [{ id }] } depending on version.
  if (Array.isArray(data)) {
    return data.map((w) => (typeof w === "string" ? w : w?.id)).filter(Boolean);
  }
  const list = data?.workspaces || data?.value || [];
  return list.map((w) => (typeof w === "string" ? w : w?.id)).filter(Boolean);
}

async function postWorkspaceInfo(workspaceIds) {
  const q = new URLSearchParams({
    lineage: "false",
    datasourceDetails: "false",
    datasetSchema: "false",
    datasetExpressions: "false",
    getArtifactUsers: "false",
  });
  return pbiFetch("POST", `/v1.0/myorg/admin/workspaces/getInfo?${q}`, {
    body: { workspaces: workspaceIds },
  });
}

async function getScanStatus(scanId) {
  return pbiFetch("GET", `/v1.0/myorg/admin/workspaces/scanStatus/${scanId}`);
}

async function getScanResult(scanId) {
  return pbiFetch("GET", `/v1.0/myorg/admin/workspaces/scanResult/${scanId}`);
}

async function waitForScan(scanId, { timeoutMs = SCAN_TIMEOUT_MS, pollMs = SCAN_POLL_MS } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await getScanStatus(scanId);
    const state = status?.status;
    if (state === "Succeeded") return status;
    if (state === "Failed") {
      throw new Error(`Power BI workspace scan failed: ${JSON.stringify(status?.error || status)}`);
    }
    await sleep(pollMs);
  }
  throw new Error(`Power BI workspace scan timed out after ${timeoutMs}ms (${scanId})`);
}

/**
 * Scan a chunk of workspace IDs and return the scanResult payload.
 */
async function scanWorkspaces(workspaceIds) {
  if (!workspaceIds?.length) return { workspaces: [] };
  const started = await postWorkspaceInfo(workspaceIds);
  const scanId = started?.id;
  if (!scanId) throw new Error("Power BI getInfo did not return a scan id");
  await waitForScan(scanId);
  return getScanResult(scanId);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

module.exports = {
  pbiEnabled,
  getModifiedWorkspaceIds,
  scanWorkspaces,
  chunk,
  SCAN_CHUNK_SIZE: 100,
};
