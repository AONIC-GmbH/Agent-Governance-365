const pp = require("../powerPlatform/client");
const pbi = require("../powerBi/client");
const { kit } = require("../dataverse/client");

const INVENTORY_SOURCES = [
  {
    job_type: "inventory_sync",
    label: "Power Platform",
    configured: () => Boolean(pp.ppEnabled),
  },
  {
    job_type: "powerbi_inventory_sync",
    label: "Power BI",
    configured: () => Boolean(pbi.pbiEnabled),
  },
  {
    job_type: "copilot_kit_usage_sync",
    label: "Copilot Kit usage",
    configured: () => Boolean(kit.enabled),
  },
];

function listInventorySources() {
  return INVENTORY_SOURCES.map((s) => ({
    job_type: s.job_type,
    label: s.label,
    configured: s.configured(),
  }));
}

function configuredJobTypes() {
  return listInventorySources()
    .filter((s) => s.configured)
    .map((s) => s.job_type);
}

module.exports = {
  INVENTORY_JOB_TYPES: INVENTORY_SOURCES.map((s) => s.job_type),
  listInventorySources,
  configuredJobTypes,
};
