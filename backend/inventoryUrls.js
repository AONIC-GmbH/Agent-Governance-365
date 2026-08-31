const { buildInventoryResourceUrl, urlInputsFromInventoryItem } = require("./powerPlatform/resourceUrls");
const { buildPowerBiResourceUrl } = require("./powerBi/resourceUrls");

function buildUrlFromInventoryItem(it) {
  const kind = it?.kind;
  if (kind === "powerbi_report" || kind === "powerbi_dashboard") {
    const raw = typeof it.raw === "string" ? JSON.parse(it.raw || "{}") : it.raw || {};
    return buildPowerBiResourceUrl({
      kind,
      resourceId: it.resource_id,
      workspaceId: it.scope_id || raw.workspaceId || null,
    });
  }
  return buildInventoryResourceUrl(urlInputsFromInventoryItem(it));
}

module.exports = {
  buildUrlFromInventoryItem,
  buildInventoryResourceUrl,
  buildPowerBiResourceUrl,
};
