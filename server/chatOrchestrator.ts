import OpenAI from "openai";
import { selectToolIntents, type ToolCall } from "./toolIntentSelector";
import { runSeeTasksTool } from "./seeTasksTool";
import { runReadDocsTool } from "./readDocsTool";
import { runSeeProjectsTool } from "./seeProjectsTool";
import { runSeeTeamTool } from "./seeTeamTool";
import { buildPrompt, type ToolResult, type HistoryMessage } from "./promptBuilder";
import { getAgentInstructions } from "./agentInstructionsService";
import { validateProposal, type ValidatedProposal } from "./proposalSchema";
import type { DocChunk } from "./documentRetrievalService";
import type { IStorage } from "./storage";
import type { User } from "@shared/schema";
import { settleReadToolCalls } from "./readToolExecution";
import { isFirstChatTurn, loadTeamSprintContext, runProjectKnowledgeTool } from "./projectKnowledgeTool";
import { prepareTaskEdit, buildTaskEditProposal, type TaskEditContext } from "./taskEditService";
import type { TaskEditProposal } from "@shared/taskEdits";
import { runLookupLoop } from "./chatLookupLoop";
import type { ClaudeMessage } from "./claudeProvider";
import { groundCreationReferences } from "./creationGrounding";
import { listProjects } from "./projectService";
import { listMilestones } from "./milestoneService";

