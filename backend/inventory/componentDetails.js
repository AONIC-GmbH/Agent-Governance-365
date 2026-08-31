/**
 * Slim inventory details for admin component click-through.
 * Agents reuse agentInventoryDetails; apps/flows omit connectors (v1).
 */

const { extractAgentInventoryDetails, propsFromRaw } = require("../copilotStudio/agentInventoryDetails");

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

function extractPowerAppDetails(raw, meta = {}) {
  const props = propsFromRaw(raw);
  return {
    last_modified_at: firstDefined(props.lastModifiedAt, props.LastModifiedAt, meta.modified_at_src),
    created_at: firstDefined(props.createdAt, props.CreatedAt, meta.created_at_src),
    is_quarantined: Boolean(firstDefined(props.isQuarantined, props.IsQuarantined)),
    logical_name: firstDefined(props.logicalName, props.LogicalName),
    app_module_id: firstDefined(props.appModuleId, props.AppModuleId),
    environment_type: meta.environment_type || null,
  };
}

function extractCloudFlowDetails(raw, meta = {}) {
  const props = propsFromRaw(raw);
  return {
    last_modified_at: firstDefined(props.lastModifiedAt, props.LastModifiedAt, meta.modified_at_src),
    created_at: firstDefined(props.createdAt, props.CreatedAt, meta.created_at_src),
    trigger: firstDefined(props.trigger, props.Trigger),
    trigger_operation: firstDefined(props.triggerOperation, props.TriggerOperation),
    workflow_entity_id: firstDefined(props.workflowEntityId, props.WorkflowEntityId),
    environment_type: meta.environment_type || null,
  };
}

/**
 * Power BI Scanner API shapes live on the report/dashboard raw (+ workspace raw).
 */
function extractPowerBiDetails(raw, workspaceRaw = null, meta = {}) {
  const rec = normalizeRaw(raw);
  const ws = normalizeRaw(workspaceRaw);

  const isOnDedicated = firstDefined(
    ws.isOnDedicatedCapacity,
    ws.IsOnDedicatedCapacity,
    rec.isOnDedicatedCapacity
  );

  return {
    workspace_id: firstDefined(rec.workspaceId, meta.scope_id, ws.id, ws.objectId),
    workspace_name: firstDefined(ws.name, ws.displayName, meta.workspace_name),
    workspace_type: firstDefined(ws.type),
    workspace_state: firstDefined(ws.state),
    report_type: firstDefined(rec.reportType),
    dataset_id: firstDefined(rec.datasetId, rec.DatasetId),
    created_by: firstDefined(rec.createdBy, rec.CreatedBy, meta.owner_external),
    modified_by: firstDefined(rec.modifiedBy, rec.ModifiedBy),
    created_at: firstDefined(
      rec.createdDateTime,
      rec.created,
      meta.created_at_src
    ),
    modified_at: firstDefined(
      rec.modifiedDateTime,
      rec.modified,
      meta.modified_at_src
    ),
    is_on_dedicated_capacity:
      typeof isOnDedicated === "boolean" ? isOnDedicated : isOnDedicated == null ? null : Boolean(isOnDedicated),
    capacity_id: firstDefined(ws.capacityId, ws.CapacityId, rec.capacityId) || null,
  };
}

/**
 * @param {string} kind - component / inventory kind
 * @param {object|string|null} raw - inventory_items.raw
 * @param {object} [ctx]
 */
function extractComponentInventoryDetails(kind, raw, ctx = {}) {
  const meta = {
    owner_external: ctx.owner_external || null,
    owner_aad_id: ctx.owner_aad_id || null,
    created_at_src: ctx.created_at_src || null,
    modified_at_src: ctx.modified_at_src || null,
    environment_type: ctx.environment_type || null,
    scope_id: ctx.scope_id || null,
    workspace_name: ctx.workspace_name || null,
  };

  switch (kind) {
    case "agent":
      return {
        family: "agent",
        ...extractAgentInventoryDetails(raw, meta),
      };
    case "canvasapp":
    case "modeldrivenapp":
      return {
        family: "powerapp",
        app_kind: kind,
        ...extractPowerAppDetails(raw, meta),
      };
    case "cloudflow":
      return {
        family: "cloudflow",
        ...extractCloudFlowDetails(raw, meta),
      };
    case "powerbi_report":
    case "powerbi_dashboard":
      return {
        family: "powerbi",
        pbi_kind: kind,
        ...extractPowerBiDetails(raw, ctx.workspace_raw, meta),
      };
    default:
      return {
        family: "unknown",
        environment_type: meta.environment_type,
      };
  }
}

module.exports = {
  extractComponentInventoryDetails,
  extractPowerAppDetails,
  extractCloudFlowDetails,
  extractPowerBiDetails,
};
