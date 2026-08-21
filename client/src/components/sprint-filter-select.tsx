import type { Sprint } from "@shared/schema";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SprintFilterValue } from "@/lib/sprints";

export function SprintFilterSelect({
  value,
  onValueChange,
  sprints,
  className = "h-8 text-sm w-44",
  testId,
}: {
  value: SprintFilterValue;
  onValueChange: (value: SprintFilterValue) => void;
  sprints: Sprint[];
  className?: string;
  testId?: string;
}) {
  return (
    <Select value={value} onValueChange={(next) => onValueChange(next as SprintFilterValue)}>
      <SelectTrigger className={className} data-testid={testId}>
        <SelectValue placeholder="Sprint view" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="current">Current sprint</SelectItem>
        <SelectItem value="all">All sprints</SelectItem>
        <SelectItem value="backlog">Backlog</SelectItem>
        {sprints.map((sprint) => (
          <SelectItem key={sprint.id} value={`sprint-${sprint.id}`}>
            Sprint {sprint.number}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}