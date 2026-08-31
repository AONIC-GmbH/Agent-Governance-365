import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Search, FolderKanban } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useComponents, useProjects, useMyCollaboratorProjectIds } from "@/hooks/useCoeData";
import { useAuth } from "@/contexts/AuthContext";
import { ComponentIcon } from "@/components/ComponentIcon";
import type { ComponentType } from "@/data/types";

const GlobalSearch = () => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: allComponents = [] } = useComponents();
  const { data: allProjects = [] } = useProjects();
  const { data: myCollabProjectIds = new Set<string>() } = useMyCollaboratorProjectIds();

  // Match Dashboard scope: own (non-archived) components; own + collaborator projects.
  const components = allComponents.filter(
    (c) => c.owner_id === user?.id && c.status !== "archived"
  );
  const projects = allProjects.filter(
    (p) => p.owner_id === user?.id || myCollabProjectIds.has(p.id)
  );

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md border bg-muted/50 text-muted-foreground text-sm hover:bg-muted transition-colors w-56"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left truncate">Search…</span>
        <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] text-muted-foreground">
          Ctrl+K
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search components, projects…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          {components.length > 0 && (
            <CommandGroup heading="Components">
              {components.map((comp) => (
                <CommandItem
                  key={`comp-${comp.id}`}
                  value={`${comp.id} ${comp.name} ${comp.type} ${comp.environments.join(" ")}`}
                  onSelect={() => {
                    setOpen(false);
                    navigate(`/components?id=${encodeURIComponent(comp.id)}`);
                  }}
                >
                  <ComponentIcon type={comp.type as ComponentType} size="sm" />
                  <div className="ml-2 min-w-0 flex-1">
                    <span className="block truncate">{comp.name}</span>
                    {comp.environments.length > 0 && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {comp.environments.join(", ")}
                      </span>
                    )}
                  </div>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{comp.type}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {projects.length > 0 && (
            <CommandGroup heading="Projects">
              {projects.map((proj) => (
                <CommandItem
                  key={`proj-${proj.id}`}
                  value={`${proj.id} ${proj.name} ${proj.description ?? ""} ${proj.status}`}
                  onSelect={() => {
                    setOpen(false);
                    navigate(`/project/${proj.id}`);
                  }}
                >
                  <FolderKanban className="h-4 w-4 text-muted-foreground" />
                  <span className="ml-2">{proj.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground capitalize">{proj.status}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
};

export default GlobalSearch;
