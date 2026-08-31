// Dev helper: grant a user the admin role and create some sample projects/
// components owned by them. Idempotent (safe to re-run).
//
// Usage:  node scripts/seed-dev-user.js <email>
require("dotenv").config();
const { query } = require("../db");

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: node scripts/seed-dev-user.js <email>");
    process.exit(1);
  }

  const prof = await query(
    "SELECT id, tenant_id, full_name FROM profiles WHERE lower(email) = lower($1)",
    [email]
  );
  if (prof.rowCount === 0) {
    console.error(`No profile found for ${email}. Log in to the app once first.`);
    const all = await query("SELECT email FROM profiles ORDER BY email");
    console.error("Known profiles:", all.rows.map((r) => r.email).join(", ") || "(none)");
    process.exit(1);
  }

  const { id: userId, tenant_id: tenantId, full_name } = prof.rows[0];
  console.log(`Profile: ${full_name} <${email}>  id=${userId}  tenant=${tenantId}`);

  // 1) Roles — grant admin (and keep base user role).
  await query(
    "INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin') ON CONFLICT (user_id, role) DO NOTHING",
    [userId]
  );
  await query(
    "INSERT INTO user_roles (user_id, role) VALUES ($1, 'user') ON CONFLICT (user_id, role) DO NOTHING",
    [userId]
  );
  console.log("Granted 'admin' role.");

  const p = `dev-${userId.slice(0, 8)}`;

  // 2) Sample components owned by the user.
  const components = [
    [`${p}-c1`, "Sales Dashboard Q1", "Power BI", ["Development", "Production"], "unassigned", "https://app.powerbi.com/groups/me/reports/sales-q1"],
    [`${p}-c2`, "Approval Workflow", "Power Automate", ["Development", "Production"], "unassigned", "https://make.powerautomate.com/flows/approval"],
    [`${p}-c3`, "Inventory Tracker", "Power App", ["Development"], "unassigned", "https://apps.powerapps.com/play/inventory-tracker"],
  ];
  for (const [id, name, type, envs, status, url] of components) {
    await query(
      `INSERT INTO components (id, tenant_id, name, type, environments, owner_id, status, url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      [id, tenantId, name, type, envs, userId, status, url]
    );
  }
  console.log(`Inserted ${components.length} components.`);

  // 3) Sample projects owned by the user.
  const projects = [
    [`${p}-s1`, "Sales Analytics Suite", "Complete sales reporting and analytics solution", "approved"],
    [`${p}-s2`, "Inventory Management", "End-to-end inventory tracking system", "draft"],
  ];
  for (const [id, name, description, status] of projects) {
    await query(
      `INSERT INTO projects (id, tenant_id, name, description, owner_id, status, answers)
       VALUES ($1,$2,$3,$4,$5,$6,'{}'::jsonb) ON CONFLICT (id) DO NOTHING`,
      [id, tenantId, name, description, userId, status]
    );
  }
  console.log(`Inserted ${projects.length} projects.`);

  // 4) Link a couple of components to the first project.
  const links = [
    [`${p}-s1`, `${p}-c1`],
    [`${p}-s1`, `${p}-c2`],
    [`${p}-s2`, `${p}-c3`],
  ];
  for (const [projectId, componentId] of links) {
    await query(
      `INSERT INTO project_components (project_id, component_id)
       VALUES ($1,$2) ON CONFLICT (project_id, component_id) DO NOTHING`,
      [projectId, componentId]
    );
  }
  console.log(`Linked ${links.length} project-components.`);

  console.log("\nDone. Sign out and back in (or hard refresh) to pick up the admin role.");
  process.exit(0);
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
