require("dotenv").config();
const fs = require("fs");
const { Pool } = require("pg");

// Build the TLS config for Postgres. Certificate verification is ON by default
// (Azure Postgres certs chain to CAs already trusted by Node). Overrides:
//   DATABASE_SSL_CA                  - PEM file path or inline PEM to pin a CA
//   DATABASE_SSL_REJECT_UNAUTHORIZED - set to "false" only as a temporary
//                                      fallback if verification fails (insecure)
function buildSslConfig() {
  if (process.env.DATABASE_SSL !== "true") return undefined;
  const rejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false";
  const caEnv = process.env.DATABASE_SSL_CA;
  let ca;
  if (caEnv) {
    ca = caEnv.includes("BEGIN CERTIFICATE") ? caEnv : fs.readFileSync(caEnv, "utf8");
  }
  return { rejectUnauthorized, ...(ca ? { ca } : {}) };
}

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: buildSslConfig(),
    })
  : null;

async function query(text, params) {
  if (!pool) throw new Error("DATABASE_URL is not configured");
  return pool.query(text, params);
}

module.exports = { pool, query };
