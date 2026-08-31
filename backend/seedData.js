const MOCK_TENANT_ID = "t1";

const mockUser = {
  id: "u1",
  name: "Max Mustermann",
  email: "max.mustermann@example.com",
  serviceUser: "S789012@example.com",
};

const mockColleagues = [
  { id: "u2", name: "Anna Schmidt", email: "anna.schmidt@example.com" },
  { id: "u3", name: "Thomas Weber", email: "thomas.weber@example.com" },
  { id: "u4", name: "Lisa Müller", email: "lisa.mueller@example.com" },
  { id: "u5", name: "Jan Becker", email: "jan.becker@example.com" },
];

const mockComponents = [
  { id: "c1", name: "Sales Dashboard Q1", type: "Power BI", environments: ["Development", "Production"], owner: "u1", createdAt: "2025-12-15", status: "unassigned", url: "https://app.powerbi.com/groups/me/reports/sales-q1" },
  { id: "c2", name: "Approval Workflow", type: "Power Automate", environments: ["Development", "Production"], owner: "u1", createdAt: "2026-01-08", status: "unassigned", url: "https://make.powerautomate.com/environments/default/flows/approval-workflow" },
  { id: "c3", name: "Inventory Tracker", type: "Power App", environments: ["Development", "Production"], owner: "u1", createdAt: "2026-02-01", status: "unassigned", url: "https://apps.powerapps.com/play/inventory-tracker" },
  { id: "c4", name: "HR Assistant", type: "Copilot Agent", environments: ["Development", "Production"], owner: "u1", createdAt: "2026-02-20", status: "unassigned", url: "https://copilotstudio.microsoft.com/environments/default/bots/hr-assistant" },
  { id: "c5", name: "Budget Report", type: "Power BI", environments: ["Development", "Production"], owner: "u1", createdAt: "2026-01-22", status: "assigned", url: "https://app.powerbi.com/groups/me/reports/budget-report" },
];

const mockProjects = [
  {
    id: "s1",
    name: "Sales Analytics Suite",
    description: "Complete sales reporting and analytics solution",
    components: ["c1", "c2"],
    collaborators: ["u2", "u3"],
    owner: "u1",
    status: "approved",
    createdAt: "2026-02-10",
    serviceUser: "S789012@example.com",
    productionAccessStatus: "none",
    answers: {},
  },
  {
    id: "s2",
    name: "Inventory Management",
    description: "End-to-end inventory tracking system",
    components: ["c3"],
    collaborators: ["u4"],
    owner: "u1",
    status: "pending",
    createdAt: "2026-02-28",
    answers: {},
  },
];

const toIsoDate = (date) => `${date}T00:00:00.000Z`;

