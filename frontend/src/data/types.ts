export type ComponentType = "Power BI" | "Power App" | "Power Automate" | "Copilot Agent";

export interface PowerComponent {
  id: string;
  name: string;
  type: ComponentType;
  environments: string[];
  owner: string;
  createdAt: string;
  status: "unassigned" | "assigned";
  url: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  components: string[];
  collaborators: string[];
  owner: string;
  status: "draft" | "pending" | "approved" | "rejected";
  createdAt: string;
  serviceUser?: string;
  productionAccessStatus?: "none" | "pending" | "granted";
  answers: Record<string, string>;
}
