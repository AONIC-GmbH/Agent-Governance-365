import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getAdminComponentDetail, type AdminComponentDetail } from "@/services/coeService";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

function formatDateTime(value: string | null | undefined) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  if (children == null || children === "") return null;
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function AgentDetails({ d }: { d: NonNullable<AdminComponentDetail["inventory_details"]> }) {
  const viewers = d.shared_with_viewers;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <DetailField label="Created in">{d.created_in}</DetailField>
      <DetailField label="Orchestration">{d.orchestration}</DetailField>
      <DetailField label="Model">{d.model}</DetailField>
      <DetailField label="Authentication">{d.authentication}</DetailField>
      <DetailField label="Published">
        {d.is_published ? formatDateTime(d.last_published_at) || "Yes" : "Draft / not published"}
      </DetailField>
      <DetailField label="Channels">
        {d.channels?.length ? (
          <div className="flex flex-wrap gap-1.5">
            {d.channels.map((c) => (
              <Badge key={c} variant="secondary">
                {c}
              </Badge>
            ))}
          </div>
        ) : (
          "–"
        )}
      </DetailField>
      <DetailField label="Web search">
        {d.web_search_enabled ? "Enabled" : "Disabled"}
      </DetailField>
      <DetailField label="Connectors">
        {d.connector_count}
        {d.connector_operations != null ? ` (${d.connector_operations} operations)` : ""}
      </DetailField>
      <DetailField label="Sharing">
        {d.entire_tenant_share
          ? "Entire tenant"
          : viewers
            ? `${viewers.user_count} users, ${viewers.group_count} groups`
            : "–"}
      </DetailField>
      {d.is_quarantined && (
        <DetailField label="Status">
          <Badge variant="destructive">Quarantined</Badge>
        </DetailField>
      )}
      {d.schema_name && <DetailField label="Schema name">{d.schema_name}</DetailField>}
    </div>
  );
}

function PowerAppDetails({ d }: { d: NonNullable<AdminComponentDetail["inventory_details"]> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <DetailField label="Created">{formatDateTime(d.created_at)}</DetailField>
      <DetailField label="Last modified">{formatDateTime(d.last_modified_at)}</DetailField>
      <DetailField label="Quarantined">{d.is_quarantined ? "Yes" : "No"}</DetailField>
      <DetailField label="Logical name">{d.logical_name}</DetailField>
      <DetailField label="App module ID">{d.app_module_id}</DetailField>
    </div>
  );
}

function CloudFlowDetails({ d }: { d: NonNullable<AdminComponentDetail["inventory_details"]> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <DetailField label="Trigger">{d.trigger || "– (non-connector / manual / recurrence)"}</DetailField>
      <DetailField label="Trigger operation">{d.trigger_operation}</DetailField>
      <DetailField label="Created">{formatDateTime(d.created_at)}</DetailField>
      <DetailField label="Last modified">{formatDateTime(d.last_modified_at)}</DetailField>
      <DetailField label="Workflow entity ID">{d.workflow_entity_id}</DetailField>
    </div>
  );
}

function PowerBiDetails({ d }: { d: NonNullable<AdminComponentDetail["inventory_details"]> }) {
  const capacityLabel =
    d.is_on_dedicated_capacity == null
      ? null
      : d.is_on_dedicated_capacity
        ? "Dedicated capacity"
        : "Shared (not on dedicated capacity)";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <DetailField label="Workspace">{d.workspace_name || d.workspace_id}</DetailField>
      <DetailField label="Workspace type">{d.workspace_type}</DetailField>
      <DetailField label="Workspace state">{d.workspace_state}</DetailField>
      <DetailField label="Capacity">{capacityLabel}</DetailField>
      <DetailField label="Capacity ID">{d.capacity_id}</DetailField>
      <DetailField label="Report type">{d.report_type}</DetailField>
      <DetailField label="Dataset ID">{d.dataset_id}</DetailField>
      <DetailField label="Created by">{d.created_by}</DetailField>
      <DetailField label="Modified by">{d.modified_by}</DetailField>
      <DetailField label="Created">{formatDateTime(d.created_at)}</DetailField>
      <DetailField label="Modified">{formatDateTime(d.modified_at)}</DetailField>
    </div>
  );
}

function TypeSpecificDetails({ detail }: { detail: AdminComponentDetail }) {
  const d = detail.inventory_details;
  if (!d) {
    return (
      <p className="text-sm text-muted-foreground">No linked inventory item for this component.</p>
    );
  }
  if (d.family === "agent") return <AgentDetails d={d} />;
  if (d.family === "powerapp") return <PowerAppDetails d={d} />;
  if (d.family === "cloudflow") return <CloudFlowDetails d={d} />;
  if (d.family === "powerbi") return <PowerBiDetails d={d} />;
  return <p className="text-sm text-muted-foreground">No type-specific inventory fields.</p>;
}

export default function ComponentDetailDialog({
  componentId,
  onOpenChange,
}: {
  componentId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-component-detail", componentId],
    queryFn: () => getAdminComponentDetail(componentId!),
    enabled: Boolean(componentId),
  });

  const placeLabel = (() => {
    if (!data) return null;
    if (data.inventory_details?.family === "powerbi") {
      return (
        data.inventory_details.workspace_name ||
        data.inventory_details.workspace_id ||
        (data.environments || []).join(", ") ||
        null
      );
    }
    const env =
      [data.environment_name || (data.environments || [])[0], data.environment_type]
        .filter(Boolean)
        .join(" · ") || null;
    return env;
  })();

  return (
    <Dialog open={!!componentId} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && (
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : "Failed to load component"}
          </p>
        )}
        {data && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span>{data.name}</span>
                <Badge variant="outline">{data.type}</Badge>
              </DialogTitle>
              <DialogDescription>
                Component details from Runpipe and linked inventory.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <DetailField label="Place">{placeLabel || "–"}</DetailField>
                <DetailField label="Status">
                  <Badge variant={data.status === "archived" ? "secondary" : "outline"}>
                    {data.status}
                  </Badge>
                </DetailField>
                <DetailField label="Owner">
                  {data.owner_name || data.owner_email ? (
                    <div>
                      <p>{data.owner_name || "–"}</p>
                      {data.owner_email && (
                        <p className="text-xs text-muted-foreground">{data.owner_email}</p>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">Unowned</span>
                  )}
                </DetailField>
                <DetailField label="Project">
                  {data.project_id ? (
                    <Link
                      to={`/project/${data.project_id}`}
                      className="text-primary hover:underline"
                    >
                      {data.project_name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Unassigned</span>
                  )}
                </DetailField>
                {data.open_url && (
                  <DetailField label="Open resource">
                    <a
                      href={data.open_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      Open
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </DetailField>
                )}
              </div>

              <div className="border-t pt-4 space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Inventory
                </p>
                <TypeSpecificDetails detail={data} />
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
