require("dotenv").config();
const { ClientSecretCredential } = require("@azure/identity");

// Diagnoses whether the SP's Power Platform RBAC role is honored on
// api.powerplatform.com at all, vs. the inventory endpoint being special.
// Uses the app-only token to hit a few Reader-gated endpoints.
const tenantId = process.env.PP_TENANT_ID || process.env.ENTRA_TENANT_ID;
const clientId = process.env.PP_CLIENT_ID;
const clientSecret = process.env.PP_CLIENT_SECRET;
const V = "api-version=2024-10-01";

async function call(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 300) };
}

(async () => {
  const cred = new ClientSecretCredential(tenantId, clientId, clientSecret);
  const tok = (await cred.getToken("https://api.powerplatform.com/.default")).token;

  const tests = [
    ["GET ", `https://api.powerplatform.com/authorization/roleAssignments?${V}`, null],
    ["GET ", `https://api.powerplatform.com/licensing/billingPolicies?${V}`, null],
    [
      "POST",
      `https://api.powerplatform.com/resourcequery/resources/query?${V}`,
      { TableName: "PowerPlatformResources", Clauses: [], Options: { Top: 1, Skip: 0, SkipToken: "" } },
    ],
  ];

  for (const [method, url, body] of tests) {
    const r = await call(tok, method.trim(), url, body);
    const path = url.replace("https://api.powerplatform.com", "").split("?")[0];
    console.log(`${method} ${path}\n  -> ${r.status}  ${r.body}\n`);
  }
})();
