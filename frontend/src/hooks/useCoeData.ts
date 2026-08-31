import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  getComponents,
  getProjects,
  getProject,
  getProjectComponents,
  getAllProjectComponents,
  getMyCollaboratorProjectIds,
  getProjectCollaborators,
  getTenantProfiles,
  type DbComponent,
  type DbProject,
} from "@/services/coeService";

export type { DbComponent, DbProject };

export const useComponents = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["components", user?.id],
    queryFn: () => getComponents(user!.id),
    enabled: !!user,
  });
};

export const useProjects = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["projects", user?.id],
    queryFn: () => getProjects(user?.id),
    enabled: !!user,
    retry: 1,
  });
};

export const useProject = (id: string | undefined) => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["project", id],
    queryFn: () => getProject(id!),
    enabled: !!user && !!id,
  });
};

export const useProjectComponents = (projectId: string | undefined) => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["project-components", projectId],
    queryFn: () => getProjectComponents(projectId!),
    enabled: !!user && !!projectId,
  });
};

export const useAllProjectComponents = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["all-project-components"],
    queryFn: () => getAllProjectComponents(),
    enabled: !!user,
  });
};

export const useMyCollaboratorProjectIds = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-collaborator-projects", user?.id],
    queryFn: () => getMyCollaboratorProjectIds(user!.id),
    enabled: !!user,
  });
};

export const useProjectCollaborators = (projectId: string | undefined) => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["project-collaborators", projectId],
    queryFn: () => getProjectCollaborators(projectId!),
    enabled: !!user && !!projectId,
  });
};

export const useTenantProfiles = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["tenant-profiles", user?.id],
    queryFn: () => getTenantProfiles(user!.id),
    enabled: !!user,
  });
};
