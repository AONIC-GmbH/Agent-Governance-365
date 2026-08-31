/**
 * Build Power BI service deep links from inventory fields.
 * Workspace-scoped (not Power Platform environment-scoped).
 */

function buildPowerBiResourceUrl({ kind, resourceId, workspaceId }) {
  const ws = workspaceId && String(workspaceId).trim();
  const id = resourceId && String(resourceId).trim();
  if (!ws || !id) return "";

  switch (kind) {
    case "powerbi_report":
      return `https://app.powerbi.com/groups/${ws}/reports/${id}`;
    case "powerbi_dashboard":
      return `https://app.powerbi.com/groups/${ws}/dashboards/${id}`;
    default:
      return "";
  }
}

module.exports = { buildPowerBiResourceUrl };
