const store = require("../../store");
const pbi = require("../../powerBi/client");

const RESOURCE_TYPES = {
  "powerbi/workspace": "powerbi_workspace",
  "powerbi/report": "powerbi_report",
  "powerbi/dashboard": "powerbi_dashboard",
};

function firstDefined(...vals) {
  for (const v of vals) if (v !== undefined && v !== null && v !== "") return v;
  return null;
}

const ENTRA_OID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isEntraObjectId(value) {
  return typeof value === "string" && ENTRA_OID_RE.test(value.trim());
}

function mapWorkspace(ws, tenantId) {
  const workspaceId = firstDefined(ws.id, ws.objectId);
  return {
    tenant_id: tenantId,
    resource_id: workspaceId,
    resource_type: "powerbi/workspace",
    kind: "powerbi_workspace",
    display_name: firstDefined(ws.name, ws.displayName, workspaceId),
    environment_id: null,
    scope_type: "workspace",
    scope_id: workspaceId,
    location: null,
    owner_aad_id: null,
    owner_external: null,
    created_at_src: null,
    modified_at_src: null,
    raw: ws,
  };
}

function mapReport(report, workspaceId, tenantId) {
  const resourceId = firstDefined(report.id, report.reportId);
  const ownerAad = isEntraObjectId(report.createdById) ? report.createdById.trim() : null;
  return {
    tenant_id: tenantId,
    resource_id: resourceId,
    resource_type: "powerbi/report",
    kind: "powerbi_report",
    display_name: firstDefined(report.name, report.displayName, resourceId),
    environment_id: null,
    scope_type: "workspace",
    scope_id: workspaceId,
    location: null,
    owner_aad_id: ownerAad,
    owner_external: firstDefined(report.createdBy, report.modifiedBy),
    created_at_src: firstDefined(report.createdDateTime, report.created),
    modified_at_src: firstDefined(report.modifiedDateTime, report.modified),
    raw: { ...report, workspaceId },
  };
}

function mapDashboard(dashboard, workspaceId, tenantId) {
  const resourceId = firstDefined(dashboard.id, dashboard.dashboardId);
  return {
    tenant_id: tenantId,
    resource_id: resourceId,
    resource_type: "powerbi/dashboard",
    kind: "powerbi_dashboard",
    display_name: firstDefined(dashboard.displayName, dashboard.name, resourceId),
    environment_id: null,
    scope_type: "workspace",
    scope_id: workspaceId,
    location: null,
    owner_aad_id: null,
    owner_external: null,
    created_at_src: null,
    modified_at_src: null,
    raw: { ...dashboard, workspaceId },
  };
}

function flattenScanResult(scanResult, tenantId) {
  const items = [];
  for (const ws of scanResult?.workspaces || []) {
    const workspaceId = firstDefined(ws.id, ws.objectId);
    if (!workspaceId) continue;
    // Skip personal "My workspace" style if API still returns them.
    if (ws.type === "PersonalGroup") continue;
    items.push(mapWorkspace(ws, tenantId));
    for (const report of ws.reports || []) {
      items.push(mapReport(report, workspaceId, tenantId));
    }
    for (const dashboard of ws.dashboards || []) {
      items.push(mapDashboard(dashboard, workspaceId, tenantId));
    }
  }
  return items;
}

/**
 * Full-snapshot Power BI inventory: workspaces + reports + dashboards via Scanner API.
 */
async function powerbiInventorySync(ctx) {
  if (!pbi.pbiEnabled) {
    throw new Error(
      "Power BI integration is not configured (set PBI_CLIENT_ID / PBI_CLIENT_SECRET)"
    );
  }

  const syncedAt = new Date().toISOString();
  const workspaceIds = await pbi.getModifiedWorkspaceIds({ excludePersonalWorkspaces: true });
  await ctx.updateStats({ workspaces_listed: workspaceIds.length });

  let chunks = 0;
  let itemsUpserted = 0;
  for (const ids of pbi.chunk(workspaceIds, pbi.SCAN_CHUNK_SIZE)) {
    chunks++;
    const result = await pbi.scanWorkspaces(ids);
    const items = flattenScanResult(result, ctx.tenantId);
    itemsUpserted += await store.upsertInventoryItems(ctx.tenantId, items, syncedAt);
    await ctx.updateStats({ chunks, items_upserted: itemsUpserted });
  }

  const itemsDeactivated = await store.deactivateStaleInventory(
    ctx.tenantId,
    syncedAt,
    Object.keys(RESOURCE_TYPES)
  );

  const wsStats = await store.syncWorkspacesFromInventory(ctx.tenantId, syncedAt);
  await ctx.updateStats({ ...wsStats });

  return {
    workspaces_listed: workspaceIds.length,
    chunks,
    items_upserted: itemsUpserted,
    items_deactivated: itemsDeactivated,
    ...wsStats,
  };
}

module.exports = powerbiInventorySync;
module.exports.RESOURCE_TYPES = RESOURCE_TYPES;
module.exports.flattenScanResult = flattenScanResult;
