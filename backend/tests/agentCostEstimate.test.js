const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  extractCostDrivers,
  scoreCostTier,
  defaultConversationMix,
  estimateCredits,
  buildAgentCostEstimate,
  RATE_CARD,
} = require("../copilotStudio/agentCostEstimate");

const classicPublished = {
  type: "microsoft.copilotstudio/agents",
  properties: {
    displayName: "FAQ Bot",
    orchestration: "Classic",
    lastPublishedAt: "2026-01-15T00:00:00Z",
    channels: ["Teams"],
    capabilitiesCounts: {
      distinctPowerPlatformConnectors: 0,
      distinctPowerPlatformConnectorOperations: 0,
    },
  },
};

const generativeHeavy = {
  type: "microsoft.copilotstudio/agents",
  properties: {
    displayName: "Ops Agent",
    orchestration: "Generative",
    model: "gpt-4o-reasoning",
    lastPublishedAt: "2026-03-01T00:00:00Z",
    channels: ["Teams", "voice"],
    IsWebSearchEnabledForKnowledge: true,
    sharedWithEntireTenant: true,
    capabilitiesCounts: {
      distinctPowerPlatformConnectors: 5,
      distinctPowerPlatformConnectorOperations: 12,
    },
  },
};

const draftGenerative = {
  properties: {
    displayName: "Draft",
    orchestration: "Generative",
    capabilitiesCounts: { distinctPowerPlatformConnectorOperations: 2 },
  },
};

describe("extractCostDrivers", () => {
  it("reads ARG properties for classic published agents", () => {
    const d = extractCostDrivers(classicPublished);
    assert.equal(d.orchestration, "Classic");
    assert.equal(d.is_generative, false);
    assert.equal(d.is_published, true);
    assert.equal(d.connector_operations, 0);
  });

  it("flags generative, voice, web search, and tool intensity", () => {
    const d = extractCostDrivers(generativeHeavy);
    assert.equal(d.is_generative, true);
    assert.equal(d.has_voice, true);
    assert.equal(d.web_search_enabled, true);
    assert.equal(d.entire_tenant_share, true);
    assert.equal(d.connector_operations, 12);
    assert.match(d.model, /reason/i);
  });

  it("treats unpublished agents as not published", () => {
    const d = extractCostDrivers(draftGenerative);
    assert.equal(d.is_published, false);
    assert.equal(d.last_published_at, null);
  });
});

describe("scoreCostTier", () => {
  it("scores classic published as Low or Medium", () => {
    const tier = scoreCostTier(extractCostDrivers(classicPublished));
    assert.ok(tier.score < 55);
    assert.ok(["Low", "Medium"].includes(tier.band));
    assert.ok(tier.reasons.some((r) => /Published/i.test(r)));
  });

  it("scores heavy generative agents as High", () => {
    const tier = scoreCostTier(extractCostDrivers(generativeHeavy));
    assert.equal(tier.band, "High");
    assert.ok(tier.score >= 55);
  });
});

describe("estimateCredits", () => {
  it("matches Microsoft-shaped classic support example scale", () => {
    // 4 classic + 0 gen at 900/day → 3600/day → but we use medium 50/day default
    const drivers = extractCostDrivers(classicPublished);
    const mix = defaultConversationMix(drivers);
    assert.equal(mix.classic_answers, 4);
    const est = estimateCredits(drivers, {
      conversations_per_day: 900,
      classic_answers: 4,
      generative_answers: 2,
      agent_actions: 0,
    });
    // [(4*1)+(2*2)] * 900 * 30 = 8 * 900 * 30 = 216000
    assert.equal(est.credits_per_conversation, 8);
    assert.equal(est.monthly_credits, 216000);
  });

  it("returns 0 monthly credits for unpublished agents by default", () => {
    const est = estimateCredits(extractCostDrivers(draftGenerative), { preset: "medium" });
    assert.equal(est.monthly_credits, 0);
    assert.equal(est.production_ready, false);
  });

  it("allows unpublished override via include_unpublished", () => {
    const est = estimateCredits(extractCostDrivers(draftGenerative), {
      preset: "low",
      include_unpublished: true,
    });
    assert.ok(est.monthly_credits > 0);
    assert.equal(est.production_ready, true);
  });

  it("exposes rate card version and USD approx", () => {
    const est = estimateCredits(extractCostDrivers(classicPublished), { preset: "medium" });
    assert.equal(est.rate_card_version, RATE_CARD.version);
    assert.ok(est.estimated_monthly_usd >= 0);
    assert.match(est.disclaimer, /Informational/i);
  });
});

describe("buildAgentCostEstimate", () => {
  it("returns drivers, cost_tier, and estimate together", () => {
    const built = buildAgentCostEstimate(generativeHeavy, { preset: "high" });
    assert.equal(built.cost_tier.band, "High");
    assert.ok(built.estimate.monthly_credits > 0);
    assert.equal(built.estimate.scenario.preset, "high");
    assert.equal(built.estimate.scenario.conversations_per_day, 200);
  });
});
