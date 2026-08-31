require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { query, pool } = require("../db");

async function migrate() {
  if (!pool) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const schema = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");
  await query(schema);
  console.log("Schema applied successfully");
  await pool.end();
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
