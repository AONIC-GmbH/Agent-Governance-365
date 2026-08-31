import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listAgentCredits,
  listCreditRateCards,
  saveCreditRateCards,
  listBusinessUnits,
  type CreditRateCard,
  type AgentCreditRow,
} from "@/services/coeService";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function defaultFrom() {
  const d = new Date();
  return isoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
}

function formatCredits(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatEuro(n: number) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  });
}

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

type DraftRate = {
  key: string;
  label: string;
  euro_per_credit: string;
  effective_from: string;
  effective_to: string;
};

function toDraft(cards: CreditRateCard[]): DraftRate[] {
  return cards.map((c) => ({
    key: c.id,
    label: c.label || "",
    euro_per_credit: String(c.euro_per_credit),
    effective_from: c.effective_from,
    effective_to: c.effective_to || "",
  }));
}

export default function AgentCostTab() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const queryClient = useQueryClient();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(() => isoDate(new Date()));
  const [businessUnitId, setBusinessUnitId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [draftRates, setDraftRates] = useState<DraftRate[] | null>(null);
  const [savingRates, setSavingRates] = useState(false);
  const [selected, setSelected] = useState<AgentCreditRow | null>(null);

  const { data: businessUnits = [] } = useQuery({
    queryKey: ["business-units-active", tenantId],
    queryFn: () => listBusinessUnits(tenantId!, { activeOnly: true }),
    enabled: !!tenantId,
  });

  const { data: rates = [], isLoading: ratesLoading } = useQuery({
    queryKey: ["credit-rate-cards"],
    queryFn: () => listCreditRateCards(),
  });

  const filters = {
    from,
    to,
    business_unit_id: businessUnitId || undefined,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-agent-credits", filters],
    queryFn: () => listAgentCredits(filters),
    enabled: Boolean(from && to),
  });

  const editingRates = draftRates ?? toDraft(rates);

  const rows = data?.items || [];
  const searchQ = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (!searchQ) return true;
        return [
          r.display_name,
          r.agent_resource_id,
          r.environment_name,
          r.project_name,
          r.business_unit_name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(searchQ);
      }),
    [rows, searchQ]
  );

  const saveRates = async () => {
    setSavingRates(true);
    try {
      const cards = editingRates.map((r) => ({
        label: r.label.trim(),
        euro_per_credit: Number(r.euro_per_credit),
        effective_from: r.effective_from,
        effective_to: r.effective_to.trim() || null,
      }));
      await saveCreditRateCards(cards);
      toast.success("Rate card saved");
      setDraftRates(null);
      queryClient.invalidateQueries({ queryKey: ["credit-rate-cards"] });
      queryClient.invalidateQueries({ queryKey: ["admin-agent-credits"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save rate card");
    } finally {
      setSavingRates(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Agent credits</CardTitle>
          <CardDescription>
            Actual Copilot Studio credit consumption from the Copilot Agent Kit usage history.
            Sync data from the Inventory tab, then filter by period and business unit.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label htmlFor="credits-from">From</Label>
              <Input
                id="credits-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="credits-to">To</Label>
              <Input
                id="credits-to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <div>
              <Label>Business unit</Label>
              <Select
                value={businessUnitId || "__all__"}
                onValueChange={(v) => setBusinessUnitId(v === "__all__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All business units" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All business units</SelectItem>
                  <SelectItem value="__unassigned__">Unassigned</SelectItem>
                  {businessUnits.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="credits-search">Search</Label>
              <Input
                id="credits-search"
                placeholder="Agent, project, environment…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {error ? (
            <p className="text-sm text-destructive">
              {error instanceof Error ? error.message : "Failed to load credits"}
            </p>
          ) : isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Billed credits</CardDescription>
                    <CardTitle className="text-2xl">
                      {formatCredits(data?.billed_credits_total || 0)}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {formatEuro(data?.billed_euro_total || 0)}
                    </p>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Unbilled credits</CardDescription>
                    <CardTitle className="text-2xl">
                      {formatCredits(data?.unbilled_credits_total || 0)}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">Not included in EUR</p>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Estimated EUR (billed only)</CardDescription>
                    <CardTitle className="text-2xl">
                      {formatEuro(data?.euro_total || 0)}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {data?.count || 0} agent{(data?.count || 0) === 1 ? "" : "s"}
                    </p>
                  </CardHeader>
                </Card>
              </div>

              <div className="overflow-x-auto border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead>Environment</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Business unit</TableHead>
                      <TableHead className="text-right">Billed</TableHead>
                      <TableHead className="text-right">Unbilled</TableHead>
                      <TableHead className="text-right">EUR</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                          No usage in this period. Run Copilot Kit usage sync from Jobs, or widen the dates.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filtered.map((r) => (
                        <TableRow
                          key={r.agent_key}
                          className="cursor-pointer"
                          onClick={() => setSelected(r)}
                        >
                          <TableCell className="font-medium max-w-[220px] truncate text-primary" title={r.display_name}>
                            {r.display_name}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {r.environment_name || r.environment_id || "–"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {r.project_id ? (
                              <Link
                                to={`/project/${r.project_id}`}
                                className="text-primary hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {r.project_name}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">–</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {r.business_unit_name ? (
                              <Badge variant="secondary">{r.business_unit_name}</Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">Unassigned</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCredits(r.billed_credits)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCredits(r.unbilled_credits)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatEuro(r.euro)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
                <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
                  {selected && (() => {
                    const d = selected.inventory_details;
                    const envLabel =
                      [selected.environment_name || selected.environment_id, selected.environment_type || d?.environment_type]
                        .filter(Boolean)
                        .join(" · ") || null;
                    const owner = d?.owner_external || null;
                    const viewers = d?.shared_with_viewers;
                    return (
                      <>
                        <DialogHeader>
                          <DialogTitle>{selected.display_name}</DialogTitle>
                          <DialogDescription>
                            Inventory and credit details for the selected period. Inventory reflects the published agent configuration.
                          </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <DetailField label="Environment">{envLabel}</DetailField>
                            <DetailField label="Created in">{d?.created_in}</DetailField>
                            <DetailField label="Project">
                              {selected.project_id ? (
                                <Link
                                  to={`/project/${selected.project_id}`}
                                  className="text-primary hover:underline"
                                >
                                  {selected.project_name}
                                </Link>
                              ) : (
                                <span className="text-muted-foreground">–</span>
                              )}
                            </DetailField>
                            <DetailField label="Business unit">
                              {selected.business_unit_name || (
                                <span className="text-muted-foreground">Unassigned</span>
                              )}
                            </DetailField>
                            <DetailField label="Owner">{owner}</DetailField>
                            <DetailField label="Created">
                              {formatDateTime(d?.created_at)}
                            </DetailField>
                          </div>

                          <div className="border-t pt-4 space-y-3">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                              Credits ({from} → {to})
                            </p>
                            <div className="grid gap-3 sm:grid-cols-3">
                              <DetailField label="Billed">{formatCredits(selected.billed_credits)}</DetailField>
                              <DetailField label="Unbilled">{formatCredits(selected.unbilled_credits)}</DetailField>
                              <DetailField label="EUR (billed)">{formatEuro(selected.euro)}</DetailField>
                            </div>
                          </div>

                          <div className="border-t pt-4 space-y-3">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                              Configuration
                            </p>
                            {!d ? (
                              <p className="text-sm text-muted-foreground">
                                No linked inventory item for this agent.
                              </p>
                            ) : (
                              <div className="grid gap-3 sm:grid-cols-2">
                                <DetailField label="Orchestration">{d.orchestration}</DetailField>
                                <DetailField label="Model">{d.model}</DetailField>
                                <DetailField label="Authentication">{d.authentication}</DetailField>
                                <DetailField label="Published">
                                  {d.is_published
                                    ? formatDateTime(d.last_published_at) || "Yes"
                                    : "Draft / not published"}
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
                                    <span className="text-muted-foreground">–</span>
                                  )}
                                </DetailField>
                                <DetailField label="Web search">
                                  {d.web_search_enabled ? "Enabled" : "Disabled"}
                                </DetailField>
                                <DetailField label="Connectors">
                                  {d.connector_count}
                                  {d.connector_operations != null
                                    ? ` (${d.connector_operations} operations)`
                                    : ""}
                                </DetailField>
                                {d.connector_ids?.length > 0 && (
                                  <DetailField label="Connector IDs">
                                    <div className="flex flex-wrap gap-1.5">
                                      {d.connector_ids.map((id) => (
                                        <Badge key={id} variant="outline" className="font-normal">
                                          {id}
                                        </Badge>
                                      ))}
                                    </div>
                                  </DetailField>
                                )}
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
                                {d.is_managed != null && (
                                  <DetailField label="Managed solution">
                                    {d.is_managed ? "Yes" : "No"}
                                  </DetailField>
                                )}
                                <DetailField label="Schema name">{d.schema_name}</DetailField>
                              </div>
                            )}
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </DialogContent>
              </Dialog>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rate card (€ / credit)</CardTitle>
          <CardDescription>
            Date-ranged rates used to convert billed credits to EUR for the selected period.
            Ranges must not overlap.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {ratesLoading && !draftRates ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="space-y-3">
                {editingRates.map((r, idx) => (
                  <div
                    key={r.key}
                    className="grid gap-2 sm:grid-cols-5 items-end border rounded-md p-3"
                  >
                    <div>
                      <Label>Label</Label>
                      <Input
                        value={r.label}
                        onChange={(e) => {
                          const next = [...editingRates];
                          next[idx] = { ...r, label: e.target.value };
                          setDraftRates(next);
                        }}
                        placeholder="e.g. 2026 H1"
                      />
                    </div>
                    <div>
                      <Label>€ / credit</Label>
                      <Input
                        type="number"
                        step="0.0001"
                        min="0"
                        value={r.euro_per_credit}
                        onChange={(e) => {
                          const next = [...editingRates];
                          next[idx] = { ...r, euro_per_credit: e.target.value };
                          setDraftRates(next);
                        }}
                      />
                    </div>
                    <div>
                      <Label>From</Label>
                      <Input
                        type="date"
                        value={r.effective_from}
                        onChange={(e) => {
                          const next = [...editingRates];
                          next[idx] = { ...r, effective_from: e.target.value };
                          setDraftRates(next);
                        }}
                      />
                    </div>
                    <div>
                      <Label>To (optional)</Label>
                      <Input
                        type="date"
                        value={r.effective_to}
                        onChange={(e) => {
                          const next = [...editingRates];
                          next[idx] = { ...r, effective_to: e.target.value };
                          setDraftRates(next);
                        }}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="gap-2"
                      onClick={() => {
                        setDraftRates(editingRates.filter((_, i) => i !== idx));
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  onClick={() =>
                    setDraftRates([
                      ...editingRates,
                      {
                        key: `new-${Date.now()}`,
                        label: "",
                        euro_per_credit: "0.008",
                        effective_from: isoDate(new Date()),
                        effective_to: "",
                      },
                    ])
                  }
                >
                  <Plus className="h-4 w-4" />
                  Add rate
                </Button>
                <Button onClick={saveRates} disabled={savingRates || editingRates.length === 0}>
                  {savingRates ? "Saving…" : "Save rate card"}
                </Button>
                {draftRates && (
                  <Button type="button" variant="ghost" onClick={() => setDraftRates(null)}>
                    Cancel
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
