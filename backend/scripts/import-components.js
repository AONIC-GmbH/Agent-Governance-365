require("dotenv").config();
const { pool, query } = require("./../db");
const dv = require("../dataverse/client");

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || "t1";

// If the user has no runpipe profile yet, provision one from CoE maker data so
// components.owner_id (FK -> profiles.id) can reference them. profiles.id is the
// Entra Object ID (admin_recordguidasstring, falling back to admin_makerid).
async function fetchMakerByEmail(email) {
  const json = await dv.dvFetch(
    `${dv.orgUrl}/api/data/v9.2/admin_makers` +
      `?$select=admin_makerid,admin_recordguidasstring,admin_userprincipalname,admin_useremail,admin_displayname` +
      `&$filter=admin_userprincipalname eq '${email}' or admin_useremail eq '${email}'`
  );
  return (json.value || [])[0] || null;
}

function makerEntraOid(maker) {
  return maker?.admin_recordguidasstring || maker?.admin_makerid || null;
}

async function ensureProfileFromMaker(email) {
  const maker = await fetchMakerByEmail(email);
  if (!maker) return null;
  const entraOid = makerEntraOid(maker);
  if (!entraOid) return null;
  await query(
    `INSERT INTO profiles (id, tenant_id, full_name, email)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email`,
    [entraOid, DEFAULT_TENANT_ID, maker.admin_displayname || email, maker.admin_useremail || email]
  );
  const { rows } = await query(
    "SELECT id, tenant_id, full_name, email FROM profiles WHERE id = $1",
    [entraOid]
  );
  return rows[0];
}

// Collects every oid that might appear in inventory_items.owner_aad_id for this user.
async function resolveOwnerOids(profile, email) {
  const oids = new Set([profile.id]);
  if (dv.dataverseEnabled) {
    const maker = await fetchMakerByEmail(email);
    const entraOid = makerEntraOid(maker);
    if (entraOid) oids.add(entraOid);
    if (maker?.admin_makerid) oids.add(maker.admin_makerid);
  }
  return [...oids];
}

// Imports a user's owned inventory_items into the curated `components` table,
// linked back via source_inventory_id. Idempotent: a deterministic component
// id (c-<inventory_id>) + ON CONFLICT DO NOTHING means re-runs don't duplicate.
//
// Usage: node scripts/import-components.js <email>
const email = String(process.argv[2] || "")
  .trim()
  .toLowerCase();
if (!email) {
  console.error("Usage: node scripts/import-components.js <email>");
  process.exit(1);
}

// inventory `kind` -> curated component `type` (matches existing UI labels).
const TYPE_BY_KIND = {
  canvasapp: "Power App",
  modeldrivenapp: "Power App",
  cloudflow: "Power Automate",
  agent: "Copilot Agent",
};

(async () => {
  try {
    const prof = await query(
      "SELECT id, tenant_id, full_name, email FROM profiles WHERE lower(email) = $1",
      [email]
    );
    let profile = prof.rows[0];
    if (!profile) {
      console.log(`No runpipe profile for ${email}; provisioning from CoE maker data...`);
      profile = await ensureProfileFromMaker(email);
      if (!profile) {
        console.error(`Could not find ${email} in CoE makers either. Aborting.`);
        process.exit(1);
      }
      console.log(`Created profile id=${profile.id}`);
    }
    console.log(`Profile: ${profile.full_name} <${profile.email}>  id=${profile.id}  tenant=${profile.tenant_id}`);

    const kinds = Object.keys(TYPE_BY_KIND);
    const ownerOids = await resolveOwnerOids(profile, email);
    const items = await query(
      `SELECT id, kind, display_name, environment_id
         FROM inventory_items
        WHERE is_active = true AND kind = ANY($2)
          AND (
            owner_aad_id = ANY($1::text[])
            OR lower(owner_external) = $3
          )
        ORDER BY kind, display_name`,
      [ownerOids, kinds, email]
    );
    console.log(`Owned inventory items (apps/flows/agents): ${items.rows.length}`);

    // Map environment resource_id -> display name for friendlier environments[].
    const envs = await query(
      "SELECT resource_id, display_name FROM inventory_items WHERE kind = 'environment'"
    );
    const envName = new Map(envs.rows.map((e) => [e.resource_id, e.display_name]));

    let inserted = 0;
    for (const it of items.rows) {
      const compId = `c-${it.id}`;
      const type = TYPE_BY_KIND[it.kind] || it.kind;
      const envLabel = it.environment_id ? [envName.get(it.environment_id) || it.environment_id] : [];
      const { rowCount } = await query(
        `INSERT INTO components (id, tenant_id, name, type, environments, owner_id, status, url, source_inventory_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'unassigned', '', $7)
         ON CONFLICT (id) DO NOTHING`,
        [compId, profile.tenant_id, it.display_name || "(unnamed)", type, envLabel, profile.id, it.id]
      );
      inserted += rowCount;
    }

    const total = await query("SELECT count(*) FROM components WHERE owner_id = $1", [profile.id]);
    console.log(`Inserted ${inserted} new component(s); skipped ${items.rows.length - inserted} already present.`);
    console.log(`Total components now owned by ${profile.email}: ${total.rows[0].count}`);
  } catch (e) {
    console.error("FAILED:", e.message);
    process.exitCode = 1;
  } finally {
    if (pool) await pool.end();
  }
})();
