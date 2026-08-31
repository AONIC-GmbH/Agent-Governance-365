const store = require("../../store");
const dv = require("../../dataverse/client");

// CoE Starter Kit inventory tables we ingest in v1, mapped to our normalized
// `kind`. Entity-set + primary-id field names follow the CoE Core solution.
// Override via env COE_TABLES (JSON array of { entitySet, idField, kind }) if
// your CoE version differs.
const DEFAULT_TABLES = [
  { entitySet: "admin_environments", idField: "admin_environmentid", kind: "environment" },
  { entitySet: "admin_apps", idField: "admin_appid", kind: "canvasapp" },
  { entitySet: "admin_flows", idField: "admin_flowid", kind: "cloudflow" },
  { entitySet: "admin_pvas", idField: "admin_pvaid", kind: "agent" },
];

function loadTables() {
  const raw = process.env.COE_TABLES;
  if (!raw) return DEFAULT_TABLES;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    // fall through to defaults on malformed config
  }
  return DEFAULT_TABLES;
}

function firstDefined(...vals) {
  for (const v of vals) if (v !== undefined && v !== null && v !== "") return v;
  return null;
}

// Dataverse exposes lookup display text and option-set labels via formatted
// annotations; prefer those when present.
function formatted(row, field) {
  return row[`${field}@OData.Community.Display.V1.FormattedValue`];
}

// Loads admin_makers once per sync. Owner lookups on resource rows point at
// admin_makerid (Dataverse PK); admin_recordguidasstring is the canonical Entra
// Object ID when CoE sync is healthy.
async function loadMakerCache() {
  const cache = new Map();
  let url =
    `${dv.orgUrl}/api/data/v9.2/admin_makers` +
    `?$select=admin_makerid,admin_recordguidasstring,admin_userprincipalname,admin_useremail,admin_displayname`;
  while (url) {
    const json = await dv.dvFetch(url);
    for (const m of json.value || []) {
      if (!m.admin_makerid) continue;
      cache.set(String(m.admin_makerid).toLowerCase(), {
        entraOid: firstDefined(m.admin_recordguidasstring, m.admin_makerid),
        upn: m.admin_userprincipalname,
        email: m.admin_useremail,
        displayName: m.admin_displayname,
      });
    }
    url = json["@odata.nextLink"] || null;
  }
  return cache;
}

function findMakerByUpn(cache, upn) {
  if (!upn) return null;
  const needle = upn.toLowerCase();
  for (const maker of cache.values()) {
    if (maker.upn?.toLowerCase() === needle || maker.email?.toLowerCase() === needle) {
      return maker;
    }
  }
  return null;
}

// Resolves a CoE owner lookup (or environment UPN) to Entra oid + display fields.
function resolveOwner(row, makerCache) {
  const lookupId = firstDefined(
    row._admin_appowner_value,
    row._admin_flowcreator_value,
    row._admin_derivedowner_value,
    row._admin_pvaowner_value,
    row._admin_maker_value
  );

  let maker = lookupId ? makerCache.get(String(lookupId).toLowerCase()) : null;
  if (!maker) {
    maker = findMakerByUpn(makerCache, row.admin_environmentmakerupn);
  }

  const ownerExternal = firstDefined(
    maker?.upn,
    maker?.email,
    maker?.displayName,
    row.admin_environmentmakerupn,
    row.admin_appownerdisplayname,
    row.admin_flowmakerdisplayname,
    row.admin_environmentmakerdisplayname,
    formatted(row, "_admin_appowner_value"),
    formatted(row, "_admin_flowcreator_value"),
    formatted(row, "_admin_pvaowner_value"),
    formatted(row, "_admin_maker_value")
  );

  const ownerAadId = maker?.entraOid ?? lookupId ?? null;

  return { ownerExternal, ownerAadId };
}

