/**
 * Shared HTTP helpers for backend API e2e tests (memory store, auth open).
 * Call bootstrapTestEnv() before requiring ../index or ../store.
 */
const http = require("node:http");

function bootstrapTestEnv() {
  // Force memory store + open auth even if backend/.env has Azure Postgres / Entra.
  process.env.USE_MEMORY_STORE = "1";
  process.env.DATABASE_URL = "";
  process.env.ENTRA_TENANT_ID = "your-test-tenant";
  process.env.ENTRA_CLIENT_ID = "your-test-client";
  process.env.DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || "t1";
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : null);
    });
    server.on("error", reject);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function request(port, method, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

async function startTestServer(app) {
  const server = http.createServer(app);
  const port = await listen(server);
  return { server, port };
}

module.exports = {
  bootstrapTestEnv,
  listen,
  close,
  request,
  startTestServer,
};
