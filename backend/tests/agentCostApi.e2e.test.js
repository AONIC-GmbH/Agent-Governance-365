/**
 * End-to-end API tests for agent credits + rate cards (memory store).
 */
const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  bootstrapTestEnv,
  startTestServer,
  close,
  request,
} = require("./helpers/httpApp");

bootstrapTestEnv();

const { app } = require("../index");
const store = require("../store");

describe("agent credits API e2e", () => {
  let server;
  let port;

  before(async () => {
    ({ server, port } = await startTestServer(app));
  });

  after(async () => {
    await close(server);
  });

  beforeEach(async () => {
    await store.resetStore();
    const syncedAt = new Date().toISOString();
    await store.upsertInventoryItems(
      "t1",
      [
        {
          resource_id: "agent-classic-1",
          resource_type: "microsoft.copilotstudio/agents",
          kind: "agent",
          display_name: "Classic FAQ",
          environment_id: "env-1",
          scope_type: "environment",
          scope_id: "env-1",
          owner_external: "owner@contoso.com",
          raw: {
            type: "microsoft.copilotstudio/agents",
            properties: {
              createdIn: "Copilot Studio",
              orchestration: "Classic",
              channels: ["Teams"],
              authentication: "Microsoft Entra",
              lastPublishedAt: "2026-01-15T00:00:00Z",
              IsWebSearchEnabledForKnowledge: false,
            },
          },
        },
      ],
      syncedAt
    );
    await store.upsertAgentUsageDaily(
      "t1",
      [
        {
          source_id: "usage-1",
          usage_date: "2026-02-10",
          billed_credits: 100,
          unbilled_credits: 25,
          agent_resource_id: "agent-classic-1",
          environment_id: "env-1",
          feature: null,
          display_name: "Classic FAQ",
          raw: {},
        },
      ],
      syncedAt
    );
    await store.linkAgentUsageToInventory("t1");
    await store.replaceCreditRateCards(
      "t1",
      [{ label: "2026", euro_per_credit: 0.01, effective_from: "2026-01-01", effective_to: null }],
      null
    );
  });

  it("GET /admin/agent-credits returns totals and EUR", async () => {
    const res = await request(
      port,
      "GET",
      "/admin/agent-credits?from=2026-02-01&to=2026-02-28"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.billed_credits_total, 100);
    assert.equal(res.json.unbilled_credits_total, 25);
    assert.equal(res.json.euro_total, 1);
    assert.equal(res.json.billed_euro_total, 1);
    assert.equal(res.json.items[0].euro, 1);
    assert.equal(res.json.items[0].inventory_details.created_in, "Copilot Studio");
    assert.deepEqual(res.json.items[0].inventory_details.channels, ["Teams"]);
    assert.equal(res.json.items[0].inventory_details.owner_external, "owner@contoso.com");
    assert.equal(res.json.count, 1);
    assert.equal(res.json.items[0].display_name, "Classic FAQ");
  });

  it("GET /admin/agent-credits requires from/to", async () => {
    const res = await request(port, "GET", "/admin/agent-credits");
    assert.equal(res.status, 400);
  });

  it("PUT /admin/credit-rate-cards replaces cards", async () => {
    const res = await request(port, "PUT", "/admin/credit-rate-cards", {
      cards: [
        {
          label: "H1",
          euro_per_credit: 0.008,
          effective_from: "2026-01-01",
          effective_to: "2026-06-30",
        },
      ],
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.length, 1);
    assert.equal(res.json[0].euro_per_credit, 0.008);

    const list = await request(port, "GET", "/admin/credit-rate-cards");
    assert.equal(list.status, 200);
    assert.equal(list.json.length, 1);
  });

  it("rejects overlapping rate cards", async () => {
    const res = await request(port, "PUT", "/admin/credit-rate-cards", {
      cards: [
        { euro_per_credit: 0.01, effective_from: "2026-01-01", effective_to: null },
        { euro_per_credit: 0.02, effective_from: "2026-06-01", effective_to: "2026-12-31" },
      ],
    });
    assert.equal(res.status, 400);
  });
});
