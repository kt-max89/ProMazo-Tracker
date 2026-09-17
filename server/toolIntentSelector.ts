import OpenAI from "openai";

if (!process.env.OPENAI_API_KEY) {
  console.warn("OPENAI_API_KEY not set - AI features will not work");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

export type ToolIntent = "SEE_TASKS" | "READ_DOCS" | "SEE_PROJECTS" | "SEE_TEAM" | "NO_TOOL";
export type ReadToolIntent = Exclude<ToolIntent, "NO_TOOL"> | "SEE_TEAM";

export type SeeTasksArgs = {
  query?: string;
  status?: "not_started" | "in_progress" | "needs_review" | "done";
  isBlocked?: boolean;
  person?: string;
  project?: string;
  milestone?: string;
  sprintNumber?: number;
  currentSprint?: boolean;
  mode?: "summary" | "matching_tasks";
  limit?: number;
};

export type ReadDocsArgs = {
  query: string;
  limit?: number;
};

export type SeeProjectsArgs = {
  projectId?: number;
  query?: string;
  limit?: number;
};

export type SeeTeamArgs = {
  include?: Array<"people" | "updates" | "reflections" | "sprint">;
  person?: string;
  query?: string;
  sprintNumber?: number;
  currentSprint?: boolean;
  limit?: number;
};

export type ToolCall =
  | { intent: "SEE_TASKS"; args: SeeTasksArgs }
  | { intent: "READ_DOCS"; args: ReadDocsArgs }
  | { intent: "SEE_PROJECTS"; args: SeeProjectsArgs }
  | { intent: "SEE_TEAM"; args: SeeTeamArgs };

const TOOL_DEFINITIONS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "see_tasks",
      description:
        "Query the live task tracker database. Use this for operational questions about task status, blockers, assignments, counts, or anything about what the team is working on.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["not_started", "in_progress", "needs_review", "done"],
            description: "Filter tasks by a specific status",
          },
          isBlocked: {
            type: "boolean",
            description: "Filter by blocked state. Use true for blocked tasks and false for unblocked tasks.",
          },
          person: {
            type: "string",
            description: "Person display name to match against task assignees",
          },
          project: {
            type: "string",
            description: "Project name to match",
          },
          milestone: {
            type: "string",
            description: "Milestone name to match",
          },
          sprintNumber: {
            type: "number",
            description: "Exact numeric sprint number to match",
          },
          currentSprint: {
            type: "boolean",
            description: "Set true to restrict results to the tracker-wide current sprint",
          },
          query: {
            type: "string",
            description: "Free-text search against task titles and descriptions",
          },
          mode: {
            type: "string",
            enum: ["summary", "matching_tasks"],
            description:
              "summary: return status counts only. matching_tasks: return filtered task list.",
          },
          limit: {
            type: "number",
            description: "Max number of tasks to return. Between 1 and 20. Default 10.",
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_docs",
      description:
        "Permission-aware semantic search over accessible internal documents. Use only for questions about what was said, written, decided, or documented. Returns up to 10 supporting passages with citations.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query to find relevant document passages",
          },
          limit: {
            type: "number",
            description: "Max number of document chunks to return. Default 5.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "see_projects",
      description:
        "Query live project and milestone data with concise live task counts. Use for project descriptions, timelines, milestones, or project-level status. Returns at most 10 projects in chat.",
      parameters: {
        type: "object",
        properties: {
          projectId: {
            type: "number",
            description: "Filter to a specific project by its numeric ID",
          },
          query: {
            type: "string",
            description: "Free-text search against project names and descriptions",
          },
          limit: {
            type: "number",
            description: "Maximum projects to return, between 1 and 10. Default 10.",
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "see_team",
      description:
        "Read authenticated live team context: team roster, recent Team Overview updates, sprint reflections, and current sprint. This tool is read-only. Use it for questions about people, team updates, retrospectives, reflections, or current sprint context.",
      parameters: {
        type: "object",
        properties: {
          include: {
            type: "array",
            items: { type: "string", enum: ["people", "updates", "reflections", "sprint"] },
            description: "Sections needed for the answer. Include only relevant sections.",
          },
          person: {
            type: "string",
            description: "Filter people, updates, or reflections by a person's display name",
          },
          query: {
            type: "string",
            description: "Text filter for Team Overview updates and reflection content",
          },
          sprintNumber: {
            type: "number",
            description: "Filter reflections to an exact sprint number",
          },
          currentSprint: {
            type: "boolean",
            description: "Set true to include current sprint and restrict reflections to it",
          },
          limit: {
            type: "number",
            description: "Maximum updates or reflections per section, between 1 and 10. Default 5.",
          },
        },
        required: ["include"],
        additionalProperties: false,
      },
    },
  },
];

const INTENT_SYSTEM_PROMPT = `You route read-only data lookups for a project-management and team-support assistant.

Rules:
- Call see_projects for questions about what projects exist, project descriptions, timelines, milestones in a project, or anything project/milestone-level.
- Call see_tasks for questions about task status, blockers, in-progress work, assignments, counts, or specific tasks on the task board.
- Call read_docs for questions about standup notes, meeting logs, goals documents, or anything that was written/documented.
- Call see_team for questions about people, Team Overview updates, sprint reflections, retrospectives, or the current sprint.
- Use recent conversation turns to resolve follow-ups and pronouns.
- Call multiple tools when the answer genuinely requires multiple live sources. Never call the same tool twice.
- Use no more than three tools. All available tools are read-only.
- If the question is conversational, general, or doesn't need data, call NO tool.
- Do not search documents unless the user asks about written or documented information.`;

export type RouterHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

const MAX_ROUTER_HISTORY_MESSAGES = 8;
const MAX_ROUTER_HISTORY_CHARS = 3000;
const MAX_TOOL_CALLS = 3;

export function buildRouterMessages(
  message: string,
  history: RouterHistoryMessage[] = [],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  let recent = history.slice(-MAX_ROUTER_HISTORY_MESSAGES);
  let chars = recent.reduce((sum, turn) => sum + turn.content.length, 0);
  while (recent.length > 0 && chars > MAX_ROUTER_HISTORY_CHARS) {
    chars -= recent[0].content.length;
    recent = recent.slice(1);
  }

  return [
    { role: "system", content: INTENT_SYSTEM_PROMPT },
    ...recent.map(turn => ({ role: turn.role, content: turn.content }) as const),
    { role: "user", content: message },
  ];
}

export async function selectToolIntents(
  message: string,
  history: RouterHistoryMessage[] = [],
): Promise<ToolCall[]> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    stream: false,
    tool_choice: "auto",
    tools: TOOL_DEFINITIONS,
    messages: buildRouterMessages(message, history),
  });

  const rawCalls = response.choices[0]?.message?.tool_calls ?? [];
  return normalizeToolCalls(
    rawCalls
      .filter(call => call.type === "function")
      .map(call => ({
        name: call.function.name,
        arguments: call.function.arguments,
      })),
    message,
  );
}

