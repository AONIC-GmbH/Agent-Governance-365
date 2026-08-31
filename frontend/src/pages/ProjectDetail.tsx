import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useProject, useProjectComponents, useProjectCollaborators, useComponents } from "@/hooks/useCoeData";
import { ComponentIcon } from "@/components/ComponentIcon";
import AppLayout from "@/components/AppLayout";
import { ArrowLeft, CheckCircle2, Clock, XCircle, FileBox, ExternalLink, ShieldCheck, ShieldAlert, Pencil, X, Check, Rocket, Trash2, Plus } from "lucide-react";
import UserPicker from "@/components/UserPicker";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import {
  requestDevAccess,
  requestProdAccess,
  requestDeployAccess,
  updateProject,
  addProjectComponents,
  removeProjectComponent,
  addProjectCollaborator,
  removeProjectCollaborator,
  deleteProject,
  listBusinessUnits,
  listComplianceQuestions,
  getAdminComponents,
} from "@/services/coeService";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ComponentType } from "@/data/types";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

const statusConfig = {
  draft: { label: "Draft", class: "status-badge-pending", icon: FileBox },
  pending: { label: "In Review", class: "status-badge-warning", icon: Clock },
  approved: { label: "Approved", class: "status-badge-success", icon: CheckCircle2 },
  rejected: { label: "Rejected", class: "status-badge bg-destructive/10 text-destructive", icon: XCircle },
};

