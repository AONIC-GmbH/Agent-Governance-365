const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  rateForDate,
  aggregateAgentCredits,
  rangesOverlap,
} = require("../copilotStudio/creditRates");
const { extractAgentInventoryDetails } = require("../copilotStudio/agentInventoryDetails");
const { mapUsageRow } = require("../jobs/handlers/copilotKitUsageSync");

describe("rateForDate", () => {
  const rates = [
    { effective_from: "2026-07-01", effective_to: null, euro_per_credit: 0.01 },
    { effective_from: "2026-01-01", effective_to: "2026-06-30", euro_per_credit: 0.008 },
  ];

  it("picks the matching range", () => {
    assert.equal(rateForDate(rates, "2026-03-15"), 0.008);
    assert.equal(rateForDate(rates, "2026-08-01"), 0.01);
  });

  it("returns 0 when no rate covers the day", () => {
    assert.equal(rateForDate(rates, "2025-12-01"), 0);
  });
});

describe("rangesOverlap", () => {
  it("detects open-ended overlaps", () => {
    assert.equal(rangesOverlap("2026-01-01", null, "2026-06-01", "2026-12-31"), true);
    assert.equal(rangesOverlap("2026-01-01", "2026-03-31", "2026-04-01", null), false);
  });
});

describe("extractAgentInventoryDetails", () => {
  it("extracts slim inventory fields from ARG raw", () => {
    const details = extractAgentInventoryDetails(
      {
        type: "microsoft.copilotstudio/agents",
        properties: {
          createdIn: "Copilot Studio",
          orchestration: "Generative",
          model: "gpt-4o",
          authentication: "Microsoft Entra",
          channels: ["Teams", "SharePoint"],
          lastPublishedAt: "2026-02-01T00:00:00Z",
          IsWebSearchEnabledForKnowledge: true,
          sharedWithViewers: { userCount: 3, groupCount: 1, entireTenant: false },
          capabilitiesCounts: {
            distinctPowerPlatformConnectors: 2,
            distinctPowerPlatformConnectorOperations: 5,
          },
          powerPlatformConnectors: [{ connectorId: "shared_office365" }],
        },
      },
      { owner_external: "maker@contoso.com", environment_type: "Production" }
    );
    assert.equal(details.created_in, "Copilot Studio");
    assert.equal(details.orchestration, "Generative");
    assert.deepEqual(details.channels, ["Teams", "SharePoint"]);
    assert.equal(details.web_search_enabled, true);
    assert.equal(details.connector_count, 2);
    assert.equal(details.owner_external, "maker@contoso.com");
    assert.equal(details.environment_type, "Production");
  });
});

describe("aggregateAgentCredits", () => {
  it("sums credits and EUR by agent with BU filter", () => {
    const rates = [
      { effective_from: "2026-01-01", effective_to: null, euro_per_credit: 0.01 },
    ];
    const daily = [
      {
        agent_key: "a1",
        usage_date: "2026-02-01",
        billed_credits: 100,
        unbilled_credits: 50,
        display_name: "Agent One",
        business_unit_id: "bu1",
        business_unit_name: "Finance",
        inventory_details: { created_in: "Copilot Studio", channels: ["Teams"] },
      },
      {
        agent_key: "a1",
        usage_date: "2026-02-02",
        billed_credits: 10,
        unbilled_credits: 0,
        display_name: "Agent One",
        business_unit_id: "bu1",
        business_unit_name: "Finance",
      },
      {
        agent_key: "a2",
        usage_date: "2026-02-01",
        billed_credits: 20,
        unbilled_credits: 0,
        display_name: "Agent Two",
        business_unit_id: null,
      },
    ];
    const all = aggregateAgentCredits(daily, rates);
    assert.equal(all.count, 2);
    assert.equal(all.billed_credits_total, 130);
    assert.equal(all.unbilled_credits_total, 50);
    assert.equal(all.euro_total, 1.3);
    assert.equal(all.billed_euro_total, 1.3);
    assert.equal(all.unbilled_euro_total, 0.5);
    const a1 = all.items.find((i) => i.agent_key === "a1");
    assert.equal(a1.euro, 1.1);
    assert.equal(a1.inventory_details.created_in, "Copilot Studio");

    const bu = aggregateAgentCredits(daily, rates, { businessUnitId: "bu1" });
    assert.equal(bu.count, 1);
    assert.equal(bu.billed_credits_total, 110);

    const unassigned = aggregateAgentCredits(daily, rates, {
      businessUnitId: "__unassigned__",
    });
    assert.equal(unassigned.count, 1);
    assert.equal(unassigned.billed_credits_total, 20);
  });
});

describe("mapUsageRow", () => {
  it("maps kit entity fields", () => {
    const mapped = mapUsageRow(
      {
        cat_agentusagehistoryid: "src-1",
        cat_usagedate: "2026-02-10T00:00:00Z",
        cat_billedcopilotcredits: 12.5,
        cat_nonbilledcopilotcredits: 3,
        cat_agentid: "agent-guid",
        cat_environmentid: "default-aaaa",
        cat_featurename: "Generative answers",
        cat_name: "My Agent",
      },
      "t1"
    );
    assert.equal(mapped.source_id, "src-1");
    assert.equal(mapped.usage_date, "2026-02-10");
    assert.equal(mapped.billed_credits, 12.5);
    assert.equal(mapped.unbilled_credits, 3);
    assert.equal(mapped.agent_resource_id, "agent-guid");
    assert.equal(mapped.environment_id, "Default-aaaa");
    assert.equal(mapped.feature, "Generative answers");
  });
});
