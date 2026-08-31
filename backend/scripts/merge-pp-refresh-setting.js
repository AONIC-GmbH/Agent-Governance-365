// Merges PP_REFRESH_TOKEN into appsettings list JSON for az rest PUT.
// Usage: node merge-pp-refresh-setting.js <list.json> <kv-ref-value> <out.json>
const fs = require("fs");
const [listPath, kvRef, outPath] = process.argv.slice(2);
if (!listPath || !kvRef || !outPath) {
  console.error("Usage: node merge-pp-refresh-setting.js <list.json> <kv-ref> <out.json>");
  process.exit(1);
}
const raw = fs.readFileSync(listPath, "utf8").replace(/^\uFEFF/, "");
const list = JSON.parse(raw);
const props = { ...(list.properties || {}) };
props.PP_REFRESH_TOKEN = kvRef;
if (!props.PP_INVENTORY_AUTH) props.PP_INVENTORY_AUTH = "delegated";
fs.writeFileSync(outPath, JSON.stringify({ properties: props }));
console.log("prepared put body; PP_REFRESH_TOKEN len=" + props.PP_REFRESH_TOKEN.length);
