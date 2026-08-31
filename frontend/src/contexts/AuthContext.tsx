import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import type { AccountInfo } from "@azure/msal-browser";
import { useMsal } from "@azure/msal-react";
import type { Session, User } from "@/lib/authTypes";
import { toast } from "sonner";
import { isEntraMode } from "@/lib/authMode";
import { getTokenRequest } from "@/lib/msalConfig";
import {
  setAccessTokenProvider,
  syncAuthSession,
  type Profile,
} from "@/services/coeService";
import { mockAuthUser, getMockProfile, getMockIsAdmin } from "@/data/mockCoeData";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isAdmin: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  isAdmin: false,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

function accountToUser(account: AccountInfo): User {
  const id = (account.idTokenClaims?.oid as string | undefined) ?? account.localAccountId;
  return {
    id,
    email: account.username,
    app_metadata: {},
    user_metadata: { full_name: account.name ?? account.username },
    aud: "authenticated",
    created_at: new Date().toISOString(),
  } as User;
}

async function acquireIdToken(instance: ReturnType<typeof useMsal>["instance"], account: AccountInfo) {
  const res = await instance.acquireTokenSilent({ ...getTokenRequest(), account });
  return res.idToken;
}

const EntraAuthProvider = ({ children }: { children: ReactNode }) => {
  const { instance, accounts } = useMsal();
  const account = instance.getActiveAccount() ?? accounts[0] ?? null;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const syncedAccountId = useRef<string | null>(null);

  const user = account ? accountToUser(account) : null;

  useEffect(() => {
    setAccessTokenProvider(async () => {
      const active = instance.getActiveAccount() ?? accounts[0];
      if (!active) return null;
      try {
        return await acquireIdToken(instance, active);
      } catch {
        return null;
      }
    });
  }, [instance, accounts]);

  useEffect(() => {
    if (!account) {
      syncedAccountId.current = null;
      setProfile(null);
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    instance.setActiveAccount(account);

    const accountId = account.homeAccountId;
    if (syncedAccountId.current === accountId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const idToken = await acquireIdToken(instance, account);
        const synced = await syncAuthSession(idToken);
        if (!cancelled) {
          syncedAccountId.current = accountId;
          setProfile(synced.profile);
          setIsAdmin(synced.isAdmin);
        }
      } catch (e) {
        console.error("Auth sync failed:", e);
        if (!cancelled) {
          toast.error(
            e instanceof Error ? e.message : "Could not sync profile with backend"
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [account?.homeAccountId, instance]);

  const signOut = async () => {
    syncedAccountId.current = null;
    await instance.logoutRedirect({ postLogoutRedirectUri: window.location.origin + "/auth" });
  };

  return (
    <AuthContext.Provider value={{ session: null, user, profile, isAdmin, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

const MockAuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // When Entra is not configured, use the seeded local user so the UI can
    // talk to a live API (memory store) without Microsoft login — used by e2e.
    setUser(mockAuthUser);
    setProfile(getMockProfile());
    setIsAdmin(getMockIsAdmin());
    setLoading(false);
  }, []);

  const signOut = async () => {
    setUser(null);
    setProfile(null);
    setIsAdmin(false);
  };

  return (
    <AuthContext.Provider value={{ session: null, user, profile, isAdmin, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  if (isEntraMode) {
    return <EntraAuthProvider>{children}</EntraAuthProvider>;
  }
  return <MockAuthProvider>{children}</MockAuthProvider>;
};
