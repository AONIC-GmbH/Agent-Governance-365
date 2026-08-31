/**
 * Power Platform reports the same environment under several ids: the admin APIs
 * return the bare `{guid}` while the platform APIs prefix the default environment
 * as `Default-{guid}` (sometimes lowercased). The guid is the real identity, so
 * `environmentKey` is what we match on and `canonicalizeEnvironmentId` is the
 * spelling we store.
 */
function canonicalizeEnvironmentId(id) {
  if (id == null || id === "") return id;
  const s = String(id);
  const m = /^default-(.+)$/i.exec(s);
  return m ? `Default-${m[1]}` : s;
}

/** Identity of an environment, independent of prefix and casing. */
function environmentKey(id) {
  if (id == null || id === "") return "";
  return String(id).replace(/^default-/i, "").toLowerCase();
}

function lowerId(id) {
  return id == null || id === "" ? "" : String(id).toLowerCase();
}

module.exports = { canonicalizeEnvironmentId, environmentKey, lowerId };
