import OpenAI from "openai";
import { selectToolIntent } from "./toolIntentSelector";
import { runSeeTasksTool } from "./seeTasksTool";
import { runReadDocsTool } from "./readDocsTool";
import { buildPrompt, type ToolResult } from "./promptBuilder";
import { validateProposal, type ValidatedProposal } from "./proposalSchema";
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
  | { type: "task_proposal"; data: ValidatedProposal }
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

  // Step 3: build final prompt and call the model.
  // Uses response_format: json_object so the model can include an optional
  // structured proposal sidecar in a single call — no second LLM call needed.
  // Tools are intentionally omitted — the model structurally cannot call another tool.
  const messages = buildPrompt({ message, toolResult });

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    stream: false,
    messages,
    response_format: { type: "json_object" },
  });

  const rawContent = response.choices[0]?.message?.content ?? "";

  // Parse the JSON response — graceful degradation on failure
  let answerText = rawContent;
  let proposal: ValidatedProposal | null = null;

  try {
    const parsed = JSON.parse(rawContent);
    if (typeof parsed.answer === "string" && parsed.answer.trim()) {
      answerText = parsed.answer.trim();
      // Only attempt proposal parsing if answer succeeded
      if (parsed.proposal !== undefined) {
        proposal = validateProposal(parsed.proposal);
      }
    }
    // If answer key is missing/invalid, fall through to use rawContent as-is
  } catch {
    // JSON parse failed — use raw content as plain text, no proposal
  }

  // Emit the full answer as a single token (equivalent to streaming for MVP)
  yield { type: "token", data: answerText };

  if (sessionId) {
    await storage.addChatMessage({
      sessionId,
      role: "assistant",
      content: answerText,
    });
  }

  yield { type: "done" };

  // Emit proposal event after done — only if validation passed
  // No tasks are created here. This is proposal-only. Writes require user approval.
  if (proposal) {
    yield { type: "task_proposal", data: proposal };
  }
}
