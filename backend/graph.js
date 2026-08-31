require("dotenv").config();
const { ClientSecretCredential } = require("@azure/identity");

// App-only (client credentials) access to Microsoft Graph for the directory
// people-picker. Requires the app registration to have the *Application*
// permission Microsoft Graph -> User.Read.All with admin consent granted, plus
// a client secret. Without a secret configured, directory features are disabled
// and callers should treat that as "no results".
const tenantId = process.env.ENTRA_TENANT_ID;
const clientId = process.env.ENTRA_CLIENT_ID;
const clientSecret = process.env.ENTRA_CLIENT_SECRET;

const graphEnabled =
  Boolean(tenantId && clientId && clientSecret) &&
  !String(tenantId).startsWith("your-") &&
  !String(clientId).startsWith("your-") &&
  !String(clientSecret).startsWith("your-");

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

let credential = null;
function getCredential() {
  if (!credential) {
    credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  }
  return credential;
}

// ClientSecretCredential caches tokens internally and refreshes near expiry.
async function getAccessToken() {
  const token = await getCredential().getToken(GRAPH_SCOPE);
  if (!token?.token) throw new Error("Failed to acquire Graph token");
  return token.token;
}

async function graphGet(path, { advancedQuery = false } = {}) {
  const accessToken = await getAccessToken();
  const headers = { Authorization: `Bearer ${accessToken}` };
  // $search and combined $filter require the eventual-consistency header.
  if (advancedQuery) headers.ConsistencyLevel = "eventual";
  const res = await fetch(`${GRAPH_BASE}${path}`, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Graph ${path} failed: ${res.status} ${body}`);
  }
  return res.json();
}

function mapUser(u) {
  return {
    id: u.id,
    full_name: u.displayName || u.userPrincipalName || u.mail || "Unknown",
    email: u.mail || u.userPrincipalName || "",
  };
}

// Escapes a user search term for use inside a Graph $search="field:term" clause.
function escapeSearchTerm(term) {
  return String(term).replace(/["\\]/g, "");
}

/**
 * Searches the tenant directory for enabled member users matching `q` on
 * display name or email. Returns up to `top` results as {id, full_name, email}.
 */
async function searchDirectoryUsers(q, top = 25) {
  const term = escapeSearchTerm((q || "").trim());
  const select = "id,displayName,mail,userPrincipalName";
  const filter = "accountEnabled eq true and userType eq 'Member'";
  const params = new URLSearchParams();
  params.set("$select", select);
  params.set("$top", String(top));
  params.set("$count", "true");
  params.set("$orderby", "displayName");
  if (term) {
    params.set("$search", `"displayName:${term}" OR "mail:${term}" OR "userPrincipalName:${term}"`);
  }
  params.set("$filter", filter);
  const data = await graphGet(`/users?${params.toString()}`, { advancedQuery: true });
  return (data.value || []).map(mapUser);
}

/** Fetches a single directory user by object id, or null if not found. */
async function getDirectoryUser(id) {
  try {
    const select = "id,displayName,mail,userPrincipalName";
    const data = await graphGet(`/users/${encodeURIComponent(id)}?$select=${select}`);
    return mapUser(data);
  } catch (err) {
    if (String(err.message).includes(" 404")) return null;
    throw err;
  }
}

module.exports = { graphEnabled, searchDirectoryUsers, getDirectoryUser };