// Maps a CoE row to an inventory_items row using the CoE Core column names
// (verified against admin_apps / admin_flows / admin_environments). We try
// several candidates so the same handler works across the three tables, and
// always keep the full row in `raw`. resource_id uses the Dataverse primary
// key, which is always present and stable (keeping upserts idempotent).
//
// NOTE: owner intentionally avoids _ownerid_value / _createdby_value — those
// are the CoE sync service account (identical for every row), not the maker.
function mapRow(row, table, tenantId, makerCache) {
  const isEnvironment = table.kind === "environment";
  const rowId = row[table.idField];

  let kind = table.kind;
  if (table.entitySet === "admin_apps") {
    const appType = (formatted(row, "admin_powerappstype") || row.admin_powerappstype || "")
      .toString()
      .toLowerCase();
    if (appType.includes("model")) kind = "modeldrivenapp";
  }

  const environmentId = isEnvironment
    ? firstDefined(rowId)
    : firstDefined(
        row._admin_appenvironment_value,
        row._admin_flowenvironment_value,
        row._admin_pvaenvironment_value,
        row.admin_appenvironmentid,
        row.admin_flowenvironmentid
      );

  const { ownerExternal, ownerAadId } = resolveOwner(row, makerCache);

  return {
    tenant_id: tenantId,
    resource_id: firstDefined(rowId),
    resource_type: table.entitySet,
    kind,
    display_name: firstDefined(row.admin_displayname, row.admin_pvadisplayname, row.admin_name),
    environment_id: environmentId,
    location: firstDefined(formatted(row, "admin_region"), row.admin_region),
    owner_external: ownerExternal,
    owner_aad_id: ownerAadId,
    created_at_src: firstDefined(
      row.admin_appcreatedon,
      row.admin_flowcreatedon,
      row.admin_environmentcreatedon,
      row.admin_pvacreatedon,
      row.createdon
    ),
    modified_at_src: firstDefined(
      row.admin_appmodifiedon,
      row.admin_flowmodifiedon,
      row.admin_environmentmodifiedon,
      row.admin_pvamodifiedon,
      row.modifiedon
    ),
    raw: row,
  };
}

// Full-snapshot sync from CoE Dataverse: upsert every current row, then
// soft-delete anything of the synced types not seen this run. Idempotent.
// Tables missing in this CoE version (404) are skipped, not fatal.
module.exports = async function coeSync(ctx) {
  if (!dv.dataverseEnabled) {
    throw new Error(
      "Dataverse/CoE integration is not configured (set DATAVERSE_URL + DATAVERSE_CLIENT_ID/SECRET, or reuse PP_*)"
    );
  }

  const tables = loadTables();
  const syncedAt = new Date().toISOString();
  let pages = 0;
  let itemsUpserted = 0;
  const syncedTypes = [];
  const skipped = [];

  ctx.log("Loading admin_makers cache for owner resolution...");
  const makerCache = await loadMakerCache();
  ctx.log(`Loaded ${makerCache.size} maker(s)`);

  for (const table of tables) {
    try {
      for await (const rows of dv.getAllRows(table.entitySet)) {
        pages++;
        const items = rows.map((r) => mapRow(r, table, ctx.tenantId, makerCache));
        itemsUpserted += await store.upsertInventoryItems(ctx.tenantId, items, syncedAt);
        await ctx.updateStats({ pages, items_upserted: itemsUpserted, skipped });
      }
      syncedTypes.push(table.entitySet);
    } catch (err) {
      if (err && err.status === 404) {
        ctx.log(`Skipping ${table.entitySet}: table not found in this environment (404)`);
        skipped.push(table.entitySet);
        continue;
      }
      throw err;
    }
  }

  // Only deactivate types we actually synced this run (never the skipped ones).
  const itemsDeactivated = syncedTypes.length
    ? await store.deactivateStaleInventory(ctx.tenantId, syncedAt, syncedTypes)
    : 0;

  return { pages, items_upserted: itemsUpserted, items_deactivated: itemsDeactivated, skipped };
};
