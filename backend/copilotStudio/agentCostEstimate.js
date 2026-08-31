/**
 * Copilot Studio agent cost estimation (design-time risk + scenario credits).
 * Rate card mirrors Microsoft Copilot Credits billing (informational only).
 * @see https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-messages-management
 * @see https://learn.microsoft.com/en-us/microsoft-copilot-studio/admin-agent-inventory
 */

const RATE_CARD = Object.freeze({
  version: "2026-08",
  classic_answer: 1,
  generative_answer: 2,
  agent_action: 5,
  tenant_graph_grounding: 10,
  pack_credits: 25000,
  pack_price_usd: 200,
  days_per_month: 30,
});

const TRAFFIC_PRESETS = Object.freeze({
  low: { conversations_per_day: 10 },
  medium: { conversations_per_day: 50 },
  high: { conversations_per_day: 200 },
});

function firstDefined(...vals) {
  for (const v of vals) if (v !== undefined && v !== null && v !== "") return v;
  return null;
}

function asNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
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

/** Prefer ARG `properties`; accept a properties object directly. */
function propsFromRaw(raw) {
  const rec = normalizeRaw(raw);
  if (rec.properties && typeof rec.properties === "object") return rec.properties;
  return rec;
}

function extractCostDrivers(raw) {
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

  const connectorOps =
    asNumber(caps.distinctPowerPlatformConnectorOperations) ||
    asNumber(caps.DistinctPowerPlatformConnectorOperations) ||
    connectors.reduce((sum, c) => {
      const ops = Array.isArray(c?.operations) ? c.operations.length : asNumber(c?.operationCount);
      return sum + ops;
    }, 0);

  const connectorCount =
    asNumber(caps.distinctPowerPlatformConnectors) ||
    asNumber(caps.DistinctPowerPlatformConnectors) ||
    connectors.length;

  const orchestration = String(
    firstDefined(props.orchestration, props.Orchestration, "Classic")
  );
  const isGenerative = /generative/i.test(orchestration);
  const lastPublishedAt = firstDefined(props.lastPublishedAt, props.LastPublishedAt);
  const isPublished = Boolean(lastPublishedAt);
  const webSearch = Boolean(
    firstDefined(
      props.IsWebSearchEnabledForKnowledge,
      props.isWebSearchEnabledForKnowledge,
      props.webSearchEnabled
    )
  );
  const model = firstDefined(props.model, props.Model);
  const hasVoice = channels.some((c) => /voice|telephony|phone/i.test(c));
  const entireTenant = Boolean(
    firstDefined(props.sharedWithEntireTenant, props.SharedWithEntireTenant, props.entireTenant)
  );
  const sharedViewers = asNumber(
    firstDefined(props.sharedWithViewers, props.SharedWithViewers, props.sharedUsersCount)
  );

  return {
    orchestration,
    is_generative: isGenerative,
    model: model ? String(model) : null,
    channels,
    has_voice: hasVoice,
    connector_count: connectorCount,
    connector_operations: connectorOps,
    web_search_enabled: webSearch,
    last_published_at: lastPublishedAt ? String(lastPublishedAt) : null,
    is_published: isPublished,
    entire_tenant_share: entireTenant,
    shared_viewers: sharedViewers,
    authentication: firstDefined(props.authentication, props.Authentication),
    created_in: firstDefined(props.createdIn, props.CreatedIn),
  };
}

