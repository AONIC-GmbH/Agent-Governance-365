import { useEffect, useRef } from "react";
import { useMsal } from "@azure/msal-react";
import { InteractionStatus } from "@azure/msal-browser";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { isEntraMode } from "@/lib/authMode";
import { getTokenRequest } from "@/lib/msalConfig";
import { toast } from "sonner";
import { useTenantBranding } from "@/hooks/useTenantBranding";

const EntraAuth = () => {
  const { instance, inProgress } = useMsal();
  const loggingIn = useRef(false);
  const busy = inProgress !== InteractionStatus.None || loggingIn.current;
  const { toolName, logoSrc } = useTenantBranding();

  useEffect(() => {
    document.title = `${toolName} - Sign in`;
  }, [toolName]);

  const handleEntraLogin = async () => {
    if (busy) return;
    loggingIn.current = true;
    try {
      await instance.loginRedirect(getTokenRequest());
    } catch (e) {
      loggingIn.current = false;
      const message = e instanceof Error ? e.message : "Sign-in failed";
      if (!message.includes("user_cancelled")) {
        toast.error(message);
      }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-4">
          <img src={logoSrc} alt={toolName} className="h-12 mx-auto" />
          <CardTitle className="text-2xl font-heading">{toolName}</CardTitle>
        </CardHeader>
        <CardContent>
          <Button type="button" className="w-full" disabled={busy} onClick={handleEntraLogin}>
            {busy ? "Redirecting..." : "Sign in with Microsoft"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

const MockNotice = () => {
  const { toolName, logoSrc } = useTenantBranding();
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-4">
          <img src={logoSrc} alt={toolName} className="h-12 mx-auto" />
          <CardTitle className="text-2xl font-heading">Mock Mode</CardTitle>
          <CardDescription>
            Sign-in is disabled in mock mode — you are signed in automatically.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
};

const Auth = () => (isEntraMode ? <EntraAuth /> : <MockNotice />);

export default Auth;
