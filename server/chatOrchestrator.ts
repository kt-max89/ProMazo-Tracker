import OpenAI from "openai";
import { selectToolIntent } from "./toolIntentSelector";
import { runSeeTasksTool } from "./seeTasksTool";
import { runReadDocsTool } from "./readDocsTool";
import { buildPrompt, type ToolResult } from "./promptBuilder";
import type { DocChunk } from "./documentRetrievalService";
import type { IStorage } from "./storage";
import type { User } from "@shared/schema";

if (!process.env.OPENAI_API_KEY) {
  console.warn("OPENAI_API_KEY not set - AI features will not work");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

export type OrchestratorInput = {
  message: string;
  user: User;
  storage: IStorage;
  sessionId?: number | null;
};

export type OrchestratorYield =
  | { type: "route"; data: string }
  | { type: "citations"; data: DocChunk[] }
  | { type: "token"; data: string }
  | { type: "done" }
  | { type: "error"; data: string };

export async function* handleChatMessage(
  input: OrchestratorInput
): AsyncGenerator<OrchestratorYield> {
  const { message, user, storage, sessionId } = input;

  // Step 1: one LLM call to select intent — SEE_TASKS, READ_DOCS, or NO_TOOL
  const intentResult = await selectToolIntent(message);
  yield { type: "route", data: intentResult.intent };

  let toolResult: ToolResult | undefined;
  let docChunks: DocChunk[] = [];

  // Step 2: call exactly one tool once, or skip entirely — enforced structurally
  if (intentResult.intent === "SEE_TASKS") {
    const result = await runSeeTasksTool(intentResult.args);
    toolResult = {
      type: "tasks",
      content: result.content,
      isEmpty: result.isEmpty,
      suggestRetry: result.suggestRetry,
    };
  } else if (intentResult.intent === "READ_DOCS") {
    const result = await runReadDocsTool(intentResult.args, user);
    docChunks = result.chunks;
    toolResult = {
      type: "docs",
      content: result.contextText,
      isEmpty: result.isEmpty,
      suggestRetry: result.suggestRetry,
    };
  }
  // NO_TOOL: toolResult stays undefined, no retrieval runs

  // Emit citations (empty array for task/no-tool paths)
  yield { type: "citations", data: docChunks };

  // Persist doc citations to DB
  if (docChunks.length > 0) {
    for (const chunk of docChunks) {
      await storage.createCitation({
        userId: user.id,
        documentId: chunk.documentId,
        chunkId: chunk.chunkId,
        query: message.slice(0, 500),
        createdAt: new Date().toISOString(),
      });
    }
  }

  // Step 3: build final prompt and stream answer
  // No tools are passed to this call — the model structurally cannot call another tool
  const messages = buildPrompt({ message, toolResult });

  const stream = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    stream: true,
    messages,
    // tools intentionally omitted — enforces one-tool-call-per-turn at the API level
  });

  let fullAnswer = "";
  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content;
    if (token) {
      fullAnswer += token;
      yield { type: "token", data: token };
    }
  }

  if (sessionId) {
    await storage.addChatMessage({
      sessionId,
      role: "assistant",
      content: fullAnswer,
    });
  }

  yield { type: "done" };

  /*
   * FUTURE: Proposed task actions
   *
   * A future iteration may return structured proposals from the LLM
   * for task mutations. These would be emitted as a separate "proposal"
   * SSE event and only executed after explicit user confirmation in the UI.
   *
   * Planned proposal types (write-only, user-approval required):
   *   - create_task:        { title, description, status, assignedTo }
   *   - update_task_status: { taskId, newStatus, blockedReason? }
   *   - archive_task:       { taskId }
   *
   * All writes must go through taskService.ts. No direct DB access from chat.
   * No autonomous execution. The hook point is here, after fullAnswer is built.
   */
}