function buildInitialState() {
  return {
    components: mockComponents.map((c) => ({
      id: c.id,
      tenant_id: MOCK_TENANT_ID,
      name: c.name,
      type: c.type,
      environments: c.environments,
      owner_id: c.owner,
      created_at: toIsoDate(c.createdAt),
      status: c.status,
      url: c.url,
    })),
    projects: mockProjects.map((p) => ({
      id: p.id,
      tenant_id: MOCK_TENANT_ID,
      name: p.name,
      description: p.description,
      owner_id: p.owner,
      status: p.status,
      created_at: toIsoDate(p.createdAt),
      service_user: p.serviceUser ?? null,
      production_access_status: p.productionAccessStatus ?? "none",
      production_deploy_status: "none",
      answers: p.answers,
      business_unit_id: null,
    })),
    profiles: [
      {
        id: mockUser.id,
        tenant_id: MOCK_TENANT_ID,
        full_name: mockUser.name,
        email: mockUser.email,
      },
      ...mockColleagues.map((c) => ({
        id: c.id,
        tenant_id: MOCK_TENANT_ID,
        full_name: c.name,
        email: c.email,
      })),
    ],
    projectComponents: mockProjects.flatMap((p) =>
      p.components.map((cid) => ({ project_id: p.id, component_id: cid }))
    ),
    projectCollaborators: mockProjects.flatMap((p) =>
      (p.collaborators || []).map((uid) => ({ project_id: p.id, user_id: uid }))
    ),
    userRoles: [
      { user_id: mockUser.id, role: "admin" },
      ...mockColleagues.map((c) => ({ user_id: c.id, role: "user" })),
    ],
    serviceUsers: [
      { id: "su1", name: mockUser.serviceUser, tenant_id: MOCK_TENANT_ID, assigned_to: mockUser.id },
      { id: "su2", name: "S123456@example.com", tenant_id: MOCK_TENANT_ID, assigned_to: null },
    ],
    tenant: {
      id: MOCK_TENANT_ID,
      name: "Demo Organisation",
      tool_name: "Runpipe",
      logo_bytes: null,
      logo_content_type: null,
      created_at: "2025-01-01T00:00:00.000Z",
    },
    emailDomains: [
      { id: "d1", tenant_id: MOCK_TENANT_ID, domain: "example.com", created_at: "2025-01-01T00:00:00.000Z" },
    ],
    businessUnits: [
      {
        id: "bu1",
        tenant_id: MOCK_TENANT_ID,
        name: "Corporate",
        sort_order: 0,
        is_active: true,
        created_at: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "bu2",
        tenant_id: MOCK_TENANT_ID,
        name: "Operations",
        sort_order: 1,
        is_active: true,
        created_at: "2025-01-01T00:00:00.000Z",
      },
    ],
    complianceQuestions: [
      {
        id: "cq1",
        tenant_id: MOCK_TENANT_ID,
        prompt: "Who will develop this application?",
        answer_type: "select",
        options: ["Internal Team", "External Partner", "Mixed Team"],
        required: true,
        sort_order: 0,
        is_active: true,
        created_at: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "cq2",
        tenant_id: MOCK_TENANT_ID,
        prompt: "Expected number of users",
        answer_type: "select",
        options: ["1-10", "11-50", "51-200", "200+"],
        required: true,
        sort_order: 1,
        is_active: true,
        created_at: "2025-01-01T00:00:00.000Z",
      },
    ],
    projectTagDefinitions: [
      {
        id: "tag-domain-finance",
        tenant_id: MOCK_TENANT_ID,
        group_key: "domain",
        name: "Finance",
        sort_order: 0,
        is_active: true,
        created_at: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "tag-domain-hr",
        tenant_id: MOCK_TENANT_ID,
        group_key: "domain",
        name: "HR",
        sort_order: 1,
        is_active: true,
        created_at: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "tag-domain-sales",
        tenant_id: MOCK_TENANT_ID,
        group_key: "domain",
        name: "Sales",
        sort_order: 2,
        is_active: true,
        created_at: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "tag-cap-automation",
        tenant_id: MOCK_TENANT_ID,
        group_key: "capability",
        name: "Automation",
        sort_order: 0,
        is_active: true,
        created_at: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "tag-cap-analytics",
        tenant_id: MOCK_TENANT_ID,
        group_key: "capability",
        name: "Analytics",
        sort_order: 1,
        is_active: true,
        created_at: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "tag-cap-copilot",
        tenant_id: MOCK_TENANT_ID,
        group_key: "capability",
        name: "Copilot",
        sort_order: 2,
        is_active: true,
        created_at: "2025-01-01T00:00:00.000Z",
      },
    ],
    projectTags: [
      { project_id: "s1", tag_id: "tag-domain-sales" },
      { project_id: "s1", tag_id: "tag-cap-analytics" },
      { project_id: "s2", tag_id: "tag-cap-automation" },
    ],
    jobRuns: [],
    inventoryItems: [],
    environments: [],
    workspaces: [],
    componentImportSettings: {},
    agentUsageDaily: [],
    creditRateCards: [],
  };
}

module.exports = { buildInitialState, MOCK_TENANT_ID };
