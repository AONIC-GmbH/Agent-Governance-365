const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { listInventorySources, INVENTORY_JOB_TYPES } = require("../jobs/inventorySources");

describe("inventory sources", () => {
  it("lists Power Platform, Power BI, and Copilot Kit usage", () => {
    const sources = listInventorySources();
    assert.deepEqual(
      sources.map((s) => s.job_type),
      [...INVENTORY_JOB_TYPES]
    );
    for (const s of sources) {
      assert.equal(typeof s.label, "string");
      assert.ok(s.label.length > 0);
      assert.equal(typeof s.configured, "boolean");
    }
  });
});
