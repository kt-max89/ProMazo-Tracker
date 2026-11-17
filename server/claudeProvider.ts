// Server-only Anthropic Messages API. No credentials or provider response bodies
// are logged or exposed to clients. No fallback provider is permitted.
export const CHAT_MODEL = "claude-sonnet-4-6";
export type ClaudeBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export type ClaudeMessage = { role: "user" | "assistant"; content: string | ClaudeBlock[] };
export type ClaudeRequest = {
  system: string;
  messages: ClaudeMessage[];
  tools?: Array<{ name: string; description: string; input_schema: object }>;
  tool_choice?: { type: "auto" | "none" };
};
export type ClaudeResponse = { content: ClaudeBlock[]; stop_reason?: string };
export type ClaudeProvider = (request: ClaudeRequest) => Promise<ClaudeResponse>;

export class ChatConfigurationError extends Error {}

// Native constrained JSON output, not a prompt-only request or permissive
// extraction from prose/fences. Application validation still runs afterward.
export const CHAT_OUTPUT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["answer"],
  properties: {
    answer: { type: "string" },
    proposal: {
      type: "object", additionalProperties: false, required: ["type", "tasks"],
      properties: {
        type: { type: "string", enum: ["create_task"] },
        tasks: {
          type: "array",
          items: {
            type: "object", additionalProperties: false, required: ["title"],
            properties: {
              title: { type: "string" }, description: { type: "string" },
              assignedToName: { type: "string" }, projectName: { type: "string" },
              milestoneName: { type: "string" }, dueDate: { type: "string" },
              size: { type: "string", enum: ["XXS", "XS", "S", "M", "L", "XL", "XXL"] },
              sprintId: { type: ["integer", "null"] },
            },
          },
        },
      },
    },
  },
};

export const callClaude: ClaudeProvider = async request => {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ChatConfigurationError("Chat is not configured: add ANTHROPIC_API_KEY in server Secrets to enable Claude Sonnet.");
  }
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CHAT_MODEL, max_tokens: 4096, ...request,
      output_config: { format: { type: "json_schema", schema: CHAT_OUTPUT_SCHEMA } },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Chat provider request failed (${response.status})`);
  const data = await response.json();
  if (!Array.isArray(data.content)) throw new Error("Invalid chat provider response");
  return data as ClaudeResponse;
};