if (!process.env.OPENAI_API_KEY) {
  console.warn("OPENAI_API_KEY not set - AI features will not work");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

// Context budget for session history included in the prompt. Older turns
// beyond these limits are collapsed into a short summary instead of dropped
// silently, so long sessions can't blow up prompt size/cost.
const MAX_HISTORY_MESSAGES = 20;
const MAX_HISTORY_CHARS = 6000;
const MAX_SUMMARY_CHARS = 800;

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
  | { type: "task_edit_proposal"; data: TaskEditProposal }
  | { type: "done" }
  | { type: "error"; data: string };

export async function* handleChatMessage(
  input: OrchestratorInput
): AsyncGenerator<OrchestratorYield> {
  const { message, user, storage, sessionId } = input;

  // Step 0: load recent session history (if any) and bound it to a sane
  // context budget. Messages beyond the budget are collapsed into a short
  // summary rather than dropped silently.
  let history: HistoryMessage[] = [];
  let historySummary: string | undefined;
  let firstTurn = true;

  if (sessionId) {
    const allMessages = await storage.getChatMessagesBySessionId(sessionId);
    // The current user message was already persisted by the route handler
    // before this generator was invoked, so it is the last row — exclude it
    // here since it's added explicitly by buildPrompt via `message`.
    const priorMessages = allMessages.slice(0, -1);
    firstTurn = isFirstChatTurn(priorMessages);

    let selected = priorMessages.slice(-MAX_HISTORY_MESSAGES);
    let totalChars = selected.reduce((sum, m) => sum + m.content.length, 0);
    while (selected.length > 0 && totalChars > MAX_HISTORY_CHARS) {
      totalChars -= selected[0].content.length;
      selected = selected.slice(1);
    }

    const droppedCount = priorMessages.length - selected.length;
    if (droppedCount > 0) {
      const dropped = priorMessages.slice(0, droppedCount);
      const summaryText = dropped.map((m) => `${m.role}: ${m.content}`).join(" | ");
      const truncated = summaryText.slice(0, MAX_SUMMARY_CHARS);
      historySummary = `${truncated}${summaryText.length > MAX_SUMMARY_CHARS ? "..." : ""}`;
    }

    history = selected.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  }

  // Step 1: isolate existing-task edit requests. All other lookup choices are
  // made by the answer assistant inside the bounded read-only loop.
  // Membership, selected sprint, and saved plans are refreshed for every turn,
  // including the first question, before the router sees the user's request.
  let teamSprintContext: string;
  try {
    const currentUser = await storage.getUser(user.id);
    teamSprintContext = currentUser
      ? await loadTeamSprintContext(currentUser, firstTurn)
      : "Automatic team context unavailable: authenticated user's account could not be loaded.";
  } catch {
    teamSprintContext = "Automatic team context unavailable: membership lookup failed. This does not mean that no plans exist.";
  }
  // Read for every request, including existing conversations. Do not silently
  // revert to defaults if the persisted policy cannot be loaded.
  let mainAgentInstructions: string;
  try {
    mainAgentInstructions = (await getAgentInstructions()).instructions;
  } catch {
    yield { type: "error", data: "Chat instructions could not be loaded. Please try again." };
    return;
  }
  let toolCalls: ToolCall[];
  try {
    toolCalls = (await selectToolIntents(message, history, teamSprintContext))
      .filter(call => call.intent === "PREPARE_TASK_EDIT");
  } catch {
    yield { type: "error", data: "Chat could not check whether this is an edit request. Please try again. No task changes were saved." };
    return;
  }
  for (const call of toolCalls) yield { type: "route", data: call.intent };

  const toolResults: ToolResult[] = [];
  let editContext: TaskEditContext | undefined;
  yield { type: "route", data: "TEAM_SPRINT_PLANS" };
  let docChunks: DocChunk[] = [];

  // Step 2: execute independent reads concurrently. A rejected source becomes a
  // typed partial result instead of erasing successful sources.
  const settled = await settleReadToolCalls(toolCalls, call =>
    executeReadTool(call, user, storage),
  );
  for (const outcome of settled) {
    if (outcome.status === "rejected") {
      toolResults.push({
        type: resultTypeForIntent(outcome.call.intent),
        content: "",
        isEmpty: true,
        error: outcome.error,
      });
      continue;
    }
    toolResults.push(outcome.value.toolResult);
    if (outcome.call.intent === "PREPARE_TASK_EDIT") editContext = outcome.value.editContext;
    docChunks.push(...outcome.value.docChunks);
  }

  // Step 3: build protected context for the isolated edit model or read loop.
  // Proactively load projects + milestones so the agent can always populate
  // projectName/milestoneName in proposals without needing a separate tool call.
  let projectsContext: string | undefined;
  try {
    const { runSeeProjectsTool: _seeProjects } = await import("./seeProjectsTool");
    const projResult = await _seeProjects({});
    if (!projResult.isEmpty) {
      projectsContext = projResult.content.slice(0, 12000);
    }
  } catch {
    // Best-effort: if fetching projects fails, the agent just won't have the context
  }

  // Compute tomorrow's date (YYYY-MM-DD) in UTC
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowDate = tomorrow.toISOString().slice(0, 10);

  // Edit mode retains its no-tools JSON generation. Read/create mode receives
  // the same policy/history/default context, then adds native lookup results.
  const messages = buildPrompt({
    message,
    toolResults,
    history,
    historySummary,
    projectsContext,
    teamSprintContext,
    currentUserName: user.displayName,
    currentUserRole: user.role,
    tomorrowDate,
    mainAgentInstructions,
  });

  let rawContent: string;
  if (toolCalls.some(call => call.intent === "PREPARE_TASK_EDIT")) {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", stream: false, messages,
      response_format: { type: "json_object" },
    });
    rawContent = response.choices[0]?.message?.content ?? "";
  } else {
    const system = messages.filter(turn => turn.role === "system").map(turn => String(turn.content)).join("\n\n");
    const conversation: ClaudeMessage[] = messages.filter(turn => turn.role === "user" || turn.role === "assistant")
      .map(turn => ({ role: turn.role as "user" | "assistant", content: String(turn.content) }));
    rawContent = JSON.stringify({ answer: "Chat could not finish. Please try again." });
    for await (const event of runLookupLoop({
      system, messages: conversation,
      execute: call => executeReadTool(call, user, storage),
    })) {
      if (event.type === "route") yield event;
      else {
        const { answer, proposal, docChunks: retrieved } = event.data;
        docChunks = retrieved;
        if (proposal) {
          try {
            const [projects, milestones, users] = await Promise.all([
              listProjects(), listMilestones(), storage.getAllUsers(),
            ]);
            const grounded = groundCreationReferences(proposal, { projects, milestones, users });
            rawContent = JSON.stringify({
              answer: answer + (grounded.warnings.length ? `\n\n${grounded.warnings.join("\n\n")}` : ""),
              proposal: grounded.proposal,
            });
          } catch {
            rawContent = JSON.stringify({ answer: "I couldn't verify the task's references. Please try again. No task changes were saved." });
          }
        } else rawContent = JSON.stringify({ answer });
      }
    }
  }

  yield { type: "citations", data: docChunks };
  for (const chunk of docChunks) {
    await storage.createCitation({
      userId: user.id, documentId: chunk.documentId, chunkId: chunk.chunkId,
      query: message.slice(0, 500), createdAt: new Date().toISOString(),
    });
  }

  // Parse the JSON response — graceful degradation on failure
  let answerText = rawContent;
  let proposal: ValidatedProposal | null = null;
  let editProposal: TaskEditProposal | null = null;

  try {
    const parsed = JSON.parse(rawContent);
    if (typeof parsed.answer === "string" && parsed.answer.trim()) {
      answerText = parsed.answer.trim();
      // Only attempt proposal parsing if answer succeeded
      if (toolCalls.some(call => call.intent === "PREPARE_TASK_EDIT")) {
        try {
          editProposal = parsed.proposal === undefined
            ? await buildTaskEditProposal(parsed.editProposal, editContext, storage) : null;
          if (!editProposal && parsed.editProposal !== undefined) answerText = editContext?.content && !editContext.task ? editContext.content : "I couldn't validate this edit. Please identify one existing task and the exact changes or references to use.";
          else if (!editProposal && parsed.proposal !== undefined) answerText = "Editing an existing task cannot create a replacement. Please identify one existing task and its changes.";
          else if (editProposal) answerText += `\n\nReview proposed changes to task #${editProposal.taskId} (${editProposal.currentTask.title}).\n\nNothing is saved until you approve task #${editProposal.taskId}.`;
        } catch (error) {
          answerText = error instanceof Error ? error.message : "Could not validate the edit. Please clarify the changes.";
        }
      } else if (parsed.proposal !== undefined && parsed.editProposal === undefined) {
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

    // Step 4: auto-title the session from the first exchange. Only runs
    // while the session still has the default title, so it's a one-time,
    // best-effort operation that never blocks the response on failure.
    const session = await storage.getChatSession(sessionId);
    if (session && session.title === "New Chat") {
      try {
        const titleResponse = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "Generate a short, plain-text chat title (3-6 words) summarizing the exchange below. Respond with only the title — no quotes, no punctuation at the end.",
            },
            { role: "user", content: `User: ${message}\nAssistant: ${answerText}` },
          ],
          max_tokens: 20,
        });
        const title = titleResponse.choices[0]?.message?.content?.trim().replace(/^["']|["']$/g, "");
        if (title) {
          await storage.updateChatSessionTitle(sessionId, title.slice(0, 100));
        }
      } catch {
        // Best-effort; a failed title generation should not break the chat response.
      }
    }
  }

  yield { type: "done" };

  // Emit proposal event after done — only if validation passed
  // No tasks are created here. This is proposal-only. Writes require user approval.
  if (proposal) {
    yield { type: "task_proposal", data: proposal };
  }
  if (editProposal) yield { type: "task_edit_proposal", data: editProposal };
}

