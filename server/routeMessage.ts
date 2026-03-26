export type ChatRoute = "TASKS_ONLY" | "DOCS_ONLY" | "BOTH" | "NEITHER";

const TASK_PATTERNS = [
  /\bblocked\b/i,
  /\bin[- ]progress\b/i,
  /\bnot[- ]started\b/i,
  /\bopen tasks?\b/i,
  /\bbacklog\b/i,
  /\bwhat tasks?\b/i,
  /\bshow.*tasks?\b/i,
  /\blist.*tasks?\b/i,
  /\btask board\b/i,
  /\bmark.*done\b/i,
  /\bmark.*complete\b/i,
  /\barchive\b/i,
  /\bcreate.*task\b/i,
  /\badd.*task\b/i,
  /\bnew task\b/i,
  /\bassign(ed)?\b/i,
  /\bstatus\b/i,
  /\bwhat'?s.*done\b/i,
  /\bwhat is done\b/i,
  /\bwhat('?s| is) (open|blocked|in progress)\b/i,
  /\btask tracker\b/i,
  /\bour tasks?\b/i,
  /\bany tasks?\b/i,
  /\bhow many tasks?\b/i,
];

const DOC_PATTERNS = [
  /\bstandup\b/i,
  /\bstand[- ]up (notes?|logs?|meeting)\b/i,
  /\bnotes?\s+(say|said|mention|show|indicate)\b/i,
  /\bthe notes?\b/i,
  /\bmeeting notes?\b/i,
  /\blogs?\s+(say|said|show|mention|indicate)\b/i,
  /\bthe logs?\b/i,
  /\bgoals?\s+doc(ument)?\b/i,
  /\bsummariz(e|ing) the\b/i,
  /\bwhat did the\b/i,
  /\bwhat was mentioned\b/i,
  /\bbased on the (notes?|logs?|standup|doc(ument)?s?)\b/i,
  /\bretrieve.*context\b/i,
  /\bfrom the (notes?|logs?|standup|doc(ument)?s?)\b/i,
  /\bin the (notes?|logs?|standup|doc(ument)?s?)\b/i,
  /\baccording to the (notes?|logs?|standup|doc(ument)?s?)\b/i,
  /\bweekly (notes?|update|summary)\b/i,
  /\bmentioned in\b/i,
];

export function routeMessage(message: string): ChatRoute {
  const hasTask = TASK_PATTERNS.some((p) => p.test(message));
  const hasDoc = DOC_PATTERNS.some((p) => p.test(message));

  if (hasTask && hasDoc) return "BOTH";
  if (hasTask) return "TASKS_ONLY";
  if (hasDoc) return "DOCS_ONLY";
  return "NEITHER";
}
