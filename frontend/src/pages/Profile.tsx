import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import {
  insertComponents,
  getAssignedComponentIds,
  getMyComponentIds,
  deleteComponents,
} from "@/services/coeService";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { User, DatabaseZap, Trash2, Loader2 } from "lucide-react";

const DUMMY_COMPONENTS = [
  { name: "Sales Dashboard", type: "Power BI", environments: ["Development", "Production"], url: "https://app.powerbi.com/groups/me/reports/sales", status: "unassigned" },
  { name: "Leave Request App", type: "Power App", environments: ["Development"], url: "https://apps.powerapps.com/play/leave-request", status: "unassigned" },
  { name: "Invoice Approval Flow", type: "Power Automate", environments: ["Development", "Production"], url: "https://make.powerautomate.com/flows/invoice-approval", status: "unassigned" },
  { name: "IT Helpdesk Bot", type: "Copilot Agent", environments: ["Development"], url: "https://copilotstudio.microsoft.com/bots/helpdesk", status: "unassigned" },
  { name: "Inventory Tracker", type: "Power App", environments: ["Development", "Production"], url: "https://apps.powerapps.com/play/inventory", status: "unassigned" },
  { name: "Monthly KPI Report", type: "Power BI", environments: ["Development"], url: "https://app.powerbi.com/groups/me/reports/kpi", status: "unassigned" },
];

const Profile = () => {
  const { profile, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [seeding, setSeeding] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSeedData = async () => {
    if (!profile) return;
    setSeeding(true);
    const rows = DUMMY_COMPONENTS.map((c) => ({
      ...c,
      tenant_id: profile.tenant_id,
      owner_id: profile.id,
    }));
    const { error } = await insertComponents(rows);
    setSeeding(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${rows.length} sample components created!`);
    queryClient.invalidateQueries({ queryKey: ["components"] });
    queryClient.invalidateQueries({ queryKey: ["all-project-components"] });
  };

  const handleDeleteDummyData = async () => {
    if (!profile) return;
    setDeleting(true);
    const assignedIds = await getAssignedComponentIds();
    const assignedSet = new Set(assignedIds);

    const myComponentIds = await getMyComponentIds(profile.id);
    const toDelete = myComponentIds.filter((id) => !assignedSet.has(id));

    if (toDelete.length === 0) {
      toast.info("No deletable components found.");
      setDeleting(false);
      return;
    }

    const { error } = await deleteComponents(toDelete);
    setDeleting(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${toDelete.length} components deleted!`);
    queryClient.invalidateQueries({ queryKey: ["components"] });
    queryClient.invalidateQueries({ queryKey: ["all-project-components"] });
  };

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-3xl font-heading font-bold">My Profile</h1>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" /> Personal details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Name</p>
              <p className="font-medium">{profile?.full_name}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Email</p>
              <p className="font-medium">{profile?.email}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Role</p>
              <p className="font-medium">{isAdmin ? "Administrator" : "User"}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DatabaseZap className="h-5 w-5" /> Test data
            </CardTitle>
          </CardHeader>
          <CardContent className="flex gap-3">
            <Button variant="outline" className="gap-2" onClick={handleSeedData} disabled={seeding}>
              {seeding ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseZap className="h-4 w-4" />}
              Create sample data
            </Button>
            <Button variant="destructive" className="gap-2" onClick={handleDeleteDummyData} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete unassigned
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default Profile;
