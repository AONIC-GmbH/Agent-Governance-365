const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { validateLogoUpload, publicTenant, LOGO_MAX_BYTES } = require("../branding");

describe("validateLogoUpload", () => {
  it("rejects empty body", () => {
    const r = validateLogoUpload(Buffer.alloc(0), "image/png");
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
  });

  it("rejects oversized logo", () => {
    const r = validateLogoUpload(Buffer.alloc(LOGO_MAX_BYTES + 1), "image/png");
    assert.equal(r.ok, false);
    assert.match(r.error, /512 KB/);
  });

  it("rejects unsupported type", () => {
    const r = validateLogoUpload(Buffer.from("x"), "image/svg+xml");
    assert.equal(r.ok, false);
    assert.match(r.error, /PNG, JPEG, or WebP/);
  });

  it("accepts png under limit", () => {
    const r = validateLogoUpload(Buffer.from([1, 2, 3]), "image/png");
    assert.equal(r.ok, true);
    assert.equal(r.contentType, "image/png");
  });

  it("strips charset from content-type", () => {
    const r = validateLogoUpload(Buffer.from([1]), "image/jpeg; charset=binary");
    assert.equal(r.ok, true);
    assert.equal(r.contentType, "image/jpeg");
  });
});

describe("publicTenant", () => {
  it("hides logo bytes and sets has_logo", () => {
    const pub = publicTenant({
      id: "t1",
      name: "Acme",
      tool_name: "AcmePipe",
      created_at: "2025-01-01T00:00:00.000Z",
      logo_bytes: Buffer.from("abc"),
      logo_content_type: "image/png",
    });
    assert.equal(pub.has_logo, true);
    assert.equal(pub.tool_name, "AcmePipe");
    assert.equal(pub.logo_bytes, undefined);
  });

  it("defaults tool_name", () => {
    const pub = publicTenant({
      id: "t1",
      name: "Acme",
      created_at: "2025-01-01T00:00:00.000Z",
      logo_bytes: null,
    });
    assert.equal(pub.tool_name, "Runpipe");
    assert.equal(pub.has_logo, false);
  });
});
