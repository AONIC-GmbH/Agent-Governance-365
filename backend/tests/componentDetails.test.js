const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  extractComponentInventoryDetails,
  extractPowerAppDetails,
  extractCloudFlowDetails,
  extractPowerBiDetails,
} = require("../inventory/componentDetails");

describe("extractPowerAppDetails", () => {
  it("extracts quarantine and model-driven ids without connectors", () => {
    const d = extractPowerAppDetails(
      {
        properties: {
          lastModifiedAt: "2026-02-01T00:00:00Z",
          isQuarantined: true,
          logicalName: "contoso_expense",
          appModuleId: "mod-1",
        },
      },
      { environment_type: "Production" }
    );
    assert.equal(d.is_quarantined, true);
    assert.equal(d.logical_name, "contoso_expense");
    assert.equal(d.environment_type, "Production");
    assert.equal(d.connector_count, undefined);
  });
});

describe("extractCloudFlowDetails", () => {
  it("extracts trigger fields", () => {
    const d = extractCloudFlowDetails({
      properties: {
        trigger: "sharepointonline",
        triggerOperation: "GetOnNewItems",
        workflowEntityId: "wf-1",
      },
    });
    assert.equal(d.trigger, "sharepointonline");
    assert.equal(d.trigger_operation, "GetOnNewItems");
    assert.equal(d.workflow_entity_id, "wf-1");
  });
});

describe("extractPowerBiDetails", () => {
  it("reads dedicated capacity from workspace raw", () => {
    const d = extractPowerBiDetails(
      {
        reportType: "PowerBIReport",
        datasetId: "ds-1",
        createdBy: "Ada",
        workspaceId: "ws-1",
      },
      {
        name: "Finance WS",
        type: "Workspace",
        state: "Active",
        isOnDedicatedCapacity: true,
        capacityId: "cap-1",
      }
    );
    assert.equal(d.workspace_name, "Finance WS");
    assert.equal(d.is_on_dedicated_capacity, true);
    assert.equal(d.capacity_id, "cap-1");
    assert.equal(d.report_type, "PowerBIReport");
    assert.equal(d.dataset_id, "ds-1");
  });
});

describe("extractComponentInventoryDetails", () => {
  it("routes by kind", () => {
    const agent = extractComponentInventoryDetails("agent", {
      properties: { createdIn: "Copilot Studio", channels: ["Teams"] },
    });
    assert.equal(agent.family, "agent");
    assert.equal(agent.created_in, "Copilot Studio");

    const app = extractComponentInventoryDetails("canvasapp", {
      properties: { isQuarantined: false },
    });
    assert.equal(app.family, "powerapp");
    assert.equal(app.app_kind, "canvasapp");

    const flow = extractComponentInventoryDetails("cloudflow", {
      properties: { trigger: "manual" },
    });
    assert.equal(flow.family, "cloudflow");
    assert.equal(flow.trigger, "manual");
  });
});
