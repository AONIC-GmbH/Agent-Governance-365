import { useEffect, useRef, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAdminUsers,
  getAdminComponents,
  getPendingProjects,
  updateUserRole,
  getTenantEmailDomains,
  addTenantEmailDomain,
  deleteTenantEmailDomain,
  grantDevAccess,
  grantProdAccess,
  grantDeployAccess,
  listAdminJobRuns,
  getInventorySources,
  runConfiguredInventorySyncs,
  listEnvironments,
  listWorkspaces,
  getComponentImportSettings,
  saveComponentImportSettings,
  previewComponentImport,
  type JobRun,
  type ProfileWithDetails,
  type PendingProject,
  type InventorySource,
} from "@/services/coeService";
import { toast } from "sonner";
import { Archive, Building2, CheckCircle2, Clock, Coins, FolderKanban, Globe, Info, Puzzle, RefreshCw, Rocket, ShieldAlert, Trash2, UserCheck, Users, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import AgentCostTab from "@/components/admin/AgentCostTab";
import ComponentDetailDialog from "@/components/admin/ComponentDetailDialog";
import ApprovalDetailDialog, { type ApprovalKind } from "@/components/admin/ApprovalDetailDialog";
import CompanyBrandingCard from "@/components/admin/CompanyBrandingCard";
import BusinessUnitsCard from "@/components/admin/BusinessUnitsCard";
import ComplianceQuestionsCard from "@/components/admin/ComplianceQuestionsCard";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const IMPORT_KIND_OPTIONS = [
  { kind: "canvasapp", label: "Canvas apps", group: "pp" },
  { kind: "modeldrivenapp", label: "Model-driven apps", group: "pp" },
  { kind: "cloudflow", label: "Cloud flows", group: "pp" },
  { kind: "agent", label: "Copilot agents", group: "pp" },
  { kind: "powerbi_report", label: "Power BI reports", group: "pbi" },
  { kind: "powerbi_dashboard", label: "Power BI dashboards", group: "pbi" },
] as const;

const INVENTORY_JOB_TYPES = [
  "inventory_sync",
  "powerbi_inventory_sync",
  "copilot_kit_usage_sync",
] as const;

const INVENTORY_JOB_LABELS: Record<string, string> = {
  inventory_sync: "Power Platform",
  powerbi_inventory_sync: "Power BI",
  copilot_kit_usage_sync: "Copilot Kit usage",
};

const useAdminUsers = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["admin-users"],
    queryFn: () => getAdminUsers(),
    enabled: !!user,
  });
};

const useAdminComponents = () => {
  const { user, isAdmin } = useAuth();
  return useQuery({
    queryKey: ["admin-components"],
    queryFn: () => getAdminComponents(),
    enabled: !!user && isAdmin,
  });
};

const useInventoryJobRuns = () => {
  const { user, isAdmin } = useAuth();
  return useQuery({
    queryKey: ["admin-job-runs", "inventory-bundle"],
    queryFn: async () => {
      const runs = await listAdminJobRuns({ limit: 40 });
      return runs.filter((r) =>
        (INVENTORY_JOB_TYPES as readonly string[]).includes(r.job_type)
      );
    },
    enabled: !!user && isAdmin,
    refetchInterval: (query) => {
      const runs = query.state.data as JobRun[] | undefined;
      return runs?.some((r) => r.status === "running") ? 4000 : false;
    },
  });
};

const useImportJobRuns = () => {
  const { user, isAdmin } = useAuth();
  return useQuery({
    queryKey: ["admin-job-runs", "components_import"],
    queryFn: () => listAdminJobRuns({ type: "components_import", limit: 10 }),
    enabled: !!user && isAdmin,
    refetchInterval: (query) => {
      const runs = query.state.data as JobRun[] | undefined;
      return runs?.some((r) => r.status === "running") ? 4000 : false;
    },
  });
};

const usePendingProjects = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["admin-pending-projects"],
    queryFn: () => getPendingProjects(),
    enabled: !!user,
  });
};

