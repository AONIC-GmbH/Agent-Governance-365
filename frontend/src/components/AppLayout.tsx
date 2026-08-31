import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { LayoutDashboard, Puzzle, User, LogOut, Settings, UserCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { isMockMode } from "@/lib/devConfig";
import GlobalSearch from "@/components/GlobalSearch";
import { useTenantBranding } from "@/hooks/useTenantBranding";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/components", label: "Components", icon: Puzzle },
];

const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const { profile, isAdmin, signOut } = useAuth();
  const { toolName, logoSrc } = useTenantBranding();

  useEffect(() => {
    document.title = `${toolName} - Power Platform Management`;
  }, [toolName]);

  return (
    <div className="min-h-screen flex flex-col">
      {isMockMode && (
        <div className="bg-warning/15 border-b border-warning/30 text-center py-1.5 text-xs font-medium text-warning-foreground">
          Mock mode — static data only, no backend connection
        </div>
      )}
      <header className="border-b bg-card sticky top-0 z-30">
        <div className="container flex items-center h-16 gap-8">
          <Link to="/" className="flex items-center gap-2">
            <img src={logoSrc} alt={toolName} className="h-10" />
          </Link>
          <nav className="flex items-center gap-1">
            {navItems.map((item) => {
              const active = location.pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex-1 flex justify-center">
            <GlobalSearch />
          </div>
          <div className="flex items-center gap-3">
            <Popover>
              <PopoverTrigger asChild>
                <button className="flex items-center gap-2 text-sm rounded-lg px-3 py-2 hover:bg-muted transition-colors cursor-pointer">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                  <div className="hidden sm:block text-left">
                    <span className="font-medium">{profile?.full_name ?? "Loading..."}</span>
                  </div>
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 p-2">
                <div className="px-3 py-2 border-b mb-1">
                  <p className="font-medium text-sm">{profile?.full_name}</p>
                  <p className="text-xs text-muted-foreground">{profile?.email}</p>
                </div>
                <Link to="/profile" className="flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors">
                  <UserCircle className="h-4 w-4" /> My Profile
                </Link>
                {isAdmin && (
                  <Link to="/admin" className="flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors">
                    <Settings className="h-4 w-4" /> Admin Settings
                  </Link>
                )}
                <button onClick={signOut} className="flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors w-full text-left text-destructive">
                  <LogOut className="h-4 w-4" /> Sign out
                </button>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <div className="container py-8 animate-fade-in">{children}</div>
      </main>
    </div>
  );
};

export default AppLayout;
