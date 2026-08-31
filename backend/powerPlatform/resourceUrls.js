/**
 * Build maker-portal deep links from Power Platform inventory fields.
 * Patterns match Power Platform admin center "Item URL" samples.
 */

function encodeDisplayName(name) {
  return encodeURIComponent(String(name || "").trim() || "App");
}

/**
 * @param {{
 *   kind: string,
 *   resourceId?: string | null,
 *   environmentId?: string | null,
 *   displayName?: string | null,
 *   appModuleId?: string | null,
 *   logicalName?: string | null,
 * }} opts
 * @returns {string} URL or "" if required fields are missing
 */
function buildInventoryResourceUrl({
  kind,
  resourceId,
  environmentId,
  displayName,
  appModuleId,
  logicalName,
}) {
  const envId = environmentId && String(environmentId).trim();
  const id = resourceId && String(resourceId).trim();
  if (!envId) return "";

  switch (kind) {
    case "canvasapp": {
      if (!id) return "";
      return `https://make.powerapps.com/environments/${envId}/apps/${id}/details`;
    }
    case "cloudflow": {
      if (!id) return "";
      return `https://make.powerautomate.com/environments/${envId}/flows/${id}/details`;
    }
    case "agent": {
      if (!id) return "";
      return `https://copilotstudio.microsoft.com/environments/${envId}/copilots/${id}/details`;
    }
    case "modeldrivenapp": {
      const moduleId = (appModuleId && String(appModuleId).trim()) || id;
      const logical = logicalName && String(logicalName).trim();
      if (!moduleId || !logical) return "";
      const title = encodeDisplayName(displayName);
      return `https://make.powerapps.com/environments/${envId}/insights/${moduleId}/${logical}/pivot/Details/${title}/Model`;
    }
    default:
      return "";
  }
}

/** Extract URL builder inputs from an inventory_items-shaped row. */
function urlInputsFromInventoryItem(it) {
  const raw = typeof it.raw === "string" ? JSON.parse(it.raw || "{}") : it.raw || {};
  const props = raw.properties || {};
  return {
    kind: it.kind,
    resourceId: it.resource_id,
    environmentId: it.environment_id,
    displayName: it.display_name || props.displayName || null,
    appModuleId: props.appModuleId || null,
    logicalName: props.logicalName || null,
  };
}

function buildUrlFromInventoryItem(it) {
  return buildInventoryResourceUrl(urlInputsFromInventoryItem(it));
}

module.exports = {
  buildInventoryResourceUrl,
  urlInputsFromInventoryItem,
  buildUrlFromInventoryItem,
};
