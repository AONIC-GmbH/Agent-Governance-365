const store = require("../../store");

const PP_KINDS = new Set(["canvasapp", "modeldrivenapp", "cloudflow", "agent"]);
const PBI_KINDS = new Set(["powerbi_report", "powerbi_dashboard"]);
const ALLOWED_KINDS = new Set([...PP_KINDS, ...PBI_KINDS]);

function normalizeKinds(kinds) {
  if (!Array.isArray(kinds)) return [];
  return [...new Set(kinds.map(String).filter((k) => ALLOWED_KINDS.has(k)))];
}

function normalizeIds(ids) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.map(String).filter(Boolean))];
}

function assertImportScope(kinds, environmentIds, workspaceIds) {
  const ppKinds = kinds.filter((k) => PP_KINDS.has(k));
  const pbiKinds = kinds.filter((k) => PBI_KINDS.has(k));
  if (!kinds.length) {
    throw new Error(
      "Select at least one component type before importing (Admin → Import)."
    );
  }
  if (ppKinds.length && !environmentIds.length) {
    throw new Error(
      "Select at least one environment for Power Platform types (Admin → Import)."
    );
  }
  if (pbiKinds.length && !workspaceIds.length) {
    throw new Error(
      "Select at least one workspace for Power BI types (Admin → Import)."
    );
  }
  if (!ppKinds.length && !pbiKinds.length) {
    throw new Error("No supported component types selected for import.");
  }
}

/**
 * Promote active inventory rows into curated components,
 * scoped by admin-selected kinds + environment and/or workspace ids.
 */
module.exports = async function componentsImport(ctx) {
  const saved = await store.getComponentImportSettings(ctx.tenantId);
  const kinds = normalizeKinds(
    Array.isArray(ctx.params?.kinds) && ctx.params.kinds.length ? ctx.params.kinds : saved.kinds
  );
  const environmentIds = normalizeIds(
    Array.isArray(ctx.params?.environment_ids) && ctx.params.environment_ids.length
      ? ctx.params.environment_ids
      : saved.environment_ids
  );
  const workspaceIds = normalizeIds(
    Array.isArray(ctx.params?.workspace_ids) && ctx.params.workspace_ids.length
      ? ctx.params.workspace_ids
      : saved.workspace_ids
  );

  assertImportScope(kinds, environmentIds, workspaceIds);

  await ctx.updateStats({ kinds, environment_ids: environmentIds, workspace_ids: workspaceIds });

  const stats = await store.importComponentsFromInventory(ctx.tenantId, {
    kinds,
    environmentIds,
    workspaceIds,
  });

  return { ...stats, kinds, environment_ids: environmentIds, workspace_ids: workspaceIds };
};

module.exports.ALLOWED_KINDS = ALLOWED_KINDS;
module.exports.PP_KINDS = PP_KINDS;
module.exports.PBI_KINDS = PBI_KINDS;
module.exports.assertImportScope = assertImportScope;