const AdminSettings = () => {
  const { isAdmin, loading, profile } = useAuth();
  const { data: users = [], isLoading: usersLoading } = useAdminUsers();
  const { data: adminComponents = [], isLoading: componentsLoading } = useAdminComponents();
  const { data: inventoryRuns = [], isLoading: inventoryRunsLoading } = useInventoryJobRuns();
  const { data: importRuns = [], isLoading: importRunsLoading } = useImportJobRuns();
  const { data: pendingProjects = [], isLoading: pendingLoading } = usePendingProjects();
  const queryClient = useQueryClient();
  const [userSearch, setUserSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<ProfileWithDetails | null>(null);
  const [componentSearch, setComponentSearch] = useState("");
  const [componentTypeFilter, setComponentTypeFilter] = useState<string>("all");
  const [componentStatusFilter, setComponentStatusFilter] = useState<string>("all");
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [selectedApproval, setSelectedApproval] = useState<{
    project: PendingProject;
    kind: ApprovalKind;
  } | null>(null);
  const [syncStarting, setSyncStarting] = useState(false);
  const [importKinds, setImportKinds] = useState<string[]>([]);
  const [importEnvIds, setImportEnvIds] = useState<string[]>([]);
  const [importWorkspaceIds, setImportWorkspaceIds] = useState<string[]>([]);
  const [importSettingsHydrated, setImportSettingsHydrated] = useState(false);
  const [importSaving, setImportSaving] = useState(false);

  const handleRoleChange = async (userId: string, newRole: "admin" | "user") => {
    const { error } = await updateUserRole(userId, newRole);
    if (error) { toast.error(error.message); return; }
    toast.success("Role updated!");
    queryClient.invalidateQueries({ queryKey: ["admin-users"] });
  };

  const [newDomain, setNewDomain] = useState("");
  const [domainSaving, setDomainSaving] = useState(false);

  const { data: emailDomains = [], isLoading: domainsLoading } = useQuery({
    queryKey: ["tenant-email-domains", profile?.tenant_id],
    queryFn: () => getTenantEmailDomains(profile!.tenant_id),
    enabled: !!profile?.tenant_id,
  });

  const { data: ppEnvironments = [], isLoading: ppEnvironmentsLoading } = useQuery({
    queryKey: ["admin-environments"],
    queryFn: () => listEnvironments(),
    enabled: !!profile && isAdmin,
  });

  const { data: pbiWorkspaces = [], isLoading: pbiWorkspacesLoading } = useQuery({
    queryKey: ["admin-workspaces"],
    queryFn: () => listWorkspaces(),
    enabled: !!profile && isAdmin,
  });

  const { data: importSettings } = useQuery({
    queryKey: ["admin-component-import-settings"],
    queryFn: () => getComponentImportSettings(),
    enabled: !!profile && isAdmin,
  });

  const { data: inventorySourcesData } = useQuery({
    queryKey: ["admin-inventory-sources"],
    queryFn: () => getInventorySources(),
    enabled: !!profile && isAdmin,
  });
  const inventorySources: InventorySource[] = inventorySourcesData?.sources || [];
  const configuredSources = inventorySources.filter((s) => s.configured);
  const canRunInventorySync = configuredSources.length > 0;

  useEffect(() => {
    if (!importSettings || importSettingsHydrated) return;
    setImportKinds(importSettings.kinds || []);
    setImportEnvIds(importSettings.environment_ids || []);
    setImportWorkspaceIds(importSettings.workspace_ids || []);
    setImportSettingsHydrated(true);
  }, [importSettings, importSettingsHydrated]);

  const inventoryRunning = inventoryRuns.some((r) => r.status === "running");
  const importRunning = importRuns.some((r) => r.status === "running");
  const sameIdSet = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false;
    const set = new Set(a);
    return b.every((id) => set.has(id));
  };
  const inventoryConfigDirty =
    importSettingsHydrated &&
    (!sameIdSet(importKinds, importSettings?.kinds || []) ||
      !sameIdSet(importEnvIds, importSettings?.environment_ids || []) ||
      !sameIdSet(importWorkspaceIds, importSettings?.workspace_ids || []));

  // After inventory sync finishes, refresh catalogs + chained import runs.
  const inventoryWasRunning = useRef(false);
  useEffect(() => {
    if (inventoryRunning) {
      inventoryWasRunning.current = true;
      return;
    }
    if (inventoryWasRunning.current) {
      inventoryWasRunning.current = false;
      queryClient.invalidateQueries({ queryKey: ["admin-environments"] });
      queryClient.invalidateQueries({ queryKey: ["admin-workspaces"] });
      queryClient.invalidateQueries({ queryKey: ["admin-job-runs", "components_import"] });
      queryClient.invalidateQueries({ queryKey: ["admin-component-import-preview"] });
      queryClient.invalidateQueries({ queryKey: ["admin-components"] });
      queryClient.invalidateQueries({ queryKey: ["admin-agent-credits"] });
    }
  }, [inventoryRunning, queryClient]);

  const { data: importPreview, isFetching: importPreviewLoading } = useQuery({
    queryKey: ["admin-component-import-preview", importKinds, importEnvIds, importWorkspaceIds],
    queryFn: () =>
      previewComponentImport({
        kinds: importKinds,
        environment_ids: importEnvIds,
        workspace_ids: importWorkspaceIds,
      }),
    enabled: !!profile && isAdmin && importSettingsHydrated,
  });

  const handleAddDomain = async () => {
    const domain = newDomain.trim().toLowerCase().replace(/^@/, "");
    if (!domain || !profile?.tenant_id) return;
    setDomainSaving(true);
    const { error } = await addTenantEmailDomain(profile.tenant_id, domain);
    setDomainSaving(false);
    if (error) {
      toast.error(error.message.includes("duplicate") ? "Domain already exists" : error.message);
      return;
    }
    setNewDomain("");
    toast.success(`Domain "${domain}" added!`);
    queryClient.invalidateQueries({ queryKey: ["tenant-email-domains"] });
  };

  const handleDeleteDomain = async (id: string) => {
    const { error } = await deleteTenantEmailDomain(id);
    if (error) { toast.error(error.message); return; }
    toast.success("Domain removed");
    queryClient.invalidateQueries({ queryKey: ["tenant-email-domains"] });
  };

  if (loading) return <AppLayout><p className="text-center py-8 text-muted-foreground">Loading...</p></AppLayout>;
  if (!isAdmin) return <Navigate to="/" replace />;

  const needsDevActivation = pendingProjects.filter((p) => p.status === "pending");
  const needsProdAccess = pendingProjects.filter((p) => p.production_access_status === "pending");
  const needsDeployAccess = pendingProjects.filter((p) => (p as any).production_deploy_status === "pending");

  const handleGrantDevAccess = async (projectId: string) => {
    const { error } = await grantDevAccess(projectId);
    if (error) { toast.error(error.message); return; }
    toast.success("Development Environment activated!");
    queryClient.invalidateQueries({ queryKey: ["admin-pending-projects"] });
    queryClient.invalidateQueries({ queryKey: ["admin-users"] });
  };

  const handleGrantProdAccess = async (projectId: string) => {
    const { error } = await grantProdAccess(projectId);
    if (error) { toast.error(error.message); return; }
    toast.success("Production Environment activated!");
    queryClient.invalidateQueries({ queryKey: ["admin-pending-projects"] });
  };

  const handleGrantDeployAccess = async (projectId: string) => {
    const { error } = await grantDeployAccess(projectId);
    if (error) { toast.error(error.message); return; }
    toast.success("Production deployment granted!");
    queryClient.invalidateQueries({ queryKey: ["admin-pending-projects"] });
  };

  const handleApprovalAction = async (projectId: string, kind: ApprovalKind) => {
    if (kind === "dev") await handleGrantDevAccess(projectId);
    else if (kind === "prod") await handleGrantProdAccess(projectId);
    else await handleGrantDeployAccess(projectId);
  };

  const renderApprovalRow = (p: PendingProject, kind: ApprovalKind, actionLabel: string) => (
    <div
      key={`${kind}-${p.id}`}
      className="flex items-center gap-4 p-4 rounded-lg border bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={() => setSelectedApproval({ project: p, kind })}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setSelectedApproval({ project: p, kind });
        }
      }}
    >
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{p.name}</p>
        <p className="text-sm text-muted-foreground truncate">
          {p.owner_name || p.owner_email || "Unowned"}
          {p.business_unit_name ? ` · ${p.business_unit_name}` : ""}
        </p>
      </div>
      <Button
        size="sm"
        variant="default"
        className="gap-1 shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          if (kind === "dev") handleGrantDevAccess(p.id);
          else if (kind === "prod") handleGrantProdAccess(p.id);
          else handleGrantDeployAccess(p.id);
        }}
      >
        <CheckCircle2 className="h-4 w-4" /> {actionLabel}
      </Button>
    </div>
  );

  const handleInventorySync = async () => {
    setSyncStarting(true);
    const { data, error } = await runConfiguredInventorySyncs();
    setSyncStarting(false);
    if (error) {
      toast.error(
        error.message.includes("409") || error.message.toLowerCase().includes("already")
          ? "An inventory sync is already running."
          : error.message
      );
      return;
    }
    const started = data?.started?.length ?? 0;
    const already = data?.already_running?.length ?? 0;
    const failed = data?.failed ?? [];
    const skipped = data?.skipped ?? [];
    if (failed.length > 0) {
      toast.error(failed.map((f) => `${f.label}: ${f.error}`).join("; "));
    }
    if (started > 0) {
      const names = (data?.started || [])
        .map((r) => INVENTORY_JOB_LABELS[r.job_type] || r.job_type)
        .join(", ");
      const skipNote =
        skipped.length > 0 ? ` Skipped (not configured): ${skipped.map((s) => s.label).join(", ")}.` : "";
      toast.success(`Started ${names}.${skipNote}`);
    } else if (already > 0 && failed.length === 0) {
      toast.message("Configured inventory syncs are already running.");
    } else if (started === 0 && failed.length === 0) {
      toast.error("No inventory sources are configured.");
    }
    queryClient.invalidateQueries({ queryKey: ["admin-job-runs", "inventory-bundle"] });
    queryClient.invalidateQueries({ queryKey: ["admin-job-runs", "components_import"] });
    queryClient.invalidateQueries({ queryKey: ["admin-environments"] });
    queryClient.invalidateQueries({ queryKey: ["admin-workspaces"] });
    queryClient.invalidateQueries({ queryKey: ["admin-component-import-preview"] });
  };

  const toggleImportKind = (kind: string, checked: boolean) => {
    setImportKinds((prev) =>
      checked ? [...new Set([...prev, kind])] : prev.filter((k) => k !== kind)
    );
  };

  const toggleImportEnv = (resourceId: string, checked: boolean) => {
    setImportEnvIds((prev) =>
      checked ? [...new Set([...prev, resourceId])] : prev.filter((id) => id !== resourceId)
    );
  };

  const toggleImportWorkspace = (workspaceId: string, checked: boolean) => {
    setImportWorkspaceIds((prev) =>
      checked ? [...new Set([...prev, workspaceId])] : prev.filter((id) => id !== workspaceId)
    );
  };

  const handleSaveImportSettings = async () => {
    setImportSaving(true);
    const { error } = await saveComponentImportSettings({
      kinds: importKinds,
      environment_ids: importEnvIds,
      workspace_ids: importWorkspaceIds,
    });
    setImportSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Saved. This selection applies on the next inventory sync.");
    queryClient.invalidateQueries({ queryKey: ["admin-component-import-settings"] });
  };

  const formatJobStats = (stats: Record<string, unknown> | undefined) => {
    if (!stats || typeof stats !== "object") return "–";
    const parts: string[] = [];
    if (stats.items_upserted != null) parts.push(`${stats.items_upserted} upserted`);
    if (stats.pages != null) parts.push(`${stats.pages} pages`);
    if (stats.items_deactivated != null) parts.push(`${stats.items_deactivated} deactivated`);
    if (stats.matched != null) parts.push(`${stats.matched} matched`);
    if (stats.inserted != null) parts.push(`${stats.inserted} inserted`);
    if (stats.updated != null) parts.push(`${stats.updated} updated`);
    if (stats.archived != null) parts.push(`${stats.archived} archived`);
    if (stats.environments_upserted != null) parts.push(`${stats.environments_upserted} envs`);
    if (stats.environments_deactivated != null) parts.push(`${stats.environments_deactivated} envs off`);
    if (stats.workspaces_listed != null) parts.push(`${stats.workspaces_listed} ws listed`);
    if (stats.workspaces_upserted != null) parts.push(`${stats.workspaces_upserted} ws`);
    if (stats.workspaces_deactivated != null) parts.push(`${stats.workspaces_deactivated} ws off`);
    if (stats.chunks != null) parts.push(`${stats.chunks} chunks`);
    return parts.length ? parts.join(" · ") : "–";
  };

  const componentTypes = [...new Set(adminComponents.map((c) => c.type))].sort();
  const filteredAdminComponents = adminComponents.filter((c) => {
    if (componentTypeFilter !== "all" && c.type !== componentTypeFilter) return false;
    if (componentStatusFilter !== "all" && c.status !== componentStatusFilter) return false;
    if (!componentSearch.trim()) return true;
    const q = componentSearch.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      (c.owner_name || "").toLowerCase().includes(q) ||
      (c.owner_email || "").toLowerCase().includes(q) ||
      (c.owner_id || "").toLowerCase().includes(q)
    );
  });

  return (
    <AppLayout>
      <div className="space-y-6 max-w-5xl mx-auto">
        <h1 className="text-3xl font-heading font-bold">Admin Settings</h1>

        <Tabs defaultValue="users">
          <TabsList>
            <TabsTrigger value="users" className="gap-2"><Users className="h-4 w-4" /> Users</TabsTrigger>
            <TabsTrigger value="components" className="gap-2"><Puzzle className="h-4 w-4" /> Components</TabsTrigger>
            <TabsTrigger value="jobs" className="gap-2"><RefreshCw className="h-4 w-4" /> Inventory</TabsTrigger>
            <TabsTrigger value="agent-cost" className="gap-2"><Coins className="h-4 w-4" /> Agent credits</TabsTrigger>
            <TabsTrigger value="approvals" className="gap-2">
              <Clock className="h-4 w-4" /> Approvals
              {(needsDevActivation.length + needsProdAccess.length + needsDeployAccess.length) > 0 && (
                 <span className="ml-1 bg-destructive text-destructive-foreground text-xs rounded-full px-1.5 py-0.5">
                   {needsDevActivation.length + needsProdAccess.length + needsDeployAccess.length}
                 </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="company" className="gap-2"><Building2 className="h-4 w-4" /> Company</TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="mt-6">
            {usersLoading ? (
              <p className="text-muted-foreground text-center py-8">Loading...</p>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>All Users</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="relative mb-4">
                    <Input
                      placeholder="Search by name or email..."
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                    />
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Unassigned</TableHead>
                        <TableHead>Archived</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users
                        .filter((u) => {
                          if (!userSearch.trim()) return true;
                          const q = userSearch.toLowerCase();
                          return u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
                        })
                        .map((u) => (
                        <TableRow
                          key={u.id}
                          className="cursor-pointer"
                          onClick={() => setSelectedUser(u)}
                        >
                          <TableCell className="font-medium">{u.full_name}</TableCell>
                          <TableCell className="text-muted-foreground">{u.email}</TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Select
                              value={u.role}
                              onValueChange={(val) => handleRoleChange(u.id, val as "admin" | "user")}
                            >
                              <SelectTrigger className="w-28 h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="user">User</SelectItem>
                                <SelectItem value="admin">Admin</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            {u.unmanagedComponents > 0 ? (
                              <span className="text-warning font-medium">{u.unmanagedComponents}</span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {u.archivedComponents > 0 ? (
                              <Badge variant="secondary" className="gap-1">
                                <Archive className="h-3 w-3" />
                                {u.archivedComponents}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  <Dialog
                    open={!!selectedUser}
                    onOpenChange={(open) => {
                      if (!open) setSelectedUser(null);
                    }}
                  >
                    <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
                      {selectedUser && (
                        <>
                          <DialogHeader>
                            <DialogTitle>{selectedUser.full_name}</DialogTitle>
                            <DialogDescription>
                              {selectedUser.email} · {selectedUser.role}
                            </DialogDescription>
                          </DialogHeader>

                          <div className="space-y-3">
                            <div className="flex items-center gap-2 text-sm font-medium">
                              <FolderKanban className="h-4 w-4 text-muted-foreground" />
                              Projects ({selectedUser.projects.length})
                            </div>
                            {selectedUser.projects.length === 0 ? (
                              <p className="text-sm text-muted-foreground">
                                This user is not an owner or collaborator on any project.
                              </p>
                            ) : (
                              <ul className="divide-y rounded-md border">
                                {selectedUser.projects.map((p) => (
                                  <li key={p.id}>
                                    <Link
                                      to={`/project/${p.id}`}
                                      className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/60 transition-colors"
                                      onClick={() => setSelectedUser(null)}
                                    >
                                      <div className="min-w-0">
                                        <p className="font-medium truncate">{p.name}</p>
                                        <p className="text-xs text-muted-foreground capitalize">
                                          {p.status}
                                        </p>
                                      </div>
                                      <Badge variant={p.membership === "owner" ? "default" : "secondary"}>
                                        {p.membership === "owner" ? "Owner" : "Collaborator"}
                                      </Badge>
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </>
                      )}
                    </DialogContent>
                  </Dialog>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="components" className="mt-6">
            {componentsLoading ? (
              <p className="text-muted-foreground text-center py-8">Loading...</p>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-4 flex-wrap">
                    <span>All Components</span>
                    <span className="text-sm font-normal text-muted-foreground">
                      {filteredAdminComponents.length} of {adminComponents.length}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Input
                      placeholder="Search by name or owner..."
                      value={componentSearch}
                      onChange={(e) => setComponentSearch(e.target.value)}
                      className="sm:flex-1"
                    />
                    <Select value={componentTypeFilter} onValueChange={setComponentTypeFilter}>
                      <SelectTrigger className="w-full sm:w-44">
                        <SelectValue placeholder="Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All types</SelectItem>
                        {componentTypes.map((t) => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={componentStatusFilter} onValueChange={setComponentStatusFilter}>
                      <SelectTrigger className="w-full sm:w-40">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        <SelectItem value="unassigned">unassigned</SelectItem>
                        <SelectItem value="assigned">assigned</SelectItem>
                        <SelectItem value="archived">archived</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Owner</TableHead>
                          <TableHead>Environments</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>In project</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredAdminComponents.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                              No components match the current filters.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredAdminComponents.map((c) => (
                            <TableRow
                              key={c.id}
                              className="cursor-pointer"
                              onClick={() => setSelectedComponentId(c.id)}
                            >
                              <TableCell className="font-medium max-w-[220px] truncate text-primary" title={c.name}>
                                {c.name}
                              </TableCell>
                              <TableCell className="text-sm">{c.type}</TableCell>
                              <TableCell>
                                {c.owner_name || c.owner_email ? (
                                  <div className="min-w-0">
                                    <p className="text-sm truncate">{c.owner_name || "–"}</p>
                                    <p className="text-xs text-muted-foreground truncate">{c.owner_email || ""}</p>
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground text-sm">Unowned</span>
                                )}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground max-w-[160px] truncate">
                                {(c.environments || []).join(", ") || "–"}
                              </TableCell>
                              <TableCell>
                                <Badge variant={c.status === "archived" ? "secondary" : "outline"}>
                                  {c.status}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {c.is_assigned ? (
                                  <span className="text-sm text-foreground">Yes</span>
                                ) : (
                                  <span className="text-sm text-muted-foreground">No</span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  <ComponentDetailDialog
                    componentId={selectedComponentId}
                    onOpenChange={(open) => {
                      if (!open) setSelectedComponentId(null);
                    }}
                  />
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="jobs" className="mt-6 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Inventory sync</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Starts every inventory source that is configured on this deployment. Sources without
                  credentials are skipped. After a successful Power Platform or Power BI sync, the catalog
                  is updated using the inventory configuration below.
                </p>
                <Button
                  onClick={handleInventorySync}
                  disabled={syncStarting || inventoryRunning || !canRunInventorySync}
                  className="gap-2"
                >
                  <RefreshCw className={`h-4 w-4 ${inventoryRunning || syncStarting ? "animate-spin" : ""}`} />
                  {inventoryRunning
                    ? "Sync running…"
                    : syncStarting
                      ? "Starting…"
                      : "Sync inventory now"}
                </Button>
                {!canRunInventorySync && inventorySources.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Configure at least one source (Power Platform refresh token, Power BI app, or Copilot Kit Dataverse URL) to enable sync.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Inventory configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <p className="text-sm text-muted-foreground">
                  Choose which component types, Power Platform environments, and Power BI workspaces
                  should be registered in Runpipe. Empty selection means nothing is added to the catalog.
                </p>
                <p
                  className={`flex items-start gap-2 text-sm ${
                    inventoryConfigDirty ? "text-warning" : "text-muted-foreground"
                  }`}
                >
                  {inventoryConfigDirty ? (
                    <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
                  ) : (
                    <Info className="h-4 w-4 mt-0.5 shrink-0" />
                  )}
                  <span>
                    {importRunning
                      ? "Applying the last inventory sync to the catalog…"
                      : inventoryConfigDirty
                        ? "You have unsaved changes. Save them so they apply on the next inventory sync."
                        : "Saved configuration is applied on the next inventory sync. Matching items are added to the catalog automatically after that run."}
                  </span>
                </p>

                <div className="space-y-3">
                  <Label>Component types</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {IMPORT_KIND_OPTIONS.map((opt) => (
                      <label key={opt.kind} className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={importKinds.includes(opt.kind)}
                          onCheckedChange={(v) => toggleImportKind(opt.kind, v === true)}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <Label>Power Platform environments</Label>
                  {ppEnvironmentsLoading ? (
                    <p className="text-sm text-muted-foreground">Loading environments…</p>
                  ) : ppEnvironments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No environments yet. Run inventory sync first to list Power Platform environments.
                    </p>
                  ) : (
                    <div className="max-h-64 overflow-y-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10" />
                            <TableHead>Name</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Region</TableHead>
                            <TableHead>Environment ID</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ppEnvironments.map((env) => (
                            <TableRow key={env.environment_id}>
                              <TableCell>
                                <Checkbox
                                  checked={importEnvIds.includes(env.environment_id)}
                                  onCheckedChange={(v) =>
                                    toggleImportEnv(env.environment_id, v === true)
                                  }
                                />
                              </TableCell>
                              <TableCell className="font-medium text-sm">
                                {env.display_name || env.environment_id}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {env.environment_type || "–"}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {env.region || "–"}
                              </TableCell>
                              <TableCell className="text-xs font-mono text-muted-foreground max-w-[160px] truncate" title={env.environment_id}>
                                {env.environment_id}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <Label>Power BI workspaces</Label>
                  {pbiWorkspacesLoading ? (
                    <p className="text-sm text-muted-foreground">Loading workspaces…</p>
                  ) : pbiWorkspaces.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No workspaces yet. Run inventory sync first to list Power BI workspaces.
                    </p>
                  ) : (
                    <div className="max-h-64 overflow-y-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10" />
                            <TableHead>Name</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>State</TableHead>
                            <TableHead>Workspace ID</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pbiWorkspaces.map((ws) => (
                            <TableRow key={ws.workspace_id}>
                              <TableCell>
                                <Checkbox
                                  checked={importWorkspaceIds.includes(ws.workspace_id)}
                                  onCheckedChange={(v) =>
                                    toggleImportWorkspace(ws.workspace_id, v === true)
                                  }
                                />
                              </TableCell>
                              <TableCell className="font-medium text-sm">
                                {ws.display_name || ws.workspace_id}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {ws.workspace_type || "–"}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {ws.state || "–"}
                              </TableCell>
                              <TableCell className="text-xs font-mono text-muted-foreground max-w-[160px] truncate" title={ws.workspace_id}>
                                {ws.workspace_id}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>

                <p className="text-sm">
                  Matching inventory items:{" "}
                  <span className="font-medium">
                    {importPreviewLoading ? "…" : importPreview?.count ?? 0}
                  </span>
                  {importPreview?.by_kind && Object.keys(importPreview.by_kind).length > 0 && (
                    <span className="text-muted-foreground">
                      {" "}
                      (
                      {Object.entries(importPreview.by_kind)
                        .map(([k, n]) => `${k}: ${n}`)
                        .join(", ")}
                      )
                    </span>
                  )}
                </p>

                <div className="flex flex-wrap gap-2 items-center">
                  <Button onClick={handleSaveImportSettings} disabled={importSaving || !inventoryConfigDirty}>
                    {importSaving ? "Saving…" : "Save configuration"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent inventory runs</CardTitle>
              </CardHeader>
              <CardContent>
                {inventoryRunsLoading ? (
                  <p className="text-muted-foreground text-center py-6">Loading...</p>
                ) : inventoryRuns.length === 0 ? (
                  <p className="text-muted-foreground text-sm text-center py-6">No runs yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Started</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Trigger</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Stats</TableHead>
                        <TableHead>Error</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {inventoryRuns.slice(0, 15).map((run) => (
                        <TableRow key={run.id}>
                          <TableCell className="text-sm whitespace-nowrap">
                            {run.started_at ? new Date(run.started_at).toLocaleString() : "–"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {INVENTORY_JOB_LABELS[run.job_type] || run.job_type}
                          </TableCell>
                          <TableCell className="text-sm">{run.trigger}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                run.status === "success"
                                  ? "default"
                                  : run.status === "failed"
                                    ? "destructive"
                                    : "secondary"
                              }
                            >
                              {run.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatJobStats(run.stats)}
                          </TableCell>
                          <TableCell className="text-sm text-destructive max-w-[240px] truncate" title={run.error || undefined}>
                            {run.error || "–"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent catalog updates</CardTitle>
              </CardHeader>
              <CardContent>
                {importRunsLoading ? (
                  <p className="text-muted-foreground text-center py-6">Loading...</p>
                ) : importRuns.length === 0 ? (
                  <p className="text-muted-foreground text-sm text-center py-6">No runs yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Started</TableHead>
                        <TableHead>Trigger</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Stats</TableHead>
                        <TableHead>Error</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importRuns.map((run) => (
                        <TableRow key={run.id}>
                          <TableCell className="text-sm whitespace-nowrap">
                            {run.started_at ? new Date(run.started_at).toLocaleString() : "–"}
                          </TableCell>
                          <TableCell className="text-sm">{run.trigger}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                run.status === "success"
                                  ? "default"
                                  : run.status === "failed"
                                    ? "destructive"
                                    : "secondary"
                              }
                            >
                              {run.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatJobStats(run.stats)}
                          </TableCell>
                          <TableCell
                            className="text-sm text-destructive max-w-[240px] truncate"
                            title={run.error || undefined}
                          >
                            {run.error || "–"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="agent-cost" className="mt-6">
            <AgentCostTab />
          </TabsContent>

          <TabsContent value="approvals" className="mt-6 space-y-6">
            {pendingLoading ? (
              <p className="text-muted-foreground text-center py-8">Loading...</p>
            ) : (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <UserCheck className="h-5 w-5" />
                      Development Environment Activation
                      {needsDevActivation.length > 0 && (
                        <span className="text-xs bg-warning/10 text-warning px-2 py-0.5 rounded-full">{needsDevActivation.length}</span>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {needsDevActivation.length === 0 ? (
                      <p className="text-muted-foreground text-sm py-4 text-center">No pending requests.</p>
                    ) : (
                      <div className="space-y-4">
                        {needsDevActivation.map((p) => renderApprovalRow(p, "dev", "Activate"))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <ShieldAlert className="h-5 w-5" />
                      Production Environment Activation
                      {needsProdAccess.length > 0 && (
                        <span className="text-xs bg-warning/10 text-warning px-2 py-0.5 rounded-full">{needsProdAccess.length}</span>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {needsProdAccess.length === 0 ? (
                      <p className="text-muted-foreground text-sm py-4 text-center">No pending requests.</p>
                    ) : (
                      <div className="space-y-4">
                        {needsProdAccess.map((p) => renderApprovalRow(p, "prod", "Activate"))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Rocket className="h-5 w-5" />
                      Grant Production Deployment
                      {needsDeployAccess.length > 0 && (
                        <span className="text-xs bg-warning/10 text-warning px-2 py-0.5 rounded-full">{needsDeployAccess.length}</span>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {needsDeployAccess.length === 0 ? (
                      <p className="text-muted-foreground text-sm py-4 text-center">No pending requests.</p>
                    ) : (
                      <div className="space-y-4">
                        {needsDeployAccess.map((p) => renderApprovalRow(p, "deploy", "Grant"))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
            <ApprovalDetailDialog
              project={selectedApproval?.project ?? null}
              kind={selectedApproval?.kind ?? null}
              tenantId={profile?.tenant_id}
              onOpenChange={(open) => {
                if (!open) setSelectedApproval(null);
              }}
              onApprove={handleApprovalAction}
            />
          </TabsContent>

          <TabsContent value="company" className="mt-6">
            {!profile?.tenant_id ? (
              <p className="text-muted-foreground text-center py-8">No tenant on profile.</p>
            ) : (
              <div className="space-y-6">
                <CompanyBrandingCard tenantId={profile.tenant_id} />
                <BusinessUnitsCard tenantId={profile.tenant_id} />
                <ComplianceQuestionsCard tenantId={profile.tenant_id} />

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Globe className="h-5 w-5" /> Email Domains
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Users who register with one of these email domains are automatically assigned to this workspace.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-4 max-w-md">
                    {domainsLoading ? (
                      <p className="text-muted-foreground text-sm">Loading...</p>
                    ) : (
                      <>
                        {emailDomains.length > 0 && (
                          <div className="space-y-2">
                            {emailDomains.map((d) => (
                              <div key={d.id} className="flex items-center justify-between p-2 rounded-md border bg-muted/30">
                                <span className="text-sm font-mono">@{d.domain}</span>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => handleDeleteDomain(d.id)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex gap-2">
                          <Input
                            value={newDomain}
                            onChange={(e) => setNewDomain(e.target.value)}
                            placeholder="example.com"
                            onKeyDown={(e) => e.key === "Enter" && handleAddDomain()}
                          />
                          <Button onClick={handleAddDomain} disabled={domainSaving || !newDomain.trim()}>
                            {domainSaving ? "..." : "Add"}
                          </Button>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default AdminSettings;
