import assert from "node:assert/strict";
import test from "node:test";
import { agentInstructionsInput } from "../server/agentInstructionsService";
import { agentSystemPrompt, buildPrompt, DEFAULT_MAIN_AGENT_INSTRUCTIONS, AGENT_APPLICATION_RULES } from "../server/promptBuilder";

test("admin instructions validate exact nonblank text, bounded length and version", () => {
  const text = "  Guidance\n\n  Keep spacing.\n";
  assert.equal(agentInstructionsInput.parse({ instructions: text, version: 0 }).instructions, text);
  for (const instructions of ["", " \n ", "x".repeat(16001), null]) {
    assert.equal(agentInstructionsInput.safeParse({ instructions, version: 0 }).success, false);
  }
  for (const version of [-1, 0.5, "1", null, 2147483647]) {
    assert.equal(agentInstructionsInput.safeParse({ instructions: "ok", version }).success, false);
  }
  assert.equal(agentInstructionsInput.safeParse({ instructions: "ok", version: 0, role: "admin" }).success, false);
});

test("unchanged default policy preserves original creation and isolated edit prompts", () => {
  for (const editMode of [false, true]) {
    assert.equal(agentSystemPrompt(undefined, editMode), agentSystemPrompt(DEFAULT_MAIN_AGENT_INSTRUCTIONS, editMode));
  }
  assert.ok(DEFAULT_MAIN_AGENT_INSTRUCTIONS.includes("Live data rules:"));
  assert.ok(!DEFAULT_MAIN_AGENT_INSTRUCTIONS.includes("Task proposal rules:"));
});

test("configured instructions apply as system policy without removing formats, approvals or edit isolation", () => {
  const instructions = "Use a direct, friendly tone.";
  const creation = buildPrompt({ message: "Hello", mainAgentInstructions: instructions });
  assert.ok(String(creation[0].content).startsWith(instructions));
  assert.ok(String(creation[0].content).includes(AGENT_APPLICATION_RULES.creation));
  assert.match(String(creation[0].content), /takes precedence|explicit user-review/);
  const edit = buildPrompt({ message: "Update task 10", mainAgentInstructions: instructions,
    toolResults: [{ type: "task_edit", isEmpty: false, content: "Current saved task" }] });
  assert.ok(String(edit[0].content).includes(AGENT_APPLICATION_RULES.editing));
  assert.ok(!String(edit[0].content).includes("Task proposal rules:"));
  assert.match(String(edit[0].content), /NO creation defaults/);
});
