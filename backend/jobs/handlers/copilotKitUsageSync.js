const store = require("../../store");
const { kit } = require("../../dataverse/client");
const { canonicalizeEnvironmentId } = require("../../environmentIds");

const ENTITY_SET = "cat_agentusagehistories";

function toNumber(v) {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toDateOnly(v) {
  if (!v) return null;
  const s = String(v);
  // Dataverse dates arrive as ISO timestamps; store calendar date in UTC.
  return s.slice(0, 10);
}

function mapUsageRow(row, tenantId) {
  const sourceId = row.cat_agentusagehistoryid;
  if (!sourceId) return null;
  const usageDate = toDateOnly(row.cat_usagedate);
  if (!usageDate) return null;
  return {
    source_id: String(sourceId),
    tenant_id: tenantId,
    usage_date: usageDate,
    billed_credits: toNumber(row.cat_billedcopilotcredits),
    unbilled_credits: toNumber(row.cat_nonbilledcopilotcredits),
    agent_resource_id: row.cat_agentid ? String(row.cat_agentid) : null,
    environment_id: canonicalizeEnvironmentId(row.cat_environmentid) || null,
    feature: row.cat_featurename ? String(row.cat_featurename) : null,
    display_name: row.cat_name ? String(row.cat_name) : null,
    raw: row,
  };
}

/**
 * Sync daily agent credit usage from Copilot Agent Kit Dataverse
 * (cat_agentusagehistories) into agent_usage_daily.
 */
module.exports = async function copilotKitUsageSync(ctx) {
  if (!kit.enabled) {
    throw new Error(
      "Copilot Kit Dataverse is not configured (set COPILOT_KIT_DATAVERSE_URL + credentials; SP must be an Application User in the kit org)"
    );
  }

  const syncedAt = new Date().toISOString();
  let pages = 0;
  let upserted = 0;

  for await (const page of kit.getAllRows(ENTITY_SET)) {
    pages++;
    const mapped = [];
    for (const row of page) {
      const m = mapUsageRow(row, ctx.tenantId);
      if (m) mapped.push(m);
    }
    if (mapped.length) {
      const n = await store.upsertAgentUsageDaily(ctx.tenantId, mapped, syncedAt);
      upserted += n;
    }
    await ctx.updateStats({ pages, items_upserted: upserted });
  }

  const deactivated = await store.deactivateStaleAgentUsage(ctx.tenantId, syncedAt);
  const linked = await store.linkAgentUsageToInventory(ctx.tenantId);

  return {
    pages,
    items_upserted: upserted,
    items_deactivated: deactivated,
    items_linked: linked,
  };
};

module.exports.mapUsageRow = mapUsageRow;
module.exports.ENTITY_SET = ENTITY_SET;
