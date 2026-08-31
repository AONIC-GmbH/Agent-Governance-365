import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  getPublicBranding,
  getTenant,
  tenantLogoUrl,
  type Tenant,
} from "@/services/coeService";
import defaultLogo from "@/assets/logo.png";

export function useTenantBranding() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;

  const { data: branding } = useQuery({
    queryKey: ["tenant-branding", tenantId || "public"],
    queryFn: async (): Promise<Tenant> => {
      if (tenantId) return getTenant(tenantId);
      return getPublicBranding();
    },
    staleTime: 60_000,
  });

  const toolName = branding?.tool_name || "Runpipe";
  const companyName = branding?.name || "";
  const logoSrc =
    branding?.has_logo && branding.id
      ? tenantLogoUrl(branding.id, branding.logo_version || branding.created_at)
      : defaultLogo;

  return { branding, toolName, companyName, logoSrc, tenantId: branding?.id };
}
