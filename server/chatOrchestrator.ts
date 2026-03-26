import OpenAI from "openai";
import { routeMessage } from "./routeMessage";
import { getCompactTaskContext } from "./taskService";
import { retrieveDocumentContext, type DocChunk } from "./documentRetrievalService";
import { buildPrompt } from "./promptBuilder";
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

  const route = routeMessage(message);
  yield { type: "route", data: route };

  let taskContext: string | undefined;
  let docContext: string | undefined;
  let docChunks: DocChunk[] = [];

  if (route === "TASKS_ONLY" || route === "BOTH") {
    taskContext = await getCompactTaskContext(message);
  }

  if (route === "DOCS_ONLY" || route === "BOTH") {
    const result = await retrieveDocumentContext(message, user);
    if (result.chunks.length > 0) {
      docContext = result.contextText;
      docChunks = result.chunks;
    }
  }

  yield { type: "citations", data: docChunks };

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

  const messages = buildPrompt({ message, taskContext, docContext });

  const stream = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    stream: true,
    messages,
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
   * After the LLM answer is generated, a future iteration could inspect
   * the answer (or a structured side-channel) for proposed task mutations.
   * These would be returned to the client as a separate "proposal" event
   * and only executed after explicit user confirmation.
   *
   * Planned proposal types:
   *   - create_task:        { title, description, status, assignedTo }
   *   - update_task_status: { taskId, newStatus, blockedReason? }
   *   - archive_task:       { taskId }
   *
   * All writes must go through taskService.ts functions. No direct DB access
   * from chat. No autonomous execution without a user approval step.
   */
}
