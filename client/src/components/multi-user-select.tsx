import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { queryClient } from "@/lib/queryClient";

type AppUser = { id: number; displayName: string; email: string; isActive: boolean };

export function MultiUserSelect({
  users,
  value,
  onChange,
  testId,
}: {
  users: AppUser[];
  value: number[];
  onChange: (ids: number[]) => void;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedUsers = users.filter(u => value.includes(u.id));
  const assignableUsers = users.filter(u => u.isActive);

  function toggle(id: number) {
    if (value.includes(id)) {
      onChange(value.filter(v => v !== id));
    } else {
      onChange([...value, id]);
    }
  }

  return (
    <Popover open={open} onOpenChange={nextOpen => {
      setOpen(nextOpen);
      if (nextOpen) {
        // Status may have changed in another session since this form loaded.
        void queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      }
    }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          data-testid={testId}
          className="w-full justify-between font-normal h-auto min-h-9 py-1.5"
        >
          <div className="flex flex-wrap gap-1 flex-1">
            {selectedUsers.length === 0 ? (
              <span className="text-muted-foreground">Unassigned</span>
            ) : (
              selectedUsers.map(u => (
                <Badge
                  key={u.id}
                  variant="secondary"
                  className="gap-1 font-normal"
                  onClick={(e) => e.stopPropagation()}
                >
                  {u.displayName}
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(e) => { e.stopPropagation(); toggle(u.id); }}
                    className="rounded-full hover:bg-muted-foreground/20"
                  >
                    <X className="w-3 h-3" />
                  </span>
                </Badge>
              ))
            )}
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0 overflow-hidden">
        <Command className="overflow-visible">
          <CommandInput placeholder="Search people..." />
          <CommandList className="max-h-52 overflow-y-auto overflow-x-hidden">
            <CommandEmpty>No one found.</CommandEmpty>
            <CommandGroup>
              {assignableUsers.map(u => (
                <CommandItem
                  key={u.id}
                  value={u.displayName}
                  onSelect={() => toggle(u.id)}
                  data-testid={`option-assignee-${u.id}`}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value.includes(u.id) ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {u.displayName}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
