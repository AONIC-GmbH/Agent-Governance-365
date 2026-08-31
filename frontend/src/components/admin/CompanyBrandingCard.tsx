import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import {
  getTenant,
  updateTenant,
  uploadTenantLogo,
  deleteTenantLogo,
  tenantLogoUrl,
} from "@/services/coeService";
import defaultLogo from "@/assets/logo.png";

const LOGO_MAX_BYTES = 512 * 1024;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];

export default function CompanyBrandingCard({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [toolName, setToolName] = useState("");
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoVersion, setLogoVersion] = useState(0);
  const [pendingLogo, setPendingLogo] = useState<{ file: File; url: string } | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  const { data: tenant, isLoading } = useQuery({
    queryKey: ["admin-tenant", tenantId],
    queryFn: () => getTenant(tenantId),
    enabled: !!tenantId,
  });

  useEffect(() => {
    if (tenant) {
      setName(tenant.name || "");
      setToolName(tenant.tool_name || "Runpipe");
    }
  }, [tenant]);

  useEffect(() => () => {
    if (pendingLogo) URL.revokeObjectURL(pendingLogo.url);
  }, [pendingLogo]);

  const refreshBranding = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-tenant"] });
    queryClient.invalidateQueries({ queryKey: ["tenant-branding"] });
  };

  const clearPendingLogo = () => setPendingLogo(null);

  const handleSave = async () => {
    if (!name.trim() || !toolName.trim()) return;
    setSaving(true);
    const { error } = await updateTenant(tenantId, {
      name: name.trim(),
      tool_name: toolName.trim(),
    });
    if (error) {
      setSaving(false);
      toast.error(error.message);
      return;
    }
    if (pendingLogo) {
      const { error: logoError } = await uploadTenantLogo(tenantId, pendingLogo.file);
      if (logoError) {
        setSaving(false);
        toast.error(logoError.message);
        return;
      }
      clearPendingLogo();
      setLogoVersion((v) => v + 1);
    }
    setSaving(false);
    setPreviewFailed(false);
    toast.success("Company details saved");
    refreshBranding();
  };

  const handleLogoPick = (file: File | undefined) => {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) {
      toast.error("Logo must be PNG, JPEG, or WebP");
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast.error("Logo must be at most 512 KB");
      return;
    }
    setPendingLogo({ file, url: URL.createObjectURL(file) });
    setPreviewFailed(false);
  };

  const handleRemoveLogo = async () => {
    if (pendingLogo) {
      clearPendingLogo();
      return;
    }
    setLogoBusy(true);
    const { error } = await deleteTenantLogo(tenantId);
    setLogoBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Logo removed");
    setLogoVersion((v) => v + 1);
    refreshBranding();
  };

  if (isLoading) {
    return <p className="text-muted-foreground text-center py-8">Loading...</p>;
  }

  const savedLogoSrc =
    tenant?.has_logo && !previewFailed
      ? tenantLogoUrl(tenantId, `${tenant.logo_version || tenant.created_at}-${logoVersion}`)
      : defaultLogo;
  const previewSrc = pendingLogo?.url ?? savedLogoSrc;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5" /> Company Details
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 max-w-md">
        <div className="space-y-2">
          <Label htmlFor="company-name">Company Name</Label>
          <Input
            id="company-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Organisation name"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tool-name">Tool Name</Label>
          <Input
            id="tool-name"
            value={toolName}
            onChange={(e) => setToolName(e.target.value)}
            placeholder="Runpipe"
          />
          <p className="text-xs text-muted-foreground">
            Shown in the header, login screen, and browser title.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Logo</Label>
          <div className="flex items-center gap-4">
            <img
              src={previewSrc}
              alt="Logo preview"
              className="h-12 w-auto max-w-[160px] object-contain rounded border bg-muted/30 p-1"
              onError={() => {
                if (!pendingLogo) setPreviewFailed(true);
              }}
            />
            <div className="space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  handleLogoPick(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={logoBusy || saving}
                  onClick={() => fileRef.current?.click()}
                >
                  {pendingLogo ? "Choose another file" : "Choose logo"}
                </Button>
                {(pendingLogo || tenant?.has_logo) && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={logoBusy || saving}
                    onClick={handleRemoveLogo}
                  >
                    {pendingLogo ? "Discard" : logoBusy ? "Removing..." : "Remove"}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                PNG, JPEG, or WebP · max 512 KB · square (≥128×128) works best in the header
              </p>
              {pendingLogo && (
                <p className="text-xs text-amber-600">
                  {pendingLogo.file.name} selected — click Save to apply.
                </p>
              )}
            </div>
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving || !name.trim() || !toolName.trim()}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
