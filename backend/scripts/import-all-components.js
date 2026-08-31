require("dotenv").config();
const { pool, query } = require("../db");
const dv = require("../dataverse/client");

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || "t1";
const TENANT_ID = process.env.DEFAULT_TENANT_ID || "t1";

const TYPE_BY_KIND = {
  canvasapp: "Power App",
  modeldrivenapp: "Power App",
  cloudflow: "Power Automate",
  agent: "Copilot Agent",
};

const COMPONENT_KINDS = Object.keys(TYPE_BY_KIND);

function isEmail(value) {
  return typeof value === "string" && value.includes("@") && !value.includes(" ");
}

async function loadCoEMakers() {
  const makers = new Map();
  if (!dv.dataverseEnabled) return makers;

  let url =
    `${dv.orgUrl}/api/data/v9.2/admin_makers` +
    `?$select=admin_makerid,admin_recordguidasstring,admin_userprincipalname,admin_useremail,admin_displayname,admin_userisserviceprinciple`;
  while (url) {
    const json = await dv.dvFetch(url);
    for (const m of json.value || []) {
      const entraOid = m.admin_recordguidasstring || m.admin_makerid;
      if (!entraOid) continue;
      makers.set(String(entraOid).toLowerCase(), m);
      if (m.admin_makerid) makers.set(String(m.admin_makerid).toLowerCase(), m);
    }
    url = json["@odata.nextLink"] || null;
  }
  return makers;
}

async function ensureProfilesFromMakers(makers) {
  let created = 0;
  const seen = new Set();
  for (const m of makers.values()) {
    const entraOid = m.admin_recordguidasstring || m.admin_makerid;
    if (!entraOid || seen.has(entraOid)) continue;
    seen.add(entraOid);
    const email = (m.admin_useremail || m.admin_userprincipalname || "").toLowerCase();
    if (!email) continue;

    const { rowCount } = await query(
      `INSERT INTO profiles (id, tenant_id, full_name, email)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [entraOid, DEFAULT_TENANT_ID, m.admin_displayname || email, email]
    );
    created += rowCount;
  }
  return created;
}

// One-time bulk import: all active apps/flows/agents -> components. Idempotent.
(async () => {
  try {
    console.log("Loading CoE makers for profile provisioning...");
    const makers = await loadCoEMakers();
    console.log(`CoE makers: ${makers.size}`);

    const profilesCreated = await ensureProfilesFromMakers(makers);
    console.log(`Profiles provisioned from CoE: ${profilesCreated} new`);

    const { rows: profileRows } = await query("SELECT id, lower(email) AS email FROM profiles");
    const profileById = new Map(profileRows.map((p) => [p.id.toLowerCase(), p.id]));
    const profileByEmail = new Map(profileRows.filter((p) => p.email).map((p) => [p.email, p.id]));

    // Re-read profiles after provisioning
    if (profilesCreated > 0) {
      const { rows: refreshed } = await query("SELECT id, lower(email) AS email FROM profiles");
      profileById.clear();
      profileByEmail.clear();
      for (const p of refreshed) {
        profileById.set(p.id.toLowerCase(), p.id);
        if (p.email) profileByEmail.set(p.email, p.id);
      }
    }

    const envs = await query(
      "SELECT resource_id, display_name FROM inventory_items WHERE kind = 'environment'"
    );
    const envName = new Map(envs.rows.map((e) => [e.resource_id, e.display_name]));

    const items = await query(
      `SELECT id, kind, display_name, environment_id, owner_aad_id, owner_external, tenant_id
         FROM inventory_items
        WHERE is_active = true AND kind = ANY($1)
        ORDER BY kind, display_name`,
      [COMPONENT_KINDS]
    );
    console.log(`Inventory items to import: ${items.rows.length}`);

    let inserted = 0;
    let skipped = 0;
    let noOwner = 0;

    for (const it of items.rows) {
      let ownerId =
        (it.owner_aad_id && profileById.get(String(it.owner_aad_id).toLowerCase())) ||
        (isEmail(it.owner_external) && profileByEmail.get(it.owner_external.toLowerCase())) ||
        null;

      if (!ownerId && it.owner_aad_id) {
        const maker = makers.get(String(it.owner_aad_id).toLowerCase());
        const entraOid = maker?.admin_recordguidasstring || maker?.admin_makerid;
        if (entraOid) ownerId = profileById.get(String(entraOid).toLowerCase()) || null;
      }

      if (!ownerId) noOwner++;

      const compId = `c-${it.id}`;
      const type = TYPE_BY_KIND[it.kind] || it.kind;
      const envLabel = it.environment_id ? [envName.get(it.environment_id) || it.environment_id] : [];
      const tenantId = it.tenant_id || TENANT_ID;

      const { rowCount } = await query(
        `INSERT INTO components (id, tenant_id, name, type, environments, owner_id, status, url, source_inventory_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'unassigned', '', $7)
         ON CONFLICT (id) DO NOTHING`,
        [compId, tenantId, it.display_name || "(unnamed)", type, envLabel, ownerId, it.id]
      );
      if (rowCount) inserted++;
      else skipped++;
    }

    const total = await query("SELECT count(*) FROM components");
    console.log(`\nDone.`);
    console.log(`  Inserted:  ${inserted}`);
    console.log(`  Skipped:   ${skipped} (already existed)`);
    console.log(`  No owner:  ${noOwner} (imported with owner_id = null)`);
    console.log(`  Total components in DB: ${total.rows[0].count}`);
  } catch (e) {
    console.error("FAILED:", e.message);
    process.exitCode = 1;
  } finally {
    if (pool) await pool.end();
  }
})();
