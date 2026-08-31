import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { searchDirectoryUsers, type ProfileSummary } from "@/services/coeService";

interface UserPickerProps {
  onSelect: (user: ProfileSummary) => void;
  /** Ids to hide from results (e.g. existing collaborators + the current user). */
  excludeIds?: string[];
  placeholder?: string;
  triggerLabel?: string;
  disabled?: boolean;
  className?: string;
}

const UserPicker = ({
  onSelect,
  excludeIds = [],
  placeholder = "Search people in your directory...",
  triggerLabel = "Select a user...",
  disabled,
  className,
}: UserPickerProps) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["directory-users", debounced],
    queryFn: () => searchDirectoryUsers(debounced),
    enabled: open,
    staleTime: 30_000,
  });

  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);
  const visible = results.filter((u) => !excluded.has(u.id));

  const handlePick = (user: ProfileSummary) => {
    onSelect(user);
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setSearch(""); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("justify-between font-normal", className)}
        >
          <span className="text-muted-foreground">{triggerLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[260px]" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={placeholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {isFetching ? (
                <span className="flex items-center justify-center gap-2 text-muted-foreground">
                  <Search className="h-3.5 w-3.5 animate-pulse" /> Searching...
                </span>
              ) : (
                "No people found."
              )}
            </CommandEmpty>
            {visible.length > 0 && (
              <CommandGroup>
                {visible.map((user) => (
                  <CommandItem
                    key={user.id}
                    value={user.id}
                    onSelect={() => handlePick(user)}
                    className="flex items-center gap-2"
                  >
                    <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary shrink-0">
                      {user.full_name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{user.full_name}</p>
                      <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                    </div>
                    <Check className="h-4 w-4 opacity-0" />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default UserPicker;
