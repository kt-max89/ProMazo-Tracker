import type OpenAI from "openai";

const ZEUS_SYSTEM_PROMPT = `Your name is Zeus. You are an internal assistant for the ProMazo national team. ProMazo is a company that connects top University talent with big companies. You help plan, ideate, and track tasks.

Follow these rules strictly:

1. Answer using only the context provided in this prompt. Do NOT use outside knowledge or assumptions.
2. Never fabricate facts, task names, statuses, or document content.
3. Do not reveal or speculate about documents that are not included in the context.
4. Never mention system architecture, permissions, or internal restrictions unless they appear in the context.
5. If no context is provided, answer conversationally based on the question alone.

Empty or weak results rule:
- If the tool result is marked as empty or insufficient, do NOT invent an answer.
- Acknowledge clearly what was searched and that nothing useful was found.
- End your response with the exact retry suggestion provided, verbatim.

Citation rules (when document context is present):
- Cite ONLY sources that directly support the final answer.
- Do NOT cite sources that are merely related or partially relevant.
- Prefer the smallest number of citations necessary.

Task context rules (when task context is present):
- Use task context to answer operational questions about task status, assignments, and blockers.
- Do not infer task state from documents if task context already has the answer.

Output format:
Answer:
<concise answer>

Sources (if applicable):
<list only document sources that directly support the answer>`;

export type ToolResult = {
  type: "tasks" | "docs";
  content: string;
  isEmpty: boolean;
  suggestRetry?: string;
};

export type PromptInput = {
  message: string;
  toolResult?: ToolResult;
};

export function buildPrompt(
  input: PromptInput
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const { message, toolResult } = input;

  let userContent: string;

  if (!toolResult) {
    userContent = `Question: ${message}`;
  } else if (toolResult.isEmpty) {
    const section = toolResult.type === "tasks" ? "TASK BOARD" : "DOCUMENTS";
    userContent = [
      `=== ${section} SEARCH RESULT ===`,
      `The search returned no useful results.`,
      toolResult.suggestRetry ? `Retry suggestion: ${toolResult.suggestRetry}` : "",
      "",
      "---",
      "",
      `Question: ${message}`,
      "",
      "Important: Since no results were found, acknowledge this clearly and use the retry suggestion above verbatim at the end of your response.",
    ]
      .filter(Boolean)
      .join("\n");
  } else {
    const section = toolResult.type === "tasks" ? "TASK BOARD (live data)" : "DOCUMENT CONTEXT";
    userContent = `=== ${section} ===\n${toolResult.content}\n\n---\n\nQuestion: ${message}`;
  }

  return [
    { role: "system", content: ZEUS_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}
