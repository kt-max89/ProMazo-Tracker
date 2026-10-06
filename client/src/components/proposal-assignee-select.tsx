import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import type { AssignmentUser } from "@shared/proposalAssignments";

// Kept separate from the board's controls: proposal eligibility is team-specific.
export function ProposalAssigneeSelect({
  users, selected, labels, onChange, onOpen, disabled, testId,
}: {
  users: AssignmentUser[];
  selected: number[];
  labels: Map<number, string>;
  onChange: (ids: number[]) => void;
  onOpen: () => void;
  disabled: boolean;
  testId: string;
}) {
  return (
    <div className="space-y-2">
      <DropdownMenu onOpenChange={open => { if (open) onOpen(); }}>
        <DropdownMenuTrigger asChild>
          <button type="button" disabled={disabled} data-testid={testId}
            aria-label="Choose task assignees"
            className="w-full text-sm border border-input rounded-md px-3 py-2 text-left disabled:opacity-50">
            {selected.length ? `${selected.length} selected — change assignees` : "Unassigned — choose assignees"}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-60 overflow-y-auto">
          {users.map(user => (
            <DropdownMenuCheckboxItem key={user.id} checked={selected.includes(user.id)}
              data-testid={`proposal-assignee-option-${user.id}`}
              onSelect={event => event.preventDefault()}
              onCheckedChange={checked => onChange(checked
                ? [...selected, user.id] : selected.filter(id => id !== user.id))}>
              <span>{user.displayName} <span className="text-muted-foreground">({user.email})</span></span>
            </DropdownMenuCheckboxItem>
          ))}
          {!users.length && <p className="p-2 text-sm">No active team members available.</p>}
        </DropdownMenuContent>
      </DropdownMenu>
      <ul className="flex flex-wrap gap-1" aria-label="Selected assignees">
        {selected.map(id => (
          <li key={id} className="text-xs rounded border px-2 py-1">
            {labels.get(id) ?? `User #${id}`}
            <button type="button" disabled={disabled} className="ml-2"
              aria-label={`Remove ${labels.get(id) ?? `User #${id}`}`}
              onClick={() => onChange(selected.filter(value => value !== id))}>×</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
