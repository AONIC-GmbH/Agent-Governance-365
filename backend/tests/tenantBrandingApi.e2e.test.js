const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { bootstrapTestEnv, request, startTestServer, close } = require("./helpers/httpApp");

bootstrapTestEnv();
const { app } = require("../index");
const store = require("../store");

describe("tenant branding + intake API", () => {
  let server;
  let port;

  before(async () => {
    ({ server, port } = await startTestServer(app));
  });

  after(async () => {
    await close(server);
  });

  beforeEach(async () => {
    await store.resetStore();
  });

  it("GET /branding returns public tenant shape", async () => {
    const { status, json } = await request(port, "GET", "/branding");
    assert.equal(status, 200);
    assert.equal(json.id, "t1");
    assert.equal(json.tool_name, "Runpipe");
    assert.equal(json.has_logo, false);
    assert.equal(json.logo_bytes, undefined);
  });

  it("PATCH tenant updates name and tool_name", async () => {
    const { status, json } = await request(port, "PATCH", "/tenants/t1", {
      name: "Acme Corp",
      tool_name: "AcmePipe",
    });
    assert.equal(status, 200);
    assert.equal(json.name, "Acme Corp");
    assert.equal(json.tool_name, "AcmePipe");
  });

  it("rejects oversized logo upload", async () => {
    const big = Buffer.alloc(512 * 1024 + 1, 1);
    const res = await fetch(`http://127.0.0.1:${port}/tenants/t1/logo`, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: big,
    });
    assert.equal(res.status, 400);
  });

  it("uploads and serves logo", async () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const put = await fetch(`http://127.0.0.1:${port}/tenants/t1/logo`, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: png,
    });
    assert.equal(put.status, 200);

    const branding = await request(port, "GET", "/tenants/t1");
    assert.equal(branding.json.has_logo, true);

    const get = await fetch(`http://127.0.0.1:${port}/tenants/t1/logo`);
    assert.equal(get.status, 200);
    assert.equal(get.headers.get("content-type"), "image/png");
    const buf = Buffer.from(await get.arrayBuffer());
    assert.deepEqual(buf, png);
  });

  it("CRUD business units and compliance questions", async () => {
    const created = await request(port, "POST", "/tenants/t1/business-units", {
      name: "Finance",
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.name, "Finance");

    const list = await request(port, "GET", "/tenants/t1/business-units?active=1");
    assert.ok(list.json.some((u) => u.name === "Finance"));

    const q = await request(port, "POST", "/tenants/t1/compliance-questions", {
      prompt: "Is this regulated?",
      answer_type: "select",
      options: ["Yes", "No"],
      required: true,
    });
    assert.equal(q.status, 201);

    const qList = await request(port, "GET", "/tenants/t1/compliance-questions?active=1");
    assert.ok(qList.json.some((x) => x.prompt === "Is this regulated?"));
  });

  it("POST /projects requires business_unit_id when units exist", async () => {
    const units = await request(port, "GET", "/tenants/t1/business-units?active=1");
    assert.ok(units.json.length > 0);

    const missing = await request(port, "POST", "/projects", {
      tenant_id: "t1",
      name: "No unit",
      description: "E2E test project",
      owner_id: "u1",
      status: "draft",
      answers: { cq1: "Internal Team", cq2: "1-10" },
    });
    assert.equal(missing.status, 400);
    assert.match(missing.json.error, /business_unit_id/);

    const ok = await request(port, "POST", "/projects", {
      tenant_id: "t1",
      name: "With unit",
      description: "E2E test project",
      owner_id: "u1",
      status: "draft",
      business_unit_id: units.json[0].id,
      answers: { cq1: "Internal Team", cq2: "1-10" },
    });
    assert.equal(ok.status, 201);
    assert.ok(ok.json.id);

    const missingAnswer = await request(port, "POST", "/projects", {
      tenant_id: "t1",
      name: "Missing answers",
      description: "E2E test project",
      owner_id: "u1",
      status: "draft",
      business_unit_id: units.json[0].id,
      answers: {},
    });
    assert.equal(missingAnswer.status, 400);
    assert.match(missingAnswer.json.error, /Answer required/);
  });
});
