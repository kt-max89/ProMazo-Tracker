import OpenAI from "openai";

if (!process.env.OPENAI_API_KEY) {
  console.warn("OPENAI_API_KEY not set - AI features will not work");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

export type ToolIntent = "SEE_TASKS" | "READ_DOCS" | "SEE_PROJECTS" | "NO_TOOL";

export type SeeTasksArgs = {
  query?: string;
  status?: "not_started" | "in_progress" | "needs_review" | "done";
  isBlocked?: boolean;
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
};

export type IntentResult =
  | { intent: "SEE_TASKS"; args: SeeTasksArgs }
  | { intent: "READ_DOCS"; args: ReadDocsArgs }
  | { intent: "SEE_PROJECTS"; args: SeeProjectsArgs }
  | { intent: "NO_TOOL"; args: Record<string, never> };

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
            description: "Filter to only tasks currently flagged as blocked",
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
        "Search internal documents including standup logs, meeting notes, and goals documents using semantic search. Use this for questions about what was said, written, or documented.",
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
        "Query live project and milestone data. Use this for questions about what projects exist, project details, milestones within a project, or project timelines and descriptions.",
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
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
];

const INTENT_SYSTEM_PROMPT = `You are an intent router for the ProMazo Task Tracker assistant. Your only job is to decide whether to call one tool or none.

Rules:
- Call see_projects for questions about what projects exist, project descriptions, timelines, milestones in a project, or anything project/milestone-level.
- Call see_tasks for questions about task status, blockers, in-progress work, assignments, counts, or specific tasks on the task board.
- Call read_docs for questions about standup notes, meeting logs, goals documents, or anything that was written/documented.
- If both tools could help, pick the single best one for this specific question.
- If the question is conversational, general, or doesn't need data, call NO tool.
- Never call both tools. Call at most one.`;

export async function selectToolIntent(message: string): Promise<IntentResult> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    stream: false,
    tool_choice: "auto",
    tools: TOOL_DEFINITIONS,
    messages: [
      { role: "system", content: INTENT_SYSTEM_PROMPT },
      { role: "user", content: message },
    ],
  });

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];

  if (!toolCall) {
    return { intent: "NO_TOOL", args: {} };
  }

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(toolCall.function.arguments);
  } catch {
    parsed = {};
  }

  if (toolCall.function.name === "see_tasks") {
    const rawLimit = typeof parsed.limit === "number" ? parsed.limit : 10;
    return {
      intent: "SEE_TASKS",
      args: {
        query: typeof parsed.query === "string" ? parsed.query : undefined,
        status: isValidStatus(parsed.status) ? parsed.status : undefined,
        isBlocked: typeof parsed.isBlocked === "boolean" ? parsed.isBlocked : undefined,
        mode: parsed.mode === "summary" || parsed.mode === "matching_tasks" ? parsed.mode : "matching_tasks",
        limit: Math.min(Math.max(1, Math.round(rawLimit)), 20),
      },
    };
  }

  if (toolCall.function.name === "read_docs") {
    const rawLimit = typeof parsed.limit === "number" ? parsed.limit : 5;
    return {
      intent: "READ_DOCS",
      args: {
        query: typeof parsed.query === "string" ? parsed.query : message,
        limit: Math.min(Math.max(1, Math.round(rawLimit)), 10),
      },
    };
  }

  if (toolCall.function.name === "see_projects") {
    return {
      intent: "SEE_PROJECTS",
      args: {
        projectId: typeof parsed.projectId === "number" ? parsed.projectId : undefined,
        query: typeof parsed.query === "string" ? parsed.query : undefined,
      },
    };
  }

  return { intent: "NO_TOOL", args: {} };
}

function isValidStatus(val: unknown): val is "not_started" | "in_progress" | "needs_review" | "done" {
  return (
    val === "not_started" ||
    val === "in_progress" ||
    val === "needs_review" ||
    val === "done"
  );
}