type ExecutedReadTool = {
  editContext?: TaskEditContext;
  toolResult: ToolResult;
  docChunks: DocChunk[];
};

async function executeReadTool(
  call: ToolCall,
  user: User,
  storage: IStorage,
): Promise<ExecutedReadTool> {
  if (call.intent === "PREPARE_TASK_EDIT") {
    const context = await prepareTaskEdit(call.args, storage, user.id);
    return { toolResult: { type: "task_edit", content: context.content, isEmpty: false }, docChunks: [], editContext: context };
  }
  if (call.intent === "SEE_TASKS") {
    const result = await runSeeTasksTool(call.args);
    return {
      toolResult: { type: "tasks", content: result.content, isEmpty: result.isEmpty, suggestRetry: result.suggestRetry },
      docChunks: [],
    };
  }
  if (call.intent === "SEE_PROJECTS") {
    const result = await runSeeProjectsTool(call.args);
    return {
      toolResult: { type: "projects", content: result.content, isEmpty: result.isEmpty, suggestRetry: result.suggestRetry },
      docChunks: [],
    };
  }
  if (call.intent === "SEE_TEAM") {
    const result = await runSeeTeamTool(call.args, storage, user);
    return {
      toolResult: { type: "team", content: result.content, isEmpty: result.isEmpty, suggestRetry: result.suggestRetry },
      docChunks: [],
    };
  }

  if (call.intent === "READ_PROJECT_CONTEXT") {
    const result = await runProjectKnowledgeTool(call.args);
    return { toolResult: { type: "plans", ...result }, docChunks: [] };
  }

  const result = await runReadDocsTool(call.args, user);
  return {
    toolResult: { type: "docs", content: result.contextText, isEmpty: result.isEmpty, suggestRetry: result.suggestRetry },
    docChunks: result.chunks,
  };
}

function resultTypeForIntent(intent: ToolCall["intent"]): ToolResult["type"] {
  if (intent === "PREPARE_TASK_EDIT") return "task_edit";
  if (intent === "SEE_TASKS") return "tasks";
  if (intent === "SEE_PROJECTS") return "projects";
  if (intent === "SEE_TEAM") return "team";
  if (intent === "READ_PROJECT_CONTEXT") return "plans";
  return "docs";
}
