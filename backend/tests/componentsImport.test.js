const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { bootstrapTestEnv } = require("./helpers/httpApp");

bootstrapTestEnv();

const { assertImportScope } = require("../jobs/handlers/componentsImport");
const { canonicalizeEnvironmentId, environmentKey } = require("../environmentIds");
const memoryStore = require("../memoryStore");

describe("assertImportScope", () => {
  it("rejects empty kinds", () => {
    assert.throws(() => assertImportScope([], ["env-1"], []), /component type/i);
  });

  it("requires environments for Power Platform kinds", () => {
    assert.throws(
      () => assertImportScope(["canvasapp"], [], []),
      /environment/i
    );
  });

  it("requires workspaces for Power BI kinds", () => {
    assert.throws(
      () => assertImportScope(["powerbi_report"], [], []),
      /workspace/i
    );
  });

  it("allows PP kinds with environments only", () => {
    assert.doesNotThrow(() => assertImportScope(["agent"], ["env-1"], []));
  });

  it("allows PBI kinds with workspaces only", () => {
    assert.doesNotThrow(() =>
      assertImportScope(["powerbi_dashboard"], [], ["ws-1"])
    );
  });

  it("allows mixed kinds when both scopes are set", () => {
    assert.doesNotThrow(() =>
      assertImportScope(["canvasapp", "powerbi_report"], ["env-1"], ["ws-1"])
    );
  });
});

describe("canonicalizeEnvironmentId", () => {
  it("normalizes default- prefix casing", () => {
    assert.equal(
      canonicalizeEnvironmentId("default-c989b650-28e2-456f-bbdc-d6020ef438ea"),
      "Default-c989b650-28e2-456f-bbdc-d6020ef438ea"
    );
    assert.equal(
      canonicalizeEnvironmentId("Default-c989b650-28e2-456f-bbdc-d6020ef438ea"),
      "Default-c989b650-28e2-456f-bbdc-d6020ef438ea"
    );
  });

  it("leaves non-default ids unchanged", () => {
    assert.equal(canonicalizeEnvironmentId("20f8e54d-a238-405b-94fe-4f973a2d1487"), "20f8e54d-a238-405b-94fe-4f973a2d1487");
  });
});

describe("environmentKey", () => {
  it("treats every spelling of the default environment as one id", () => {
    const guid = "c989b650-28e2-456f-bbdc-d6020ef438ea";
    assert.equal(environmentKey(`Default-${guid}`), guid);
    assert.equal(environmentKey(`default-${guid}`), guid);
    assert.equal(environmentKey(guid), guid);
  });

  it("is empty for missing ids", () => {
    assert.equal(environmentKey(null), "");
    assert.equal(environmentKey(""), "");
  });
});

describe("importComponentsFromInventory case-insensitive env match", () => {
  it("imports agents when inventory env id casing differs from settings", () => {
    memoryStore.resetStore();
    const tenantId = "t1";
    const invId = "aa09f07c-b70f-41b4-a16f-c0237ee8eb2a";
    const ownerId = "u1";
    const syncedAt = new Date().toISOString();

    memoryStore.upsertInventoryItems(
      tenantId,
      [
        {
          resource_id: "49464cc3-834b-4dda-a5fd-d576aaab1da2",
          resource_type: "microsoft.copilotstudio/agents",
          kind: "agent",
          display_name: "Inventory Test 001",
          environment_id: "default-c989b650-28e2-456f-bbdc-d6020ef438ea",
          scope_type: "environment",
          scope_id: "default-c989b650-28e2-456f-bbdc-d6020ef438ea",
          owner_aad_id: ownerId,
          raw: {},
        },
        {
          resource_id: "Default-c989b650-28e2-456f-bbdc-d6020ef438ea",
          resource_type: "microsoft.powerplatform/environments",
          kind: "environment",
          display_name: "Personal Productivity",
          environment_id: "Default-c989b650-28e2-456f-bbdc-d6020ef438ea",
          scope_type: "environment",
          scope_id: "Default-c989b650-28e2-456f-bbdc-d6020ef438ea",
          raw: { properties: {} },
        },
      ],
      syncedAt
    );

    // Simulate already-synced inventory that kept lowercase env ids from Microsoft.
    const inv = memoryStore
      .getInventoryItems({ tenant_id: tenantId, kind: "agent" })
      .find((r) => r.display_name === "Inventory Test 001");
    assert.ok(inv);
    inv.id = invId;
    inv.environment_id = "default-c989b650-28e2-456f-bbdc-d6020ef438ea";
    inv.scope_id = "default-c989b650-28e2-456f-bbdc-d6020ef438ea";

    memoryStore.syncEnvironmentsFromInventory(tenantId, syncedAt);

    const preview = memoryStore.previewComponentImport(tenantId, {
      kinds: ["agent"],
      environmentIds: ["Default-c989b650-28e2-456f-bbdc-d6020ef438ea"],
      workspaceIds: [],
    });
    assert.equal(preview.count, 1);
    assert.equal(preview.by_kind.agent, 1);

    const stats = memoryStore.importComponentsFromInventory(tenantId, {
      kinds: ["agent"],
      environmentIds: ["Default-c989b650-28e2-456f-bbdc-d6020ef438ea"],
      workspaceIds: [],
    });
    assert.equal(stats.matched, 1);
    assert.ok(stats.inserted + stats.updated >= 1);

    const comps = memoryStore.getComponents(ownerId);
    const created = comps.find((c) => c.source_inventory_id === invId || c.name === "Inventory Test 001");
    assert.ok(created, "expected component to be created from inventory agent");
    assert.equal(created.kind, "agent");
    assert.equal(created.environment_id, "Default-c989b650-28e2-456f-bbdc-d6020ef438ea");
    assert.deepEqual(created.environments, ["Personal Productivity"]);
  });

  it("imports items the admin APIs report under the bare environment guid", () => {
    memoryStore.resetStore();
    const tenantId = "t1";
    const ownerId = "u1";
    const guid = "c989b650-28e2-456f-bbdc-d6020ef438ea";
    const syncedAt = new Date().toISOString();

    memoryStore.upsertInventoryItems(
      tenantId,
      [
        {
          resource_id: "6b1f0a5e-2f6e-4a8e-9f1a-2c9d3b7e4a10",
          resource_type: "microsoft.copilotstudio/agents",
          kind: "agent",
          display_name: "Inventory Test 002",
          environment_id: guid,
          scope_type: "environment",
          scope_id: guid,
          owner_aad_id: ownerId,
          raw: {},
        },
        {
          resource_id: `Default-${guid}`,
          resource_type: "microsoft.powerplatform/environments",
          kind: "environment",
          display_name: "Personal Productivity",
          environment_id: `Default-${guid}`,
          scope_type: "environment",
          scope_id: `Default-${guid}`,
          raw: { properties: {} },
        },
      ],
      syncedAt
    );

    memoryStore.syncEnvironmentsFromInventory(tenantId, syncedAt);

    const stats = memoryStore.importComponentsFromInventory(tenantId, {
      kinds: ["agent"],
      environmentIds: [`Default-${guid}`],
      workspaceIds: [],
    });
    assert.equal(stats.matched, 1);

    const created = memoryStore
      .getComponents(ownerId)
      .find((c) => c.name === "Inventory Test 002");
    assert.ok(created, "bare-guid environment items must import too");
    assert.equal(created.environment_id, `Default-${guid}`);
    assert.deepEqual(created.environments, ["Personal Productivity"]);
  });
});