export function normalizeToolCalls(
  rawCalls: Array<{ name: string; arguments: string }>,
  message: string,
): ToolCall[] {
  const calls: ToolCall[] = [];
  const seen = new Set<string>();

  for (const rawCall of rawCalls) {
    if (calls.length >= MAX_TOOL_CALLS || seen.has(rawCall.name)) continue;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(rawCall.arguments);
    } catch {
      parsed = {};
    }

    let normalized: ToolCall | undefined;
    if (rawCall.name === "see_tasks") {
    const rawLimit = typeof parsed.limit === "number" ? parsed.limit : 10;
      normalized = {
      intent: "SEE_TASKS",
      args: {
        query: typeof parsed.query === "string" ? parsed.query : undefined,
        status: isValidStatus(parsed.status) ? parsed.status : undefined,
        isBlocked: typeof parsed.isBlocked === "boolean" ? parsed.isBlocked : undefined,
          person: cleanString(parsed.person),
          project: cleanString(parsed.project),
          milestone: cleanString(parsed.milestone),
          sprintNumber: positiveInteger(parsed.sprintNumber),
          currentSprint: parsed.currentSprint === true ? true : undefined,
        mode: parsed.mode === "summary" || parsed.mode === "matching_tasks" ? parsed.mode : "matching_tasks",
        limit: Math.min(Math.max(1, Math.round(rawLimit)), 20),
      },
    };
    } else if (rawCall.name === "read_docs") {
    const rawLimit = typeof parsed.limit === "number" ? parsed.limit : 5;
      normalized = {
      intent: "READ_DOCS",
      args: {
        query: typeof parsed.query === "string" ? parsed.query : message,
        limit: Math.min(Math.max(1, Math.round(rawLimit)), 10),
      },
    };
    } else if (rawCall.name === "see_projects") {
      const rawLimit = typeof parsed.limit === "number" ? parsed.limit : 10;
      normalized = {
      intent: "SEE_PROJECTS",
      args: {
          projectId: positiveInteger(parsed.projectId),
          query: cleanString(parsed.query),
          limit: Math.min(Math.max(1, Math.round(rawLimit)), 10),
      },
    };
    } else if (rawCall.name === "see_team") {
      const allowed = new Set(["people", "updates", "reflections", "sprint"]);
      const include = Array.isArray(parsed.include)
        ? parsed.include.filter((value): value is NonNullable<SeeTeamArgs["include"]>[number] =>
            typeof value === "string" && allowed.has(value))
        : [];
      const rawLimit = typeof parsed.limit === "number" ? parsed.limit : 5;
      normalized = {
        intent: "SEE_TEAM",
        args: {
          include: include.length > 0 ? Array.from(new Set(include)) : ["people"],
          person: cleanString(parsed.person),
          query: cleanString(parsed.query),
          sprintNumber: positiveInteger(parsed.sprintNumber),
          currentSprint: parsed.currentSprint === true ? true : undefined,
          limit: Math.min(Math.max(1, Math.round(rawLimit)), 10),
        },
      };
    }

    if (normalized) {
      seen.add(rawCall.name);
      calls.push(normalized);
    }
  }

  return calls;
}

function isValidStatus(val: unknown): val is "not_started" | "in_progress" | "needs_review" | "done" {
  return (
    val === "not_started" ||
    val === "in_progress" ||
    val === "needs_review" ||
    val === "done"
  );
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : undefined;
}
