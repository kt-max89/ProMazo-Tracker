import { Clock, AlertCircle, Flag, CheckCircle2 } from "lucide-react";

export const STATUSES = [
  {
    value: "not_started",
    label: "Not started",
    icon: Clock,
    badgeColor: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    columnBg: "bg-slate-50 dark:bg-slate-900/30",
    columnBorder: "border-slate-200 dark:border-slate-800",
    headerColor: "text-slate-600 dark:text-slate-400",
  },
  {
    value: "in_progress",
    label: "In progress",
    icon: AlertCircle,
    badgeColor: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    columnBg: "bg-blue-50 dark:bg-blue-950/30",
    columnBorder: "border-blue-200 dark:border-blue-900",
    headerColor: "text-blue-700 dark:text-blue-400",
  },
  {
    value: "needs_review",
    label: "Needs review",
    icon: Flag,
    badgeColor: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    columnBg: "bg-green-50 dark:bg-green-950/30",
    columnBorder: "border-green-200 dark:border-green-900",
    headerColor: "text-green-700 dark:text-green-400",
  },
  {
    value: "done",
    label: "Done",
    icon: CheckCircle2,
    badgeColor: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
    columnBg: "bg-purple-50 dark:bg-purple-950/30",
    columnBorder: "border-purple-200 dark:border-purple-900",
    headerColor: "text-purple-700 dark:text-purple-400",
  },
] as const;

export type StatusValue = (typeof STATUSES)[number]["value"];

export function statusMeta(value: string) {
  return STATUSES.find(s => s.value === value) ?? STATUSES[0];
}
