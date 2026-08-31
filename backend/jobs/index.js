// Jobs bootstrap: registers all job handlers and re-exports the runner API.
// Require this once (from index.js) to wire everything up.
const registry = require("./registry");
const runner = require("./runner");
const inventorySources = require("./inventorySources");

registry.register("inventory_sync", require("./handlers/inventorySync"));
registry.register("coe_sync", require("./handlers/coeSync"));
registry.register("powerbi_inventory_sync", require("./handlers/powerbiInventorySync"));
registry.register("components_import", require("./handlers/componentsImport"));
registry.register("copilot_kit_usage_sync", require("./handlers/copilotKitUsageSync"));

module.exports = {
  startJob: runner.startJob,
  startReaper: runner.startReaper,
  listJobTypes: registry.listJobTypes,
  listInventorySources: inventorySources.listInventorySources,
  configuredJobTypes: inventorySources.configuredJobTypes,
  INVENTORY_JOB_TYPES: inventorySources.INVENTORY_JOB_TYPES,
};
