import type { SprintReflection } from "@shared/schema";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function preview(value: string, length = 90): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > length ? `${compact.slice(0, length - 1)}…` : compact;
}

export function ReflectionsTable({
  reflections,
  onSelect,
}: {
  reflections: SprintReflection[];
  onSelect: (reflection: SprintReflection) => void;
}) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Person</TableHead>
            <TableHead>Sprint</TableHead>
            <TableHead>Summary</TableHead>
            <TableHead>Impact</TableHead>
            <TableHead>Submitted</TableHead>
            <TableHead className="w-16"><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reflections.map(reflection => (
            <TableRow
              key={reflection.id}
              data-testid={`row-reflection-${reflection.id}`}
            >
              <TableCell className="font-medium whitespace-nowrap">{reflection.authorName}</TableCell>
              <TableCell className="whitespace-nowrap">Sprint {reflection.sprintNumber}</TableCell>
              <TableCell className="max-w-[18rem] truncate" title={reflection.summary}>
                {preview(reflection.summary)}
              </TableCell>
              <TableCell className="max-w-[18rem] truncate" title={reflection.impact}>
                {preview(reflection.impact)}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {new Date(reflection.createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onSelect(reflection)}
                  aria-label={`View ${reflection.authorName}'s Sprint ${reflection.sprintNumber} reflection`}
                  title="View full reflection"
                >
                  <Eye className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}