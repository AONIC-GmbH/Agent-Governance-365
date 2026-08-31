import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  useComponents,
  useProjects,
  useAllProjectComponents,
  useMyCollaboratorProjectIds,
} from "@/hooks/useCoeData";
import { useAuth } from "@/contexts/AuthContext";
import { ComponentIcon, componentTypeIconMap } from "@/components/ComponentIcon";
import AppLayout from "@/components/AppLayout";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  PackagePlus, ExternalLink, ListPlus, Check, Trash2, Filter, ArrowUpDown, ChevronDown, Layers, FolderKanban,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { addProjectComponents, archiveComponent, type DbComponent } from "@/services/coeService";
import { useQueryClient } from "@tanstack/react-query";
import type { ComponentType } from "@/data/types";

const NEW_PROJECT_VALUE = "__new_project__";

type SortKey = "modified_desc" | "created_desc" | "created_asc" | "name_asc";

function sortTimestamp(value: string | null | undefined) {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

function sortComponents(list: DbComponent[], sortKey: SortKey) {
  const sorted = [...list];
  sorted.sort((a, b) => {
    switch (sortKey) {
      case "name_asc":
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      case "created_asc":
        return sortTimestamp(a.created_at) - sortTimestamp(b.created_at);
      case "created_desc":
        return sortTimestamp(b.created_at) - sortTimestamp(a.created_at);
      case "modified_desc":
      default: {
        const aMod = sortTimestamp(a.modified_at) || sortTimestamp(a.created_at);
        const bMod = sortTimestamp(b.modified_at) || sortTimestamp(b.created_at);
        return bMod - aMod;
      }
    }
  });
  return sorted;
}

const ComponentsPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: allComponents = [], isLoading } = useComponents();
  const components = allComponents.filter((c) => c.owner_id === user?.id && c.status !== "archived");
  const { data: allProjects = [] } = useProjects();
  const { data: myCollabProjectIds = new Set<string>() } = useMyCollaboratorProjectIds();
  const { data: allProjectComponents = [] } = useAllProjectComponents();
  const queryClient = useQueryClient();

  // Only projects the user owns or collaborates on can receive their components.
  const projects = allProjects.filter(
    (p) => p.owner_id === user?.id || myCollabProjectIds.has(p.id)
  );

  const assignedComponentIds = new Set(allProjectComponents.map((pc) => pc.component_id));

  const [open, setOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);
  const [detailComp, setDetailComp] = useState<typeof components[0] | null>(null);
  const [typeFilters, setTypeFilters] = useState<string[]>([]);
  const [envFilters, setEnvFilters] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("modified_desc");

  // Open component detail when arriving from global search (?id=...).
  useEffect(() => {
    const id = searchParams.get("id");
    if (!id || isLoading) return;
    const match = components.find((c) => c.id === id);
    if (match) setDetailComp(match);
    setSearchParams({}, { replace: true });
  }, [searchParams, components, isLoading, setSearchParams]);

  const allTypes = [...new Set(components.map((c) => c.type))].sort();
  const allEnvironments = [...new Set(components.flatMap((c) => c.environments || []))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  const toggleTypeFilter = (type: string) => {
    setTypeFilters((prev) =>
      prev.includes(type) ? prev.filter((x) => x !== type) : [...prev, type]
    );
  };

  const toggleEnvFilter = (env: string) => {
    setEnvFilters((prev) =>
      prev.includes(env) ? prev.filter((x) => x !== env) : [...prev, env]
    );
  };

  const filteredComponents = sortComponents(
    components.filter((c) => {
      if (typeFilters.length > 0 && !typeFilters.includes(c.type)) return false;
      if (
        envFilters.length > 0 &&
        !envFilters.some((env) => (c.environments || []).includes(env))
      ) {
        return false;
      }
      return true;
    }),
    sortKey
  );

  const unmanagedFiltered = filteredComponents.filter((c) => !assignedComponentIds.has(c.id));
  const managedFiltered = filteredComponents.filter((c) => assignedComponentIds.has(c.id));
  const hasActiveFilters = typeFilters.length > 0 || envFilters.length > 0;

  const environmentLabel =
    envFilters.length === 0
      ? "All environments"
      : envFilters.length === 1
        ? envFilters[0]
        : `${envFilters.length} selected`;

  const toggleComponent = (id: string) => {
    setSelectedComponents((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const isNewProject = selectedProject === NEW_PROJECT_VALUE;
  const unassignedComponents = components.filter((c) => !assignedComponentIds.has(c.id));

  const detailAssignment = detailComp
    ? allProjectComponents.find((pc) => pc.component_id === detailComp.id)
    : undefined;
  const detailProject = detailAssignment
    ? allProjects.find((p) => p.id === detailAssignment.project_id) ?? null
    : null;

  const handleCreateProjectWithSelection = () => {
    navigate(`/create-project?components=${selectedComponents.join(",")}`);
    handleOpenChange(false);
  };

  const handleSave = async () => {
    const rows = selectedComponents.map((cid) => ({
      project_id: selectedProject,
      component_id: cid,
    }));
    const { error } = await addProjectComponents(rows);
    if (error) {
      toast.error("Error: " + error.message);
    } else {
      const proj = projects.find((s) => s.id === selectedProject);
      toast.success(`${selectedComponents.length} component(s) added to "${proj?.name}"`);
      queryClient.invalidateQueries({ queryKey: ["project-components"] });
      queryClient.invalidateQueries({ queryKey: ["all-project-components"] });
    }
    setOpen(false);
    setSelectedProject("");
    setSelectedComponents([]);
  };

  const handleOpenChange = (value: boolean) => {
    setOpen(value);
    if (!value) {
      setSelectedProject("");
      setSelectedComponents([]);
    }
  };

  if (isLoading) {
    return <AppLayout><p className="text-center py-8 text-muted-foreground">Loading...</p></AppLayout>;
  }

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-heading font-bold">Your Components</h1>
            <p className="text-muted-foreground mt-1">
              All Power Platform components assigned to you
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={() => setOpen(true)}>
              <ListPlus className="h-4 w-4" />
              Add to Project
            </Button>
            <Link to="/create-project">
              <Button className="gap-2">
                <PackagePlus className="h-4 w-4" />
                Create Project
              </Button>
            </Link>
          </div>
        </div>

        <div className="space-y-3">
          {allTypes.length > 1 && (
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground mr-1">
                <Filter className="h-4 w-4" />
                Filter
              </span>
              {allTypes.map((type) => {
                const active = typeFilters.includes(type);
                const TypeIcon = componentTypeIconMap[type as ComponentType];
                return (
                  <Badge
                    key={type}
                    variant={active ? "default" : "outline"}
                    className="cursor-pointer select-none transition-colors px-3.5 py-1.5 text-sm gap-1.5"
                    onClick={() => toggleTypeFilter(type)}
                  >
                    {TypeIcon && <TypeIcon className="h-3.5 w-3.5" />}
                    {type}
                  </Badge>
                );
              })}
              {typeFilters.length > 0 && (
                <button
                  onClick={() => setTypeFilters([])}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors ml-1"
                >
                  Show all
                </button>
              )}
            </div>
          )}

          <div className="flex items-center gap-6 flex-wrap">
            {allEnvironments.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                  <Layers className="h-4 w-4" />
                  Environment
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-[220px] h-9 justify-between font-normal"
                    >
                      <span className="truncate">{environmentLabel}</span>
                      <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[220px]">
                    {allEnvironments.map((env) => (
                      <DropdownMenuCheckboxItem
                        key={env}
                        checked={envFilters.includes(env)}
                        onCheckedChange={() => toggleEnvFilter(env)}
                        onSelect={(e) => e.preventDefault()}
                      >
                        {env}
                      </DropdownMenuCheckboxItem>
                    ))}
                    {envFilters.length > 0 && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => setEnvFilters([])}>
                          Clear selection
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}

            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <ArrowUpDown className="h-4 w-4" />
                Sort
              </span>
              <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                <SelectTrigger className="w-[220px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="modified_desc">Last modified</SelectItem>
                  <SelectItem value="created_desc">Newest created</SelectItem>
                  <SelectItem value="created_asc">Oldest created</SelectItem>
                  <SelectItem value="name_asc">Name A–Z</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {unmanagedFiltered.length > 0 && (
          <div>
            <h2 className="text-lg font-heading font-semibold mb-3 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-warning" />
              Unassigned Components
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {unmanagedFiltered.map((comp) => (
                <Card
                  key={comp.id}
                  className="border-warning/20 hover:border-warning/40 transition-colors cursor-pointer"
                  onClick={() => setDetailComp(comp)}
                >
                  <CardContent className="flex items-center gap-4 py-4">
                    <ComponentIcon type={comp.type as ComponentType} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{comp.name}</p>
                      <p className="text-sm text-muted-foreground">{comp.type}</p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>{comp.environments.join(", ")}</p>
                      <p>
                        {(comp.modified_at
                          ? new Date(comp.modified_at)
                          : new Date(comp.created_at)
                        ).toLocaleDateString("en-US")}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {managedFiltered.length > 0 && (
          <div>
            <h2 className="text-lg font-heading font-semibold mb-3 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-success" />
              Assigned Components
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {managedFiltered.map((comp) => {
                const projectLink = allProjectComponents.find((pc) => pc.component_id === comp.id);
                return (
                  <Link key={comp.id} to={projectLink ? `/project/${projectLink.project_id}` : "#"}>
                    <Card className="hover:border-primary/40 transition-colors cursor-pointer">
                      <CardContent className="flex items-center gap-4 py-4">
                        <ComponentIcon type={comp.type as ComponentType} />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{comp.name}</p>
                          <p className="text-sm text-muted-foreground">{comp.type}</p>
                        </div>
                        <div className="text-right text-xs text-muted-foreground hidden sm:block">
                          <p>{comp.environments.join(", ") || "—"}</p>
                          <p>
                            {(comp.modified_at
                              ? new Date(comp.modified_at)
                              : new Date(comp.created_at)
                            ).toLocaleDateString("en-US")}
                          </p>
                        </div>
                        <span className="status-badge-success">Assigned</span>
                        <a href={comp.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="shrink-0">
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </a>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {unmanagedFiltered.length === 0 && managedFiltered.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            {hasActiveFilters
              ? "No components match the selected filters."
              : "No components yet."}
          </p>
        )}
      </div>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg flex flex-col max-h-[85vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Add Components to Project</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-y-auto">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Select Project</label>
              <Select value={selectedProject} onValueChange={setSelectedProject}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a project…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NEW_PROJECT_VALUE}>
                    <span className="flex items-center gap-2">
                      <PackagePlus className="h-4 w-4" />
                      Create a new project
                    </span>
                  </SelectItem>
                  {projects.map((proj) => (
                    <SelectItem key={proj.id} value={proj.id}>{proj.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isNewProject && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  We'll take you to the project wizard with these components pre-selected.
                </p>
              )}
            </div>
            {selectedProject && (
              <div className="flex-1 min-h-0 flex flex-col">
                <label className="text-sm font-medium mb-1.5 block">
                  Select Components ({selectedComponents.length} selected)
                </label>
                <div className="flex-1 min-h-0 space-y-2 max-h-64 overflow-y-auto border rounded-md p-2">
                  {unassignedComponents.map((comp) => {
                    const isSelected = selectedComponents.includes(comp.id);
                    return (
                      <button
                        key={comp.id}
                        type="button"
                        onClick={() => toggleComponent(comp.id)}
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
                  {unassignedComponents.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">All components are already assigned to projects.</p>
                  )}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
            <Button
              disabled={!selectedProject || selectedComponents.length === 0}
              onClick={isNewProject ? handleCreateProjectWithSelection : handleSave}
            >
              {isNewProject ? "Continue" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailComp} onOpenChange={(v) => { if (!v) setDetailComp(null); }}>
        <DialogContent className="sm:max-w-lg">
          {detailComp && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <ComponentIcon type={detailComp.type as ComponentType} />
                  <div>
                    <DialogTitle>{detailComp.name}</DialogTitle>
                    <p className="text-sm text-muted-foreground mt-0.5">{detailComp.type}</p>
                  </div>
                </div>
              </DialogHeader>

              <div className="border rounded-lg divide-y text-sm">
                <div className="flex justify-between gap-4 px-4 py-3">
                  <span className="text-muted-foreground shrink-0">Project</span>
                  {detailAssignment ? (
                    <Link
                      to={`/project/${detailAssignment.project_id}`}
                      className="font-medium text-primary hover:underline text-right truncate"
                      onClick={() => setDetailComp(null)}
                    >
                      {detailProject?.name || "View project"}
                    </Link>
                  ) : (
                    <span className="font-medium text-muted-foreground">Unassigned</span>
                  )}
                </div>
                <div className="flex justify-between px-4 py-3">
                  <span className="text-muted-foreground">Environment</span>
                  <span className="font-medium">{detailComp.environments.join(", ")}</span>
                </div>
                <div className="flex justify-between px-4 py-3">
                  <span className="text-muted-foreground">Status</span>
                  <span className="font-medium">{detailComp.status}</span>
                </div>
                <div className="flex justify-between px-4 py-3">
                  <span className="text-muted-foreground">Created on</span>
                  <span className="font-medium">{new Date(detailComp.created_at).toLocaleDateString("en-US")}</span>
                </div>
                <div className="flex justify-between px-4 py-3">
                  <span className="text-muted-foreground">Last modified</span>
                  <span className="font-medium">
                    {detailComp.modified_at
                      ? new Date(detailComp.modified_at).toLocaleDateString("en-US")
                      : "—"}
                  </span>
                </div>
              </div>

              <a
                href={detailComp.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <ExternalLink className="h-4 w-4" />
                Open in Power Platform
              </a>

              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  variant="outline"
                  className="gap-2 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                  onClick={async () => {
                    const { error } = await archiveComponent(detailComp.id);
                    if (error) { toast.error(error.message); return; }
                    toast.success("Component archived!");
                    queryClient.invalidateQueries({ queryKey: ["components"] });
                    queryClient.invalidateQueries({ queryKey: ["all-project-components"] });
                    setDetailComp(null);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
                <div className="flex-1" />
                {detailAssignment ? (
                  <Link
                    to={`/project/${detailAssignment.project_id}`}
                    onClick={() => setDetailComp(null)}
                  >
                    <Button className="gap-2 w-full">
                      <FolderKanban className="h-4 w-4" />
                      Open project
                    </Button>
                  </Link>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      className="gap-2"
                      onClick={() => {
                        setDetailComp(null);
                        setSelectedComponents([detailComp.id]);
                        setOpen(true);
                      }}
                    >
                      <ListPlus className="h-4 w-4" />
                      Add to Project
                    </Button>
                    <Link to={`/create-project?component=${detailComp.id}`}>
                      <Button className="gap-2 w-full">
                        <PackagePlus className="h-4 w-4" />
                        Create Project
                      </Button>
                    </Link>
                  </>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default ComponentsPage;
