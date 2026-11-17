import { callClaude, ChatConfigurationError, type ClaudeProvider, type ClaudeMessage, type ClaudeBlock } from "./claudeProvider";
import { LOOKUP_RULES, LOOKUP_TOOLS, parseLookup, type LookupCall } from "./lookupTools";
import { validateProposal, type ValidatedProposal } from "./proposalSchema";
import type { DocChunk } from "./documentRetrievalService";
import type { ToolResult } from "./promptBuilder";

export const LOOP_LIMITS = { rounds: 5, callsPerRound: 3, calls: 15, resultChars: 6000, roundChars: 12000 };
export const SAFE_CHAT_ANSWER = "I couldn't produce a validated response. Please try again or clarify your request. No task changes were saved.";
type ReadResult = { toolResult: ToolResult; docChunks: DocChunk[] };
export type LookupYield =
  | { type: "route"; data: string }
  | { type: "result"; data: { answer: string; proposal: ValidatedProposal | null; docChunks: DocChunk[] } };

export function parseLookupFinal(raw: string, boardSearched: boolean) {
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      typeof value.answer !== "string" || !value.answer.trim() || value.answer.length > 24000 ||
      Object.keys(value).some(key => !["answer", "proposal"].includes(key))) throw new Error("Invalid final answer");
  const proposal = value.proposal === undefined ? null : validateProposal(value.proposal);
  if (value.proposal !== undefined && (!proposal || !boardSearched)) throw new Error("Unvalidated draft");
  return { answer: value.answer.trim() as string, proposal };
}

