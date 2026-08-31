/**
 * Slim agent fields from Power Platform inventory (inventory_items.raw).
 * Used for admin click-through details — never send full raw to the client.
 */

function firstDefined(...vals) {
  for (const v of vals) if (v !== undefined && v !== null && v !== "") return v;
  return null;
}

function normalizeRaw(raw) {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw;
}

function propsFromRaw(raw) {
  const rec = normalizeRaw(raw);
  if (rec.properties && typeof rec.properties === "object") return rec.properties;
  return rec;
}

function asNumber(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function sharingCounts(value) {
  if (!value || typeof value !== "object") return null;
  return {
    user_count: asNumber(value.userCount ?? value.user_count, 0) ?? 0,
    group_count: asNumber(value.groupCount ?? value.group_count, 0) ?? 0,
    entire_tenant: Boolean(value.entireTenant ?? value.entire_tenant),
  };
}

/**
 * @param {object|string|null} raw - inventory_items.raw (full ARG record or properties)
 * @param {object} [meta]
 * @returns {object}
 */
function extractAgentInventoryDetails(raw, meta = {}) {
  const props = propsFromRaw(raw);
  const caps = props.capabilitiesCounts || props.CapabilitiesCounts || {};
  const channels = Array.isArray(props.channels)
    ? props.channels.map(String)
    : Array.isArray(props.Channels)
      ? props.Channels.map(String)
      : [];
  const connectors = Array.isArray(props.powerPlatformConnectors)
    ? props.powerPlatformConnectors
    : Array.isArray(props.PowerPlatformConnectors)
      ? props.PowerPlatformConnectors
      : [];

  const connectorCount =
    asNumber(caps.distinctPowerPlatformConnectors) ??
    asNumber(caps.DistinctPowerPlatformConnectors) ??
    connectors.length;
  const connectorOps =
    asNumber(caps.distinctPowerPlatformConnectorOperations) ??
    asNumber(caps.DistinctPowerPlatformConnectorsOperations) ??
    asNumber(caps.distinctPowerPlatformConnectorsOperations) ??
    null;

  const viewers = sharingCounts(props.sharedWithViewers || props.SharedWithViewers);
  const editors = sharingCounts(props.sharedWithEditors || props.SharedWithEditors);
  const entireTenant =
    Boolean(viewers?.entire_tenant) ||
    Boolean(firstDefined(props.sharedWithEntireTenant, props.SharedWithEntireTenant));

  const lastPublishedAt = firstDefined(props.lastPublishedAt, props.LastPublishedAt);
  const createdAt = firstDefined(
    props.createdAt,
    props.CreatedAt,
    meta.created_at_src
  );

  const connectorIds = connectors
    .map((c) => firstDefined(c?.connectorId, c?.ConnectorId, c?.id))
    .filter(Boolean)
    .map(String)
    .slice(0, 12);

  return {
    created_in: firstDefined(props.createdIn, props.CreatedIn),
    orchestration: firstDefined(props.orchestration, props.Orchestration),
    model: firstDefined(props.model, props.Model),
    authentication: firstDefined(props.authentication, props.Authentication),
    channels,
    last_published_at: lastPublishedAt ? String(lastPublishedAt) : null,
    is_published: Boolean(lastPublishedAt),
    created_at: createdAt ? String(createdAt) : null,
    owner_external: meta.owner_external || null,
    owner_aad_id: meta.owner_aad_id || null,
    environment_type: meta.environment_type || null,
    shared_with_viewers: viewers,
    shared_with_editors: editors,
    entire_tenant_share: entireTenant,
    connector_count: connectorCount,
    connector_operations: connectorOps,
    connector_ids: connectorIds,
    web_search_enabled: Boolean(
      firstDefined(
        props.IsWebSearchEnabledForKnowledge,
        props.isWebSearchEnabledForKnowledge,
        props.webSearchEnabled
      )
    ),
    is_managed:
      typeof props.isManaged === "boolean"
        ? props.isManaged
        : props.isManaged == null
          ? null
          : String(props.isManaged).toLowerCase() === "true",
    is_quarantined: Boolean(firstDefined(props.isQuarantined, props.IsQuarantined)),
    schema_name: firstDefined(props.schemaName, props.SchemaName),
  };
}

module.exports = {
  extractAgentInventoryDetails,
  propsFromRaw,
};
