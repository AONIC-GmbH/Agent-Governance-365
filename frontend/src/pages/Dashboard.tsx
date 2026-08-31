import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useComponents, useProjects, useAllProjectComponents, useMyCollaboratorProjectIds } from "@/hooks/useCoeData";
import { useAuth } from "@/contexts/AuthContext";
import { PackagePlus, ArrowRight, CheckCircle2, Clock, XCircle, FileBox } from "lucide-react";
import AppLayout from "@/components/AppLayout";

const statusConfig = {
  draft: { label: "Draft", class: "status-badge-pending", icon: FileBox },
  pending: { label: "In Review", class: "status-badge-warning", icon: Clock },
  approved: { label: "Approved", class: "status-badge-success", icon: CheckCircle2 },
  rejected: { label: "Rejected", class: "status-badge bg-destructive/10 text-destructive", icon: XCircle },
};

const Dashboard = () => {
  const { user } = useAuth();
  const { data: allComponents = [], isLoading: compLoading } = useComponents();
  const { data: allProjects = [], isLoading: projLoading, isError: projError } = useProjects();
  const { data: allProjectComponents = [] } = useAllProjectComponents();
  const { data: myCollabProjectIds = new Set<string>() } = useMyCollaboratorProjectIds();

  // Dashboard: only show own components and own/collaborator projects
  const components = allComponents.filter((c) => c.owner_id === user?.id && c.status !== "archived");
  const projects = allProjects.filter((p) => p.owner_id === user?.id || myCollabProjectIds.has(p.id));

  const assignedComponentIds = new Set(allProjectComponents.map((pc) => pc.component_id));
  const unmanagedCount = components.filter((c) => !assignedComponentIds.has(c.id)).length;
  const loading = compLoading || projLoading;

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-heading font-bold">Dashboard</h1>
            <p className="text-muted-foreground mt-1">
              Overview of your Power Platform components & projects
            </p>
          </div>
          <Link to="/create-project">
            <Button className="gap-2">
              <PackagePlus className="h-4 w-4" />
              New Project
            </Button>
          </Link>
        </div>

        {unmanagedCount > 0 && (
          <Card className="border-warning/30 bg-warning/5">
            <CardContent className="flex items-center gap-4 py-4">
              <div className="h-10 w-10 rounded-full bg-warning/10 flex items-center justify-center shrink-0">
                <Clock className="h-5 w-5 text-warning" />
              </div>
              <div className="flex-1">
                <p className="font-medium">
                  {unmanagedCount} component{unmanagedCount > 1 ? "s" : ""} need to be added to a project
                </p>
                <p className="text-sm text-muted-foreground">
                  Create a project to manage your components professionally.
                </p>
              </div>
              <Link to="/components">
                <Button variant="outline" size="sm" className="gap-1">
                  View <ArrowRight className="h-3 w-3" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Components</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-heading font-bold">{components.length}</div>
              <p className="text-xs text-muted-foreground mt-1">{unmanagedCount} unassigned</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Projects</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-heading font-bold">{projects.length}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {projects.filter((s) => s.status === "approved").length} approved
              </p>
            </CardContent>
          </Card>
        </div>

        {loading ? (
          <p className="text-muted-foreground text-center py-8">Loading...</p>
        ) : projError ? (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="py-6 text-center text-sm text-destructive">
              Could not load projects from the backend. Make sure the server is running on port 7071
              and restart it after code changes.
            </CardContent>
          </Card>
        ) : (
          <div>
            <div className="flex items-end justify-between mb-4">
              <div>
                <h2 className="text-xl font-heading font-semibold">Your Projects</h2>
                <p className="text-sm text-muted-foreground">
                  Projects you own or collaborate on.
                </p>
              </div>
            </div>
            {projects.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
                    <PackagePlus className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-heading font-semibold mb-1">No projects yet</h3>
                  <p className="text-muted-foreground text-sm max-w-sm mb-6">
                    Create your first project to start managing your Power Platform components professionally.
                  </p>
                  <Link to="/create-project">
                    <Button className="gap-2">
                      <PackagePlus className="h-4 w-4" />
                      Create your first Project
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {projects.map((project) => {
                  const cfg = statusConfig[project.status as keyof typeof statusConfig] ?? statusConfig.draft;
                  const StatusIcon = cfg.icon;

                  return (
                    <Link to={`/project/${project.id}`} key={project.id}>
                      <Card className="hover:shadow-md transition-shadow cursor-pointer">
                        <CardContent className="flex items-center gap-4 py-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium truncate">{project.name}</p>
                              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                                {project.owner_id === user?.id ? "Owner" : "Collaborator"}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground truncate">{project.description}</p>
                          </div>
                          <div className={cfg.class}>
                            <StatusIcon className="h-3 w-3 mr-1" />
                            {cfg.label}
                          </div>
                          <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        </CardContent>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default Dashboard;
