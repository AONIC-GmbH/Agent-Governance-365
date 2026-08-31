require("dotenv").config();
const { ClientSecretCredential } = require("@azure/identity");

// Checks whether the "Power Platform API" first-party service principal exposes
// ResourceQuery.Resources.Read as an APPLICATION app role (app-only capable) vs
// a delegated-only oauth2 scope. Needs Graph Directory/Application.Read on the SP.
const tenantId = process.env.PP_TENANT_ID || process.env.ENTRA_TENANT_ID;
const clientId = process.env.PP_CLIENT_ID;
const clientSecret = process.env.PP_CLIENT_SECRET;

// Power Platform API first-party app
const PP_API_APPID = "8578e004-a5c6-46e7-913e-12f58912df43";

(async () => {
  const cred = new ClientSecretCredential(tenantId, clientId, clientSecret);
  let token;
  try {
    token = (await cred.getToken("https://graph.microsoft.com/.default")).token;
  } catch (e) {
    console.log("Could not get Graph token:", e.message);
    return;
  }

  const url =
    `https://graph.microsoft.com/v1.0/servicePrincipals(appId='${PP_API_APPID}')` +
    `?$select=appDisplayName,appRoles,oauth2PermissionScopes`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    console.log(`Graph read failed: ${res.status} ${await res.text()}`);
    console.log("\n(If 403, the SP lacks Graph Application.Read.All — check via Azure Portal instead.)");
    return;
  }
  const sp = await res.json();
  console.log("Service principal:", sp.appDisplayName);

  const rq = (sp.appRoles || []).filter((r) => /resourcequery|resources/i.test(r.value || ""));
  console.log("\n=== APPLICATION app roles matching ResourceQuery ===");
  if (rq.length === 0) console.log("(none found as application app roles)");
  for (const r of rq) {
    console.log(`- value=${r.value}  allowedMemberTypes=${JSON.stringify(r.allowedMemberTypes)}  id=${r.id}`);
  }

  const scopes = (sp.oauth2PermissionScopes || []).filter((s) => /resourcequery|resources/i.test(s.value || ""));
  console.log("\n=== DELEGATED scopes matching ResourceQuery ===");
  for (const s of scopes) console.log(`- value=${s.value}  id=${s.id}`);
})();
