/**
 * Core projects/profiles API smoke (memory store, auth open).
 */
const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  bootstrapTestEnv,
  startTestServer,
  close,
  request,
} = require("./helpers/httpApp");

bootstrapTestEnv();

const { app } = require("../index");
const store = require("../store");

describe("projects API e2e", () => {
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

  it("GET /health returns ok", async () => {
    const res = await request(port, "GET", "/health");
    assert.equal(res.status, 200);
    assert.equal(res.json.status, "ok");
  });

  it("GET /projects returns seeded projects", async () => {
    const res = await request(port, "GET", "/projects");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json));
    assert.ok(res.json.length >= 1);
    assert.ok(res.json.every((p) => p.id && p.name));
  });

  it("GET /projects/:id includes the owner profile", async () => {
    const list = await request(port, "GET", "/projects");
    const withOwner = list.json.find((p) => p.owner_id);
    assert.ok(withOwner, "expected a seeded project with an owner");
    const res = await request(port, "GET", `/projects/${withOwner.id}`);
    assert.equal(res.status, 200);
    assert.ok(res.json.owner_name);
    assert.ok(res.json.owner_email);
  });

  it("POST /projects creates a project", async () => {
    const units = await request(port, "GET", "/tenants/t1/business-units?active=1");
    assert.ok(units.json.length >= 1);
    const res = await request(port, "POST", "/projects", {
      tenant_id: "t1",
      name: "E2E Created Project",
      description: "From API test",
      owner_id: "u1",
      status: "draft",
      business_unit_id: units.json[0].id,
      answers: { cq1: "Internal Team", cq2: "1-10" },
    });
    assert.equal(res.status, 201);
    assert.ok(res.json.id);

    const list = await request(port, "GET", "/projects");
    assert.ok(list.json.some((p) => p.id === res.json.id && p.name === "E2E Created Project"));
  });

  it("POST /projects rejects empty description", async () => {
    const units = await request(port, "GET", "/tenants/t1/business-units?active=1");
    const res = await request(port, "POST", "/projects", {
      tenant_id: "t1",
      name: "Missing Description",
      description: "   ",
      owner_id: "u1",
      status: "draft",
      business_unit_id: units.json[0].id,
      answers: { cq1: "Internal Team", cq2: "1-10" },
    });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /description required/i);
  });

  it("links a component whose location matches no project label", async () => {
    const units = await request(port, "GET", "/tenants/t1/business-units?active=1");
    const project = await request(port, "POST", "/projects", {
      tenant_id: "t1",
      name: "Project With Remote Component",
      description: "Component linkage test",
      owner_id: "u1",
      status: "draft",
      business_unit_id: units.json[0].id,
      answers: { cq1: "Internal Team", cq2: "1-10" },
    });
    assert.equal(project.status, 201);

    const created = await request(port, "POST", "/components", [
      {
        tenant_id: "t1",
        name: "Remote Report",
        type: "Power BI",
        environments: ["Contoso Analytics (prod)"],
        owner_id: "u1",
        status: "unassigned",
        url: "https://app.powerbi.com/groups/me/reports/remote",
      },
    ]);
    assert.equal(created.status, 201);
    const componentId = created.json[0].id;

    const link = await request(port, "POST", "/project-components", [
      { project_id: project.json.id, component_id: componentId },
    ]);
    assert.equal(link.status, 201);

    const ids = await request(
      port,
      "GET",
      `/project-components?project_id=${encodeURIComponent(project.json.id)}`
    );
    assert.deepEqual(ids.json, [componentId]);

    const components = await request(port, "GET", `/components?ids=${encodeURIComponent(componentId)}`);
    assert.equal(components.json.length, 1);
    assert.equal(components.json[0].name, "Remote Report");

    const removed = await request(port, "DELETE", "/project-components", {
      project_id: project.json.id,
      component_id: componentId,
    });
    assert.equal(removed.status, 204);

    const after = await request(
      port,
      "GET",
      `/project-components?project_id=${encodeURIComponent(project.json.id)}`
    );
    assert.deepEqual(after.json, []);
  });

  it("GET /profiles returns profiles", async () => {
    const res = await request(port, "GET", "/profiles");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json));
    assert.ok(res.json.length >= 1);
  });
});
