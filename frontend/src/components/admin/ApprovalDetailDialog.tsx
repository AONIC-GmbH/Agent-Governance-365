import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { ComponentIcon, componentTypeIconMap } from "@/components/ComponentIcon";
import {
  listComplianceQuestions,
  type PendingProject,
} from "@/services/coeService";
import type { ComponentType } from "@/data/types";

export type ApprovalKind = "dev" | "prod" | "deploy";

const kindLabels: Record<ApprovalKind, string> = {
  dev: "Development Environment Activation",
  prod: "Production Environment Activation",
  deploy: "Production Deployment",
};

const actionLabels: Record<ApprovalKind, string> = {
  dev: "Activate",
  prod: "Activate",
  deploy: "Grant",
};

export default function ApprovalDetailDialog({
  project,
  kind,
  tenantId,
  onOpenChange,
  onApprove,
}: {
  project: PendingProject | null;
  kind: ApprovalKind | null;
  tenantId?: string | null;
  onOpenChange: (open: boolean) => void;
  onApprove: (projectId: string, kind: ApprovalKind) => void | Promise<void>;
}) {
  const open = Boolean(project && kind);

  const { data: complianceQuestions = [] } = useQuery({
    queryKey: ["compliance-questions", tenantId],
    queryFn: () => listComplianceQuestions(tenantId!, { activeOnly: false }),
    enabled: open && Boolean(tenantId),
  });

  if (!project || !kind) return null;

  const answers = (project.answers || {}) as Record<string, string>;
  const answerEntries = Object.entries(answers).filter(([, v]) => Boolean(v));
  const collaborators = project.collaborators || [];
  const componentTypes = project.component_types || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{project.name}</DialogTitle>
          <DialogDescription>{kindLabels[kind]}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
            <p className="whitespace-pre-wrap">
              {project.description?.trim() || "No description"}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Owner</p>
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
                <p className="text-muted-foreground">Unowned</p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Requested</p>
              <p className="font-medium">
                {project.created_at
                  ? new Date(project.created_at).toLocaleDateString("en-US")
                  : "—"}
              </p>
            </div>
          </div>

          {project.business_unit_name && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Business unit</p>
              <p>{project.business_unit_name}</p>
            </div>
          )}

          {componentTypes.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">
                Component types
              </p>
              <div className="flex flex-wrap gap-2">
                {componentTypes.map((type) => {
                  const known = type in componentTypeIconMap;
                  return (
                    <div
                      key={type}
                      className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5"
                    >
                      {known ? (
                        <ComponentIcon type={type as ComponentType} size="sm" />
                      ) : null}
                      <span className="font-medium">{type}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {collaborators.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Collaborators</p>
              <p>{collaborators.map((c) => c.full_name).join(", ")}</p>
            </div>
          )}

          {answerEntries.length > 0 && (
            <div className="space-y-3 border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground">Compliance answers</p>
              {answerEntries.map(([qid, answer]) => {
                const q = complianceQuestions.find((x) => x.id === qid);
                return (
                  <div key={qid}>
                    <p className="text-muted-foreground text-xs">
                      {q?.prompt || `Question (${qid})`}
                    </p>
                    <p className="font-medium">{answer}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 sm:justify-between">
          <Button variant="outline" asChild className="gap-1">
            <Link to={`/project/${project.id}`} onClick={() => onOpenChange(false)}>
              <ExternalLink className="h-4 w-4" />
              Open project
            </Link>
          </Button>
          <Button
            className="gap-1"
            onClick={async () => {
              await onApprove(project.id, kind);
              onOpenChange(false);
            }}
          >
            <CheckCircle2 className="h-4 w-4" />
            {actionLabels[kind]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