const ProjectDetail = () => {
  const { id } = useParams();
  const { data: project, isLoading } = useProject(id);
  const { data: projectComponents = [] } = useProjectComponents(id);
  const { data: collaborators = [], refetch: refetchCollaborators } = useProjectCollaborators(id);
  const { user, profile, isAdmin } = useAuth();
  const { data: allMyComponents = [] } = useComponents();
  const { data: adminComponents = [] } = useQuery({
    queryKey: ["admin-components"],
    queryFn: () => getAdminComponents(),
    enabled: isAdmin,
  });
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const tenantId = profile?.tenant_id || project?.tenant_id;
  const { data: businessUnits = [] } = useQuery({
    queryKey: ["business-units", tenantId],
    queryFn: () => listBusinessUnits(tenantId!),
    enabled: !!tenantId,
  });
  const { data: complianceQuestions = [] } = useQuery({
    queryKey: ["compliance-questions", tenantId],
    queryFn: () => listComplianceQuestions(tenantId!),
    enabled: !!tenantId,
  });

  const [devModalOpen, setDevModalOpen] = useState(false);
  const [prodModalOpen, setProdModalOpen] = useState(false);
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [devConfirmed, setDevConfirmed] = useState(false);
  const [prodConfirmed, setProdConfirmed] = useState(false);
  const [deployConfirmed, setDeployConfirmed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [addCollabOpen, setAddCollabOpen] = useState(false);
  const [addCompOpen, setAddCompOpen] = useState(false);
  const [selectedCompIds, setSelectedCompIds] = useState<string[]>([]);

  const isOwner = project?.owner_id === user?.id;
  const isMember = collaborators.some((c) => c.id === user?.id);
  const canEdit = isAdmin || isOwner || isMember;
  const canDelete = isAdmin || isOwner;
  if (isLoading) {
    return <AppLayout><p className="text-center py-8 text-muted-foreground">Loading...</p></AppLayout>;
  }

  if (!project) {
    return (
      <AppLayout>
        <div className="text-center py-20">
          <p className="text-muted-foreground">Project not found</p>
          <Link to="/"><Button variant="outline" className="mt-4">Back to Dashboard</Button></Link>
        </div>
      </AppLayout>
    );
  }

  const cfg = statusConfig[project.status as keyof typeof statusConfig] ?? statusConfig.draft;
  const StatusIcon = cfg.icon;
  const devStatus = project.status; // draft → not requested, pending → in review, approved → activated
  const prodStatus = project.production_access_status; // none → not requested, pending → in review, granted → activated

  const handleRequestDevAccess = async () => {
    const { error } = await requestDevAccess(project.id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Development activation request submitted!");
      queryClient.invalidateQueries({ queryKey: ["project", id] });
    }
    setDevModalOpen(false);
  };

  const handleRequestProdAccess = async () => {
    const { error } = await requestProdAccess(project.id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Production access request submitted!");
      queryClient.invalidateQueries({ queryKey: ["project", id] });
    }
    setProdModalOpen(false);
  };

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </Link>

        <div className="flex items-start justify-between">
          {editing ? (
            <div className="flex-1 space-y-2 mr-4">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="text-2xl font-bold"
                placeholder="Project name"
              />
              <Textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder="Description"
                rows={2}
              />
              <div className="flex gap-2">
                <Button size="sm" className="gap-1" onClick={async () => {
                  if (!editName.trim()) {
                    toast.error("Project name is required");
                    return;
                  }
                  if (!editDesc.trim()) {
                    toast.error("Project description is required");
                    return;
                  }
                  const { error } = await updateProject(project.id, {
                    name: editName.trim(),
                    description: editDesc.trim(),
                  });
                    if (error) { toast.error(error.message); return; }
                    toast.success("Project updated!");
                    queryClient.invalidateQueries({ queryKey: ["project", id] });
                    setEditing(false);
                  }}>
                    <Check className="h-3 w-3" /> Save
                  </Button>
                  <Button size="sm" variant="ghost" className="gap-1" onClick={() => setEditing(false)}>
                    <X className="h-3 w-3" /> Cancel
                  </Button>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-heading font-bold">{project.name}</h1>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => { setEditName(project.name); setEditDesc(project.description); setEditing(true); }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="text-muted-foreground mt-1">{project.description}</p>
            </div>
          )}
          {canDelete && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive shrink-0"
              onClick={() => setDeleteModalOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          )}
        </div>

        {/* Development Environment activation */}
        <>
            {devStatus === "draft" && (
              <Card className="border-warning/30 bg-warning/5">
                <CardContent className="flex items-center gap-4 py-4">
                  <ShieldAlert className="h-5 w-5 text-warning shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium">Development Environment activation required</p>
                    <p className="text-sm text-muted-foreground">Request activation of the Development Environment for this project.</p>
                  </div>
                  <Button size="sm" onClick={() => { setDevConfirmed(false); setDevModalOpen(true); }}>Request Activation</Button>
                </CardContent>
              </Card>
            )}
            {devStatus === "pending" && (
              <Card className="border-info/30 bg-info/5">
                <CardContent className="flex items-center gap-4 py-4">
                  <Clock className="h-5 w-5 text-info shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium">Development activation pending</p>
                    <p className="text-sm text-muted-foreground">Your request is being reviewed by an administrator.</p>
                  </div>
                </CardContent>
              </Card>
            )}
            {devStatus === "approved" && (
              <Card className="border-success/30 bg-success/5">
                <CardContent className="flex items-center gap-4 py-4">
                  <ShieldCheck className="h-5 w-5 text-success shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium">Development Environment activated</p>
                    <p className="text-sm text-muted-foreground">This project has access to the Development Environment.</p>
                  </div>
                </CardContent>
              </Card>
            )}
        </>

        {/* Production Environment activation */}
        {devStatus === "approved" && (
          <>
            {prodStatus === "none" && (
              <Card className="border-warning/30 bg-warning/5">
                <CardContent className="flex items-center gap-4 py-4">
                  <ShieldAlert className="h-5 w-5 text-warning shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium">Production Environment activation required</p>
                    <p className="text-sm text-muted-foreground">Request activation of the Production Environment so components can be deployed.</p>
                  </div>
                  <Button size="sm" onClick={() => { setProdConfirmed(false); setProdModalOpen(true); }}>Request Activation</Button>
                </CardContent>
              </Card>
            )}
            {prodStatus === "pending" && (
              <Card className="border-info/30 bg-info/5">
                <CardContent className="flex items-center gap-4 py-4">
                  <Clock className="h-5 w-5 text-info shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium">Production activation pending</p>
                    <p className="text-sm text-muted-foreground">Your request to activate the Production Environment is being reviewed.</p>
                  </div>
                </CardContent>
              </Card>
            )}
            {prodStatus === "granted" && (
              <Card className="border-success/30 bg-success/5">
                <CardContent className="flex items-center gap-4 py-4">
                  <ShieldCheck className="h-5 w-5 text-success shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium">Production Environment activated</p>
                    <p className="text-sm text-muted-foreground">This project has access to the Production Environment.</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* Prod activated – Request automatic deployment */}
        {devStatus === "approved" && prodStatus === "granted" && (() => {
          const deployStatus = (project as any).production_deploy_status ?? "none";
          return (
            <>
              {deployStatus === "none" && (
                <Card className="border-warning/30 bg-warning/5">
                  <CardContent className="flex items-center gap-4 py-4">
                    <Rocket className="h-5 w-5 text-warning shrink-0" />
                    <div className="flex-1">
                      <p className="font-medium">Automatic deployment available</p>
                      <p className="text-sm text-muted-foreground">Request automatic deployment of your components to the Production Environment.</p>
                    </div>
                    <Button size="sm" onClick={() => { setDeployConfirmed(false); setDeployModalOpen(true); }}>Request Deployment</Button>
                  </CardContent>
                </Card>
              )}
              {deployStatus === "pending" && (
                <Card className="border-info/30 bg-info/5">
                  <CardContent className="flex items-center gap-4 py-4">
                    <Clock className="h-5 w-5 text-info shrink-0" />
                    <div className="flex-1">
                      <p className="font-medium">Deployment request pending</p>
                      <p className="text-sm text-muted-foreground">Your deployment request is being reviewed by an administrator.</p>
                    </div>
                  </CardContent>
                </Card>
              )}
              {deployStatus === "granted" && (
                <Card className="border-success/30 bg-success/5">
                  <CardContent className="flex items-center gap-4 py-4">
                    <Rocket className="h-5 w-5 text-success shrink-0" />
                    <div className="flex-1">
                      <p className="font-medium">Automatic deployment active</p>
                      <p className="text-sm text-muted-foreground">Components are automatically deployed to the Production Environment.</p>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          );
        })()}

        {/* Dev activation modal */}
        <Dialog open={devModalOpen} onOpenChange={setDevModalOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Request Development Environment Activation</DialogTitle>
              <DialogDescription>Please confirm the following before submitting your activation request.</DialogDescription>
            </DialogHeader>
            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50 border">
              <Checkbox id="dev-confirm" checked={devConfirmed} onCheckedChange={(v) => setDevConfirmed(v === true)} className="mt-0.5" />
              <label htmlFor="dev-confirm" className="text-sm leading-relaxed cursor-pointer">
                Hereby, I confirm that if personal data is collected, processed, or stored, it includes email addresses, MUID, and display names. If any additional personal data is used, please click on the question mark and refer to the FAQ on this topic. For the majority of Power Apps and Automate, GEAR registration is not required. Further information can also be found in our FAQ section.
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDevModalOpen(false)}>Cancel</Button>
              <Button disabled={!devConfirmed} onClick={handleRequestDevAccess}>Submit Request</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Production activation modal */}
        <Dialog open={prodModalOpen} onOpenChange={setProdModalOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Request Production Environment Activation</DialogTitle>
              <DialogDescription>Request activation of the Production Environment for this project.</DialogDescription>
            </DialogHeader>
            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50 border">
              <Checkbox id="prod-confirm" checked={prodConfirmed} onCheckedChange={(v) => setProdConfirmed(v === true)} className="mt-0.5" />
              <label htmlFor="prod-confirm" className="text-sm leading-relaxed cursor-pointer">
                Hereby, I confirm that if personal data is collected, processed, or stored, it includes email addresses, MUID, and display names. If any additional personal data is used, please click on the question mark and refer to the FAQ on this topic.
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setProdModalOpen(false)}>Cancel</Button>
              <Button disabled={!prodConfirmed} onClick={handleRequestProdAccess}>Submit Request</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Deployment modal */}
        <Dialog open={deployModalOpen} onOpenChange={setDeployModalOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Request Automatic Deployment</DialogTitle>
              <DialogDescription>This will enable automatic deployment of your components to the Production Environment.</DialogDescription>
            </DialogHeader>
            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50 border">
              <Checkbox id="deploy-confirm" checked={deployConfirmed} onCheckedChange={(v) => setDeployConfirmed(v === true)} className="mt-0.5" />
              <label htmlFor="deploy-confirm" className="text-sm leading-relaxed cursor-pointer">
                I confirm that all components have been thoroughly tested in the Development Environment and are ready for production deployment. I understand that production deployment will make these components available to end users.
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeployModalOpen(false)}>Cancel</Button>
              <Button disabled={!deployConfirmed} onClick={async () => {
                const { error } = await requestDeployAccess(project.id);
                if (error) { toast.error(error.message); } else {
                  toast.success("Deployment request submitted!");
                  queryClient.invalidateQueries({ queryKey: ["project", id] });
                }
                setDeployModalOpen(false);
              }}>Submit Request</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Components</CardTitle>
              {canEdit && (
                <Button variant="outline" size="sm" className="gap-1" onClick={() => { setAddCompOpen(true); setSelectedCompIds([]); }}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {projectComponents.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No components yet.</p>
            ) : (
              <div className="space-y-2">
                {projectComponents.map((comp) => (
                  <div key={comp.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                    <ComponentIcon type={comp.type as ComponentType} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{comp.name}</p>
                      <p className="text-xs text-muted-foreground">{comp.type}</p>
                    </div>
                    <span className="text-xs text-muted-foreground truncate max-w-[12rem]">
                      {(comp.environments || []).join(", ") || "–"}
                    </span>
                    <a href={comp.url} target="_blank" rel="noopener noreferrer">
                      <Button variant="ghost" size="icon" className="h-8 w-8"><ExternalLink className="h-4 w-4" /></Button>
                    </a>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        title="Remove from project"
                        onClick={async () => {
                          const { error } = await removeProjectComponent(project.id, comp.id);
                          if (error) { toast.error(error.message); return; }
                          toast.success("Component removed from project");
                          queryClient.invalidateQueries({ queryKey: ["project-components", id] });
                          queryClient.invalidateQueries({ queryKey: ["all-project-components"] });
                          queryClient.invalidateQueries({ queryKey: ["components"] });
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Add components dialog */}
        <Dialog open={addCompOpen} onOpenChange={(v) => { setAddCompOpen(v); if (!v) setSelectedCompIds([]); }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Add components</DialogTitle>
              <DialogDescription>Select the components you want to add to this project.</DialogDescription>
            </DialogHeader>
            {(() => {
              const alreadyInProject = new Set(projectComponents.map((c) => c.id));
              const available = isAdmin
                ? adminComponents.filter(
                    (c) =>
                      c.status !== "archived" &&
                      !c.is_assigned &&
                      !alreadyInProject.has(c.id)
                  )
                : allMyComponents.filter(
                    (c) =>
                      c.owner_id === user?.id &&
                      c.status !== "archived" &&
                      !alreadyInProject.has(c.id)
                  );
              return available.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No more components available.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto border rounded-md p-2">
                  {available.map((comp) => {
                    const isSelected = selectedCompIds.includes(comp.id);
                    return (
                      <button
                        key={comp.id}
                        type="button"
                        onClick={() => setSelectedCompIds((prev) =>
                          prev.includes(comp.id) ? prev.filter((x) => x !== comp.id) : [...prev, comp.id]
                        )}
                        className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors ${
                          isSelected
                            ? "bg-primary/10 border border-primary/30"
                            : "bg-muted/50 border border-transparent hover:bg-muted"
                        }`}
                      >
                        <div className={`h-5 w-5 rounded border flex items-center justify-center shrink-0 ${
                          isSelected ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/30"
                        }`}>
                          {isSelected && <Check className="h-3 w-3" />}
                        </div>
                        <ComponentIcon type={comp.type as ComponentType} size="sm" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{comp.name}</p>
                          <p className="text-xs text-muted-foreground">{comp.type}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })()}
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddCompOpen(false)}>Cancel</Button>
              <Button
                disabled={selectedCompIds.length === 0}
                onClick={async () => {
                  const rows = selectedCompIds.map((cid) => ({
                    project_id: project.id,
                    component_id: cid,
                  }));
                  const { error } = await addProjectComponents(rows);
                  if (error) { toast.error(error.message); return; }
                  toast.success(`${selectedCompIds.length} component(s) added!`);
                  queryClient.invalidateQueries({ queryKey: ["project-components", id] });
                  queryClient.invalidateQueries({ queryKey: ["all-project-components"] });
                  queryClient.invalidateQueries({ queryKey: ["components"] });
                  setAddCompOpen(false);
                  setSelectedCompIds([]);
                }}
              >
                Add ({selectedCompIds.length})
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Owner</p>
              {project.owner_name || project.owner_email ? (
                <>
                  <p className="font-medium">{project.owner_name || project.owner_email}</p>
                  {project.owner_email && (
                    <a
                      href={`mailto:${project.owner_email}`}
                      className="text-xs text-primary hover:underline"
                    >
                      {project.owner_email}
                    </a>
                  )}
                </>
              ) : (
                <p className="font-medium text-muted-foreground">Unowned</p>
              )}
            </div>
            <div>
              <p className="text-muted-foreground">Created on</p>
              <p className="font-medium">{new Date(project.created_at).toLocaleDateString("en-US")}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Status</p>
              <p className="font-medium">{cfg.label}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Collaborators</CardTitle>
              {canDelete && !addCollabOpen && (
                <Button variant="outline" size="sm" className="gap-1" onClick={() => setAddCollabOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {canDelete && addCollabOpen && (
              <div className="flex items-center gap-2 mb-4">
                <UserPicker
                  className="flex-1"
                  excludeIds={[...collaborators.map((c) => c.id), user?.id ?? ""]}
                  onSelect={async (picked) => {
                    const { error } = await addProjectCollaborator(project.id, picked.id);
                    if (error) { toast.error(error.message); return; }
                    toast.success("Collaborator added!");
                    queryClient.invalidateQueries({ queryKey: ["project-collaborators", id] });
                    setAddCollabOpen(false);
                  }}
                />
                <Button size="sm" variant="ghost" onClick={() => setAddCollabOpen(false)}>
                  Cancel
                </Button>
              </div>
            )}
            {collaborators.length > 0 ? (
              <div className="space-y-2">
                {collaborators.map((col) => (
                  <div key={col.id} className="flex items-center gap-3 p-2">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
                      {col.full_name.split(" ").map((n) => n[0]).join("")}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{col.full_name}</p>
                      <p className="text-xs text-muted-foreground">{col.email}</p>
                    </div>
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={async () => {
                          const { error } = await removeProjectCollaborator(project.id, col.id);
                          if (error) { toast.error(error.message); return; }
                          toast.success("Collaborator removed!");
                          queryClient.invalidateQueries({ queryKey: ["project-collaborators", id] });
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No collaborators assigned.</p>
            )}
          </CardContent>
        </Card>

        {/* Business unit + Compliance Answers */}
        {(project.business_unit_id ||
          (project.answers && Object.keys(project.answers as Record<string, string>).length > 0)) && (
          <Card>
            <CardHeader><CardTitle>Business Information</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {project.business_unit_id && (
                <div>
                  <p className="text-muted-foreground">Business unit</p>
                  <p className="font-medium">
                    {businessUnits.find((u) => u.id === project.business_unit_id)?.name ||
                      project.business_unit_id}
                  </p>
                </div>
              )}
              {Object.entries((project.answers as Record<string, string>) || {}).map(([qid, answer]) => {
                if (!answer) return null;
                const q = complianceQuestions.find((x) => x.id === qid);
                return (
                  <div key={qid}>
                    <p className="text-muted-foreground">{q?.prompt || `Retired question (${qid})`}</p>
                    <p className="font-medium">{answer}</p>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Delete confirmation modal */}
        <Dialog open={deleteModalOpen} onOpenChange={setDeleteModalOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Project</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete the project <strong>"{project.name}"</strong>? This action cannot be undone. Components will not be affected.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteModalOpen(false)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  const { error } = await deleteProject(project.id);
                  if (error) {
                    toast.error(error.message);
                    setDeleting(false);
                  } else {
                    toast.success("Project deleted");
                    queryClient.invalidateQueries({ queryKey: ["projects"] });
                    navigate("/");
                  }
                  setDeleteModalOpen(false);
                }}
              >
                {deleting ? "Deleting…" : "Delete Project"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
};

export default ProjectDetail;
