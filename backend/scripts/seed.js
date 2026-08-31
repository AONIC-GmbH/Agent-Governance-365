require("dotenv").config();
const { query, pool } = require("../db");
const { buildInitialState } = require("../seedData");

async function seed() {
  if (!pool) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const { rows } = await query("SELECT COUNT(*)::int AS count FROM tenants");
  if (rows[0].count > 0) {
    console.log("Database already seeded, skipping");
    await pool.end();
    return;
  }

  const state = buildInitialState();

  await query(
    "INSERT INTO tenants (id, name, tool_name, created_at) VALUES ($1, $2, $3, $4)",
    [state.tenant.id, state.tenant.name, state.tenant.tool_name || "Runpipe", state.tenant.created_at]
  );

  for (const p of state.profiles) {
    await query(
      "INSERT INTO profiles (id, tenant_id, full_name, email, created_at) VALUES ($1, $2, $3, $4, $5)",
      [p.id, p.tenant_id, p.full_name, p.email, p.created_at ?? new Date()]
    );
  }

  for (const r of state.userRoles) {
    await query("INSERT INTO user_roles (id, user_id, role) VALUES ($1, $2, $3)", [
      `ur-${r.user_id}-${r.role}`,
      r.user_id,
      r.role,
    ]);
  }

  for (const c of state.components) {
    await query(
      `INSERT INTO components (id, tenant_id, name, type, environments, owner_id, created_at, status, url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [c.id, c.tenant_id, c.name, c.type, c.environments, c.owner_id, c.created_at, c.status, c.url]
    );
  }

  for (const p of state.projects) {
    await query(
      `INSERT INTO projects (id, tenant_id, name, description, owner_id, status, created_at, service_user,
        production_access_status, production_deploy_status, answers, business_unit_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        p.id,
        p.tenant_id,
        p.name,
        p.description,
        p.owner_id,
        p.status,
        p.created_at,
        p.service_user,
        p.production_access_status,
        p.production_deploy_status ?? "none",
        JSON.stringify(p.answers ?? {}),
        p.business_unit_id ?? null,
      ]
    );
  }

  for (const bu of state.businessUnits || []) {
    await query(
      `INSERT INTO business_units (id, tenant_id, name, sort_order, is_active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [bu.id, bu.tenant_id, bu.name, bu.sort_order, bu.is_active, bu.created_at]
    );
  }

  for (const cq of state.complianceQuestions || []) {
    await query(
      `INSERT INTO compliance_questions
         (id, tenant_id, prompt, answer_type, options, required, sort_order, is_active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        cq.id,
        cq.tenant_id,
        cq.prompt,
        cq.answer_type,
        cq.options || [],
        cq.required,
        cq.sort_order,
        cq.is_active,
        cq.created_at,
      ]
    );
  }

  for (const tag of state.projectTagDefinitions || []) {
    await query(
      `INSERT INTO project_tag_definitions
         (id, tenant_id, group_key, name, sort_order, is_active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        tag.id,
        tag.tenant_id,
        tag.group_key,
        tag.name,
        tag.sort_order,
        tag.is_active,
        tag.created_at,
      ]
    );
  }

  for (const pc of state.projectComponents) {
    await query("INSERT INTO project_components (project_id, component_id) VALUES ($1, $2)", [
      pc.project_id,
      pc.component_id,
    ]);
  }

  for (const pc of state.projectCollaborators) {
    await query("INSERT INTO project_collaborators (project_id, user_id) VALUES ($1, $2)", [
      pc.project_id,
      pc.user_id,
    ]);
  }

  for (const pt of state.projectTags || []) {
    await query("INSERT INTO project_tags (project_id, tag_id) VALUES ($1, $2)", [
      pt.project_id,
      pt.tag_id,
    ]);
  }

  for (const d of state.emailDomains) {
    await query("INSERT INTO tenant_email_domains (id, tenant_id, domain, created_at) VALUES ($1, $2, $3, $4)", [
      d.id,
      d.tenant_id,
      d.domain,
      d.created_at,
    ]);
  }

  for (const su of state.serviceUsers) {
    await query("INSERT INTO service_users (id, name, tenant_id, assigned_to) VALUES ($1, $2, $3, $4)", [
      su.id,
      su.name,
      su.tenant_id,
      su.assigned_to,
    ]);
  }

  console.log("Seed data inserted successfully");
  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