export async function* runLookupLoop(input: {
  system: string;
  messages: ClaudeMessage[];
  execute: (call: LookupCall) => Promise<ReadResult>;
  provider?: ClaudeProvider;
}): AsyncGenerator<LookupYield> {
  const provider = input.provider ?? callClaude;
  const messages = [...input.messages];
  const system = `${input.system}\n\n${LOOKUP_RULES}`;
  const chunks = new Map<number, DocChunk>();
  let boardSearched = false, totalCalls = 0;
  const boardQueries: string[] = [];
  const relatedTasks = new Set<string>();
  const seenIds = new Set<string>();
  try {
    for (let round = 0; round <= LOOP_LIMITS.rounds; round++) {
      const terminal = round === LOOP_LIMITS.rounds || totalCalls >= LOOP_LIMITS.calls;
      const response = await provider({
        system, messages,
        ...(terminal ? { tool_choice: { type: "none" as const } } :
          { tools: LOOKUP_TOOLS, tool_choice: { type: "auto" as const } }),
      });
      const calls = response.content.filter((block): block is Extract<ClaudeBlock, { type: "tool_use" }> => block.type === "tool_use");
      const raw = response.content.filter(block => block.type === "text").map(block => block.text).join("");
      if (calls.length === 0) {
        if (response.stop_reason && response.stop_reason !== "end_turn") throw new Error("Incomplete final response");
        try {
          const final = parseLookupFinal(raw, boardSearched);
          if (final.proposal) {
            // A syntactically valid but unrelated search cannot authorize a draft.
            for (const task of final.proposal.tasks) {
              const topic = `${task.title} ${task.description ?? ""}`.toLowerCase();
              if (!boardQueries.some(query => query.toLowerCase().split(/\W+/).some(word =>
                word.length >= 3 && !/^(the|and|for|task|tasks|create|make|please|new)$/.test(word) && topic.includes(word)))) {
                throw new Error("Draft topic was not searched");
              }
            }
            if (relatedTasks.size) final.answer += `\n\nPotentially related tasks found: ${Array.from(relatedTasks).slice(0, 5).join("; ")}. Review these for possible duplication before approving a new task.`;
          }
          yield { type: "result", data: { ...final, docChunks: Array.from(chunks.values()) } };
          return;
        } catch {
          // Give the assistant a chance to perform its required search before drafting.
          if (!terminal && !boardSearched) {
            try {
              if (JSON.parse(raw).proposal) {
                messages.push({ role: "assistant", content: raw.slice(0, 24000) },
                  { role: "user", content: "Application validation: before any draft, run a relevant see_tasks topic search in matching_tasks mode. Then return validated JSON." });
                continue;
              }
            } catch { /* invalid JSON goes to safe fallback */ }
          }
          throw new Error("Invalid final JSON");
        }
      }
      // Never execute a tool after forced finalization, or accept unpaired IDs.
      if (terminal || calls.length > 20 || calls.some(call => !call.id || seenIds.has(call.id)) ||
          new Set(calls.map(call => call.id)).size !== calls.length) throw new Error("Invalid tool response");
      const results: ClaudeBlock[] = [];
      // Do not replay private reasoning/text. Retain only bounded native tool calls.
      const nativeCalls = calls.map(call => ({ ...call, input: JSON.stringify(call.input).length <= 4000 ? call.input : {} }));
      messages.push({ role: "assistant", content: nativeCalls });
      let roundChars = 0;
      for (let index = 0; index < calls.length; index++) {
        const native = calls[index];
        seenIds.add(native.id);
        let content: string, failed = false;
        try {
          if (index >= LOOP_LIMITS.callsPerRound || totalCalls >= LOOP_LIMITS.calls) throw new Error("Tool call budget exhausted; use available results.");
          totalCalls++;
          const call = parseLookup(native.name, native.input);
          yield { type: "route", data: call.intent };
          const result = await withReadTimeout(input.execute(call));
          // Only successful, relevant matching-task searches satisfy the draft boundary.
          if (call.intent === "SEE_TASKS" && call.args.query?.trim() &&
              call.args.mode === "matching_tasks" && !result.toolResult.error) {
            boardSearched = true;
            boardQueries.push(call.args.query);
            for (const match of Array.from(result.toolResult.content.matchAll(/^- (#\d+) \[[^\]]+\] ([^\n|]+)/gm))) {
              if (relatedTasks.size < 20) relatedTasks.add(`${match[1]} ${match[2].trim().slice(0, 150)}`);
            }
          }
          for (const chunk of result.docChunks) {
            // Stable Source N numbering across repeated document lookups.
            if (!chunks.has(chunk.chunkId) && chunks.size < 30) chunks.set(chunk.chunkId, chunk);
          }
          let source = result.toolResult.content;
          if (call.intent === "READ_DOCS") {
            source = result.docChunks.filter(chunk => chunks.has(chunk.chunkId)).map(chunk =>
              `[Source ${Array.from(chunks.keys()).indexOf(chunk.chunkId) + 1}: ${chunk.documentTitle}]\n${chunk.chunkText}`).join("\n\n");
          }
          content = JSON.stringify({ ...result.toolResult, content: source, untrustedData: true });
          failed = !!result.toolResult.error;
        } catch {
          failed = true;
          content = JSON.stringify({ error: "Lookup unavailable, invalid arguments, or tool budget exhausted. Retry with valid arguments if budget remains.", untrustedData: true });
        }
        const budget = Math.max(0, Math.min(LOOP_LIMITS.resultChars, LOOP_LIMITS.roundChars - roundChars));
        if (content.length > budget) content = content.slice(0, budget) + "\n[Partial result: output budget reached]";
        roundChars += content.length;
        results.push({ type: "tool_result", tool_use_id: native.id, content, ...(failed ? { is_error: true } : {}) });
      }
      messages.push({ role: "user", content: results });
      if (round === LOOP_LIMITS.rounds - 1 || totalCalls >= LOOP_LIMITS.calls) {
        messages.push({ role: "user", content: "Application limit reached. No more lookups. Return your final JSON using only existing results. If no successful relevant board search exists, omit proposal. State any limitations." });
      }
    }
  } catch (error) {
    yield { type: "result", data: {
      answer: error instanceof ChatConfigurationError ? error.message : SAFE_CHAT_ANSWER,
      proposal: null, docChunks: Array.from(chunks.values()),
    } };
  }
}

async function withReadTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Read timed out")), 10000);
    })]);
  } finally { clearTimeout(timer); }
}
