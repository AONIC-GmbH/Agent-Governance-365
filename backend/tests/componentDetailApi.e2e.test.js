/**
 * End-to-end API tests for admin component detail.
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

describe("admin component detail API e2e", () => {
  let server;
  let port;
  let componentId;

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
          resource_id: "env-1",
          resource_type: "microsoft.powerplatform/environments",
          kind: "environment",
          display_name: "Dev Env",
          environment_id: "env-1",
          scope_type: "environment",
          scope_id: "env-1",
          raw: { properties: { environmentType: "Sandbox", displayName: "Dev Env" } },
        },
        {
          resource_id: "flow-1",
          resource_type: "microsoft.powerautomate/cloudflows",
          kind: "cloudflow",
          display_name: "Invoice flow",
          environment_id: "env-1",
          scope_type: "environment",
          scope_id: "env-1",
          raw: {
            properties: {
              trigger: "sharepointonline",
              triggerOperation: "GetOnNewItems",
              lastModifiedAt: "2026-03-01T00:00:00Z",
            },
          },
        },
      ],
      syncedAt
    );
    await store.syncEnvironmentsFromInventory("t1", syncedAt);
    await store.importComponentsFromInventory("t1", {
      kinds: ["cloudflow"],
      environmentIds: ["env-1"],
      workspaceIds: [],
    });
    const comps = await store.getAdminComponents("t1");
    const flow = comps.find((c) => c.type === "cloudflow" || c.name === "Invoice flow");
    assert.ok(flow, "expected imported cloudflow component");
    componentId = flow.id;
  });

  it("GET /admin/components/:id returns inventory details and Unassigned project", async () => {
    const res = await request(port, "GET", `/admin/components/${componentId}`);
    assert.equal(res.status, 200);
    assert.equal(res.json.name, "Invoice flow");
    assert.equal(res.json.is_assigned, false);
    assert.equal(res.json.project_id, null);
    assert.equal(res.json.inventory_details.family, "cloudflow");
    assert.equal(res.json.inventory_details.trigger, "sharepointonline");
    assert.equal(res.json.inventory_details.trigger_operation, "GetOnNewItems");
  });

  it("returns 404 for unknown component", async () => {
    const res = await request(port, "GET", "/admin/components/missing-id");
    assert.equal(res.status, 404);
  });
});
