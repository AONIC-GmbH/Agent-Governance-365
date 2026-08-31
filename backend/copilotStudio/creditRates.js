/**
 * Pick euro_per_credit for a calendar date (YYYY-MM-DD) from rate cards.
 * Cards may be open-ended (effective_to null).
 */
function rateForDate(rates, dateStr) {
  if (!dateStr || !rates?.length) return 0;
  for (const r of rates) {
    if (dateStr < r.effective_from) continue;
    if (r.effective_to && dateStr > r.effective_to) continue;
    return Number(r.euro_per_credit) || 0;
  }
  return 0;
}

/**
 * Aggregate daily usage rows into per-agent credit/EUR totals using rate cards.
 * Each dailyRow: { agent_key, usage_date, billed_credits, unbilled_credits, ...meta }
 * Primary `euro` / `euro_total` is billed credits × rate only.
 */
function aggregateAgentCredits(dailyRows, rates, { businessUnitId } = {}) {
  const sortedRates = [...(rates || [])].sort((a, b) =>
    String(b.effective_from).localeCompare(String(a.effective_from))
  );

  const byAgent = new Map();
  let billed_credits_total = 0;
  let unbilled_credits_total = 0;
  let euro_total = 0;
  let billed_euro_total = 0;
  let unbilled_euro_total = 0;

  for (const row of dailyRows) {
    const buId = row.business_unit_id ?? null;
    if (businessUnitId === "__unassigned__") {
      if (buId) continue;
    } else if (businessUnitId) {
      if (buId !== businessUnitId) continue;
    }

    const billed = Number(row.billed_credits) || 0;
    const unbilled = Number(row.unbilled_credits) || 0;
    const rate = rateForDate(sortedRates, row.usage_date);
    const billedEuro = billed * rate;
    const unbilledEuro = unbilled * rate;

    billed_credits_total += billed;
    unbilled_credits_total += unbilled;
    billed_euro_total += billedEuro;
    unbilled_euro_total += unbilledEuro;
    // Primary EUR is billed-only; unbilled_euro is informational.
    euro_total += billedEuro;

    const key = row.agent_key || row.agent_resource_id || row.inventory_item_id || "unknown";
    if (!byAgent.has(key)) {
      byAgent.set(key, {
        agent_key: key,
        inventory_item_id: row.inventory_item_id || null,
        agent_resource_id: row.agent_resource_id || null,
        display_name: row.display_name || row.agent_resource_id || "Unknown agent",
        environment_id: row.environment_id || null,
        environment_name: row.environment_name || null,
        project_id: row.project_id || null,
        project_name: row.project_name || null,
        business_unit_id: buId,
        business_unit_name: row.business_unit_name || null,
        environment_type: row.environment_type || null,
        inventory_details: row.inventory_details || null,
        billed_credits: 0,
        unbilled_credits: 0,
        euro: 0,
        billed_euro: 0,
        unbilled_euro: 0,
      });
    }
    const agg = byAgent.get(key);
    agg.billed_credits += billed;
    agg.unbilled_credits += unbilled;
    agg.billed_euro += billedEuro;
    agg.unbilled_euro += unbilledEuro;
    agg.euro += billedEuro;
    if (!agg.display_name && row.display_name) agg.display_name = row.display_name;
    if (!agg.environment_name && row.environment_name) {
      agg.environment_name = row.environment_name;
      agg.environment_id = row.environment_id;
    }
    if (!agg.environment_type && row.environment_type) {
      agg.environment_type = row.environment_type;
    }
    if (!agg.inventory_details && row.inventory_details) {
      agg.inventory_details = row.inventory_details;
    }
    if (!agg.project_id && row.project_id) {
      agg.project_id = row.project_id;
      agg.project_name = row.project_name;
      agg.business_unit_id = buId;
      agg.business_unit_name = row.business_unit_name;
    }
  }

  const items = [...byAgent.values()].sort((a, b) =>
    String(a.display_name).localeCompare(String(b.display_name))
  );

  return {
    billed_credits_total,
    unbilled_credits_total,
    euro_total,
    billed_euro_total,
    unbilled_euro_total,
    count: items.length,
    items,
  };
}

function rangesOverlap(aFrom, aTo, bFrom, bTo) {
  const aEnd = aTo || "9999-12-31";
  const bEnd = bTo || "9999-12-31";
  return aFrom <= bEnd && bFrom <= aEnd;
}

module.exports = {
  rateForDate,
  aggregateAgentCredits,
  rangesOverlap,
};