/** Design-time cost tier (Low / Medium / High) from agent configuration. */
function scoreCostTier(drivers) {
  const reasons = [];
  let score = 0;

  if (drivers.is_generative) {
    score += 25;
    reasons.push("Generative orchestration");
  }
  if (drivers.is_published) {
    score += 15;
    reasons.push("Published (live)");
  } else {
    reasons.push("Not published (draft)");
  }

  const ops = drivers.connector_operations || 0;
  if (ops >= 10) {
    score += 30;
    reasons.push(`High tool intensity (${ops} operations)`);
  } else if (ops >= 4) {
    score += 20;
    reasons.push(`Moderate tool intensity (${ops} operations)`);
  } else if (ops >= 1) {
    score += 10;
    reasons.push(`Some tools (${ops} operations)`);
  }

  if (drivers.web_search_enabled) {
    score += 10;
    reasons.push("Web search knowledge enabled");
  }
  if (drivers.entire_tenant_share) {
    score += 10;
    reasons.push("Shared with entire tenant");
  } else if (drivers.shared_viewers > 50) {
    score += 5;
    reasons.push("Broad sharing");
  }
  if (drivers.has_voice) {
    score += 15;
    reasons.push("Voice channel present");
  }
  if (drivers.model && /reason|o1|o3|premium/i.test(drivers.model)) {
    score += 15;
    reasons.push("Reasoning / premium model hint");
  }

  score = Math.min(100, score);
  let band = "Low";
  if (score >= 55) band = "High";
  else if (score >= 30) band = "Medium";

  return { score, band, reasons };
}

/**
 * Default answers/actions per conversation inferred from agent design.
 */
function defaultConversationMix(drivers) {
  if (drivers.is_generative) {
    const actions =
      drivers.connector_operations >= 10
        ? 4
        : drivers.connector_operations >= 4
          ? 2
          : drivers.connector_operations >= 1
            ? 1
            : 0;
    return {
      classic_answers: 1,
      generative_answers: drivers.web_search_enabled ? 4 : 3,
      agent_actions: actions,
      graph_grounding_events: 0,
    };
  }
  return {
    classic_answers: 4,
    generative_answers: 0,
    agent_actions: 0,
    graph_grounding_events: 0,
  };
}

function resolveScenario(drivers, scenario = {}) {
  const presetName = String(scenario.preset || "medium").toLowerCase();
  const preset = TRAFFIC_PRESETS[presetName] || TRAFFIC_PRESETS.medium;
  const mix = defaultConversationMix(drivers);

  const conversations_per_day = asNumber(
    scenario.conversations_per_day,
    preset.conversations_per_day
  );

  return {
    preset: TRAFFIC_PRESETS[presetName] ? presetName : "medium",
    conversations_per_day,
    classic_answers: asNumber(scenario.classic_answers, mix.classic_answers),
    generative_answers: asNumber(scenario.generative_answers, mix.generative_answers),
    agent_actions: asNumber(scenario.agent_actions, mix.agent_actions),
    graph_grounding_events: asNumber(
      scenario.graph_grounding_events,
      mix.graph_grounding_events
    ),
    /** When true, estimate credits even if agent is unpublished. */
    include_unpublished: Boolean(scenario.include_unpublished),
  };
}

function creditsPerConversation(resolved, rates = RATE_CARD) {
  return (
    resolved.classic_answers * rates.classic_answer +
    resolved.generative_answers * rates.generative_answer +
    resolved.agent_actions * rates.agent_action +
    resolved.graph_grounding_events * rates.tenant_graph_grounding
  );
}

function estimateCredits(drivers, scenario = {}, rates = RATE_CARD) {
  const resolved = resolveScenario(drivers, scenario);
  const perConv = creditsPerConversation(resolved, rates);

  const productionReady = drivers.is_published || resolved.include_unpublished;
  const monthly_credits = productionReady
    ? Math.round(perConv * resolved.conversations_per_day * rates.days_per_month)
    : 0;

  const estimated_monthly_usd =
    Math.round((monthly_credits / rates.pack_credits) * rates.pack_price_usd * 100) / 100;

  return {
    rate_card_version: rates.version,
    scenario: resolved,
    credits_per_conversation: perConv,
    monthly_credits,
    estimated_monthly_usd,
    production_ready: productionReady,
    disclaimer:
      "Informational estimate only. Not a Microsoft quote; actual Copilot Credit consumption may differ.",
  };
}

function buildAgentCostEstimate(raw, scenario = {}) {
  const drivers = extractCostDrivers(raw);
  const cost_tier = scoreCostTier(drivers);
  const estimate = estimateCredits(drivers, scenario);
  return { drivers, cost_tier, estimate };
}

module.exports = {
  RATE_CARD,
  TRAFFIC_PRESETS,
  extractCostDrivers,
  scoreCostTier,
  defaultConversationMix,
  resolveScenario,
  estimateCredits,
  buildAgentCostEstimate,
};
