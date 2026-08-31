import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowDown, ArrowUp, Building } from "lucide-react";
import { toast } from "sonner";
import {
  listBusinessUnits,
  createBusinessUnit,
  updateBusinessUnit,
  deactivateBusinessUnit,
  type BusinessUnit,
} from "@/services/coeService";

export default function BusinessUnitsCard({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: units = [], isLoading } = useQuery({
    queryKey: ["business-units", tenantId],
    queryFn: () => listBusinessUnits(tenantId),
    enabled: !!tenantId,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["business-units", tenantId] });
  };

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    const { error } = await createBusinessUnit(tenantId, {
      name: newName.trim(),
      sort_order: units.length,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setNewName("");
    toast.success("Business unit added");
    refresh();
  };

  const move = async (unit: BusinessUnit, dir: -1 | 1) => {
    const ordered = [...units].sort((a, b) => a.sort_order - b.sort_order);
    const idx = ordered.findIndex((u) => u.id === unit.id);
    const swap = ordered[idx + dir];
    if (!swap) return;
    setBusy(true);
    await updateBusinessUnit(tenantId, unit.id, { sort_order: swap.sort_order });
    await updateBusinessUnit(tenantId, swap.id, { sort_order: unit.sort_order });
    setBusy(false);
    refresh();
  };

  const toggleActive = async (unit: BusinessUnit) => {
    setBusy(true);
    const { error } = unit.is_active
      ? await deactivateBusinessUnit(tenantId, unit.id)
      : await updateBusinessUnit(tenantId, unit.id, { is_active: true });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    refresh();
  };

  const rename = async (unit: BusinessUnit, name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === unit.name) return;
    const { error } = await updateBusinessUnit(tenantId, unit.id, { name: trimmed });
    if (error) toast.error(error.message);
    else refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building className="h-5 w-5" /> Business Units
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Options shown when creating a project. Deactivating hides a unit from new projects without
          removing it from existing ones.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 max-w-lg">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <div className="space-y-2">
            {units.map((unit) => (
              <div
                key={unit.id}
                className={`flex items-center gap-2 p-2 rounded-md border ${
                  unit.is_active ? "bg-muted/30" : "opacity-60 bg-muted/10"
                }`}
              >
                <div className="flex flex-col">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={busy}
                    onClick={() => move(unit, -1)}
                  >
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={busy}
                    onClick={() => move(unit, 1)}
                  >
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                </div>
                <Input
                  defaultValue={unit.name}
                  className="flex-1"
                  onBlur={(e) => rename(unit, e.target.value)}
                />
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => toggleActive(unit)}>
                  {unit.is_active ? "Deactivate" : "Activate"}
                </Button>
              </div>
            ))}
            {units.length === 0 && (
              <p className="text-sm text-muted-foreground">No business units yet.</p>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Finance"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <Button onClick={handleAdd} disabled={busy || !newName.trim()}>
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
