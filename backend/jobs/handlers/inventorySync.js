const store = require("../../store");
const pp = require("../../powerPlatform/client");
const { canonicalizeEnvironmentId } = require("../../environmentIds");

// Resource types pulled in v1, mapped to our normalized `kind`. Expand later
// (connectors, custom connectors, solutions, …) by adding entries here.
const RESOURCE_TYPES = {
  "microsoft.powerplatform/environments": "environment",
  "microsoft.powerapps/canvasapps": "canvasapp",
  "microsoft.powerapps/modeldrivenapps": "modeldrivenapp",
  "microsoft.powerautomate/cloudflows": "cloudflow",
  "microsoft.copilotstudio/agents": "agent",
};

// PowerPlatformResources query (Azure Resource Graph) filtered to the v1 types.
function buildQueryBody() {
  return {
    TableName: "PowerPlatformResources",
    Clauses: [
      {
        $type: "where",
        FieldName: "type",
        Operator: "in~",
        Values: Object.keys(RESOURCE_TYPES).map((t) => `'${t}'`),
      },
    ],
    Options: { Top: 1000, Skip: 0, SkipToken: "" },
  };
}

function firstDefined(...vals) {
  for (const v of vals) if (v !== undefined && v !== null && v !== "") return v;
  return null;
}

// Entra Object ID (profiles.id / JWT oid). Reject non-GUIDs so we never store
// maker PKs or other opaque ids in owner_aad_id.
const ENTRA_OID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isEntraObjectId(value) {
  return typeof value === "string" && ENTRA_OID_RE.test(value.trim());
}

/** Normalize Inventory API owner fields: plain OID string or nested { id }. */
function asObjectId(value) {
  if (isEntraObjectId(value)) return value.trim();
  if (value && typeof value === "object" && isEntraObjectId(value.id)) return String(value.id).trim();
  return null;
}

function asDisplayLabel(value) {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s || isEntraObjectId(s)) return null;
  return s;
}

/**
 * Separate join key (Entra OID) from display label.
 * Prefer current owner over creator; environments typically only have createdBy.
 * Inventory schema: ownerId / createdBy are OID strings; nested objects handled defensively.
 */
function resolveOwner(props) {
  const ownerAadId = firstDefined(
    asObjectId(props.ownerId),
    asObjectId(props.createdBy),
    asObjectId(props.owner)
  );

  const ownerObj =
    props.owner && typeof props.owner === "object" ? props.owner : null;
  const createdByObj =
    props.createdBy && typeof props.createdBy === "object" ? props.createdBy : null;

  const ownerExternal = firstDefined(
    asDisplayLabel(ownerObj?.userPrincipalName),
    asDisplayLabel(ownerObj?.email),
    asDisplayLabel(ownerObj?.displayName),
    asDisplayLabel(createdByObj?.userPrincipalName),
    asDisplayLabel(createdByObj?.email),
    asDisplayLabel(createdByObj?.displayName)
  );

  return { owner_aad_id: ownerAadId, owner_external: ownerExternal };
}

// Best-effort mapping of an ARG record to an inventory_items row. The full
// record is kept in `raw` so we never lose fields the schema doesn't promote.
function mapRecord(rec, tenantId) {
  const props = rec.properties || {};
  const resourceType = rec.type;
  const kind = RESOURCE_TYPES[resourceType] || resourceType;
  const isEnvironment = kind === "environment";
  const { owner_aad_id, owner_external } = resolveOwner(props);

  const envId = canonicalizeEnvironmentId(
    isEnvironment ? firstDefined(rec.name) : firstDefined(props.environmentId)
  );
  const resourceId = isEnvironment
    ? canonicalizeEnvironmentId(firstDefined(rec.name, rec.id))
    : firstDefined(rec.name, rec.id);

  return {
    tenant_id: tenantId,
    resource_id: resourceId,
    resource_type: resourceType,
    kind,
    display_name: firstDefined(props.displayName, rec.name),
    environment_id: envId,
    scope_type: "environment",
    scope_id: envId,
    location: firstDefined(rec.location),
    owner_aad_id,
    owner_external,
    created_at_src: firstDefined(props.createdAt, props.createdTime),
    modified_at_src: firstDefined(props.lastModifiedAt, props.modifiedAt, props.lastModifiedTime),
    raw: rec,
  };
}

// Full-snapshot sync: upsert every current resource, then soft-delete anything
// of the synced types that wasn't seen this run. Idempotent and safe to re-run.
async function inventorySync(ctx) {
  if (!pp.ppEnabled) {
    throw new Error(
      process.env.PP_INVENTORY_AUTH === "delegated"
        ? "Delegated PP inventory auth is not configured (PP_INVENTORY_CLIENT_ID, PP_REFRESH_TOKEN)"
        : "Power Platform integration is not configured (set PP_CLIENT_ID / PP_CLIENT_SECRET or PP_INVENTORY_AUTH=delegated)"
    );
  }

  const syncedAt = new Date().toISOString();
  let pages = 0;
  let itemsUpserted = 0;

  for await (const page of pp.queryAllPages(buildQueryBody())) {
    pages++;
    const items = page.map((rec) => mapRecord(rec, ctx.tenantId));
    itemsUpserted += await store.upsertInventoryItems(ctx.tenantId, items, syncedAt);
    await ctx.updateStats({ pages, items_upserted: itemsUpserted });
  }

  const itemsDeactivated = await store.deactivateStaleInventory(
    ctx.tenantId,
    syncedAt,
    Object.keys(RESOURCE_TYPES)
  );

  const envStats = await store.syncEnvironmentsFromInventory(ctx.tenantId, syncedAt);
  await ctx.updateStats({ ...envStats });

  return {
    pages,
    items_upserted: itemsUpserted,
    items_deactivated: itemsDeactivated,
    ...envStats,
  };
}

module.exports = inventorySync;
module.exports.mapRecord = mapRecord;
module.exports.resolveOwner = resolveOwner;
