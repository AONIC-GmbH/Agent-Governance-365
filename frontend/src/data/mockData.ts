import { PowerComponent, Project } from "./types";

export const mockUser = {
  id: "u1",
  name: "Max Mustermann",
  email: "max.mustermann@example.com",
  serviceUser: "S789012@example.com",
};

export const mockColleagues = [
  { id: "u2", name: "Anna Schmidt", email: "anna.schmidt@example.com" },
  { id: "u3", name: "Thomas Weber", email: "thomas.weber@example.com" },
  { id: "u4", name: "Lisa Müller", email: "lisa.mueller@example.com" },
  { id: "u5", name: "Jan Becker", email: "jan.becker@example.com" },
];

export const mockComponents: PowerComponent[] = [
  { id: "c1", name: "Sales Dashboard Q1", type: "Power BI", environments: ["Development", "Production"], owner: "u1", createdAt: "2025-12-15", status: "unassigned", url: "https://app.powerbi.com/groups/me/reports/sales-q1" },
  { id: "c2", name: "Approval Workflow", type: "Power Automate", environments: ["Development", "Production"], owner: "u1", createdAt: "2026-01-08", status: "unassigned", url: "https://make.powerautomate.com/environments/default/flows/approval-workflow" },
  { id: "c3", name: "Inventory Tracker", type: "Power App", environments: ["Development", "Production"], owner: "u1", createdAt: "2026-02-01", status: "unassigned", url: "https://apps.powerapps.com/play/inventory-tracker" },
  { id: "c4", name: "HR Assistant", type: "Copilot Agent", environments: ["Development", "Production"], owner: "u1", createdAt: "2026-02-20", status: "unassigned", url: "https://copilotstudio.microsoft.com/environments/default/bots/hr-assistant" },
  { id: "c5", name: "Budget Report", type: "Power BI", environments: ["Development", "Production"], owner: "u1", createdAt: "2026-01-22", status: "assigned", url: "https://app.powerbi.com/groups/me/reports/budget-report" },
];

export const mockProjects: Project[] = [
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
