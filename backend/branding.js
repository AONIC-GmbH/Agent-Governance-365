/** Tenant logo / branding helpers shared by API and tests. */

const crypto = require("crypto");

const LOGO_MAX_BYTES = 512 * 1024;
const LOGO_ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function validateLogoUpload(buffer, contentType) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { ok: false, status: 400, error: "Logo body required" };
  }
  if (buffer.length > LOGO_MAX_BYTES) {
    return { ok: false, status: 400, error: `Logo must be at most ${LOGO_MAX_BYTES} bytes (512 KB)` };
  }
  const type = String(contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!LOGO_ALLOWED_TYPES.has(type)) {
    return {
      ok: false,
      status: 400,
      error: "Logo must be PNG, JPEG, or WebP",
    };
  }
  return { ok: true, contentType: type };
}

function publicTenant(row) {
  if (!row) return null;
  const hasLogo = Boolean(
    row.logo_bytes &&
      (Buffer.isBuffer(row.logo_bytes)
        ? row.logo_bytes.length > 0
        : row.logo_bytes.length || row.logo_bytes.byteLength)
  );
  return {
    id: row.id,
    name: row.name,
    tool_name: row.tool_name || "Runpipe",
    created_at: row.created_at,
    has_logo: hasLogo,
    // Content-derived so clients bust the image cache when the logo is replaced.
    logo_version: hasLogo
      ? crypto.createHash("sha1").update(Buffer.from(row.logo_bytes)).digest("hex").slice(0, 12)
      : null,
  };
}

module.exports = {
  LOGO_MAX_BYTES,
  LOGO_ALLOWED_TYPES,
  validateLogoUpload,
  publicTenant,
};
