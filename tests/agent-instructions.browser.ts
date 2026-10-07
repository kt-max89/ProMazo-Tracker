// Real admin editor, auth and chatbot verification with disposable accounts.
// Prompt changes are test-marker-specific; originals are restored only if our
// version still owns the row, never overwriting another admin's concurrent save.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import bcrypt from "bcrypt";
import { pool } from "../server/db";
import OpenAI from "openai";
import { handleChatMessage } from "../server/chatOrchestrator";
import { storage } from "../server/storage";

if (!process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT === "1") throw Error("Development preview only");
const suffix = randomUUID().slice(0, 8), password = randomUUID(), ids: number[] = [];
const browser = await chromium.launch({ executablePath: existsSync("/repl/tools/bin/chromium") ? "/repl/tools/bin/chromium" : undefined, args: ["--no-sandbox"] });
const baseURL = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const admin = await browser.newContext({ baseURL }), member = await browser.newContext({ baseURL });
const page = await admin.newPage();
const originalRow = (await pool.query("SELECT * FROM agent_instructions WHERE id=1")).rows[0];
let original: any, savedVersion: number | undefined;
const pageErrors: string[] = [];
page.on("pageerror", error => pageErrors.push(error.message));
page.on("dialog", dialog => dialog.accept());

try {
  const hash = await bcrypt.hash(password, 4);
  for (const role of ["admin", "user"]) {
    const result = await pool.query("INSERT INTO users(email,password_hash,display_name,role) VALUES($1,$2,$3,$4) RETURNING id",
      [`instructions-${role}-${suffix}@example.test`, hash, `Instructions ${role} ${suffix}`, role]);
    ids.push(result.rows[0].id);
  }
  const anonymous = await browser.newContext({ baseURL });
  assert.equal((await anonymous.request.get("/api/admin/agent-instructions")).status(), 403);
  assert.equal((await anonymous.request.patch("/api/admin/agent-instructions", { data: { instructions: "bad", version: 0 } })).status(), 403);
  await anonymous.close();
  for (const [role, context] of [["admin", admin], ["user", member]] as const) {
    assert.ok((await context.request.post("/api/auth/login", { data: { email: `instructions-${role}-${suffix}@example.test`, password } })).ok());
  }
  assert.equal((await member.request.get("/api/admin/agent-instructions")).status(), 403);
  assert.equal((await member.request.patch("/api/admin/agent-instructions", { data: { instructions: "bad", version: 0 } })).status(), 403);
  original = await (await admin.request.get("/api/admin/agent-instructions")).json();
  await page.goto("/admin");
  const editor = page.getByTestId("input-agent-instructions"), save = page.getByTestId("button-save-agent-instructions");
  await expect(editor).toHaveValue(original.instructions);
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(save).toBeDisabled();
  await editor.fill(" \n");
  await expect(save).toBeDisabled();
  await editor.fill("x".repeat(16001));
  await expect(save).toBeDisabled();
  const custom = `Required answer-style instruction: Whenever the user's latest question contains "InstructionCheck${suffix}", begin the answer text with "PolicyApplied${suffix}". Keep the application's JSON response format unchanged.\n\n${original.instructions}  \n`;
  await editor.fill(custom);
  const savedResponse = page.waitForResponse(r => r.url().endsWith("/api/admin/agent-instructions") && r.request().method() === "PATCH");
  await save.click();
  const saved = await (await savedResponse).json();
  savedVersion = saved.version;
  assert.equal(saved.instructions, custom);
  await expect(page.getByTestId("agent-instructions-status")).toContainText("Saved successfully");
  await page.reload();
  await expect(editor).toHaveValue(custom);
  assert.equal((await admin.request.patch("/api/admin/agent-instructions", { data: { instructions: " ", version: savedVersion } })).status(), 400);
  assert.equal((await admin.request.patch("/api/admin/agent-instructions", { data: { instructions: "x".repeat(16001), version: savedVersion } })).status(), 400);

  // A valid parallel admin save makes the local version stale without losing
  // edits when the next save is rejected.
  const parallel = await admin.request.patch("/api/admin/agent-instructions", { data: { instructions: custom + "\n", version: savedVersion } });
  assert.ok(parallel.ok());
  savedVersion = (await parallel.json()).version;
  await editor.fill(custom + "\nLocal unsaved change.");
  const conflictResponse = page.waitForResponse(r => r.url().endsWith("/api/admin/agent-instructions") && r.request().method() === "PATCH");
  await save.click();
  assert.equal((await conflictResponse).status(), 409);
  await expect(editor).toHaveValue(custom + "\nLocal unsaved change.");
  await expect(page.getByTestId("agent-instructions-status")).toContainText("newer version");
  await page.getByTestId("button-reload-agent-instructions").click();
  await expect(editor).toHaveValue(custom + "\n");
  await expect(save).toBeDisabled();

  const session = await (await member.request.post("/api/chat-sessions", { data: { title: `Policy check ${suffix}` } })).json();
  const originalCreate = OpenAI.Chat.Completions.prototype.create;
  let capturedSystem = "";
  try {
    OpenAI.Chat.Completions.prototype.create = (async function (payload: any) {
      if (payload.response_format) capturedSystem = payload.messages[0].content;
      return { choices: [{ message: { content: '{"answer":"Test only"}' } }] };
    }) as any;
    const user = await storage.getUser(ids[1]);
    assert.ok(user);
    for await (const _event of handleChatMessage({ message: `InstructionCheck${suffix}: say hello briefly.`, user, storage, sessionId: session.id })) {}
    assert.ok(capturedSystem.startsWith(custom + "\n"), "actual orchestrator loads and sends saved policy");
    console.log("Captured orchestrator system prompt includes the saved policy exactly.");
  } finally {
    OpenAI.Chat.Completions.prototype.create = originalCreate;
  }
  const response = await member.request.post("/api/chat", { data: { query: `InstructionCheck${suffix}: say hello briefly.`, sessionId: session.id }, timeout: 90000 });
  assert.ok(response.ok());
  const events = (await response.text()).split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
  assert.ok(events.some(event => event.type === "done"));
  const answer = events.filter(event => event.type === "token").map(event => event.data).join("");
  await page.setViewportSize({ width: 390, height: 844 });
  await editor.scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  assert.deepEqual(pageErrors, []);
  assert.match(answer, new RegExp(`PolicyApplied${suffix}`), "live model honors the configurable answer-style rule");
  console.log("Admin editor, exact persistence, blank/length validation, anonymous/member denial, safe conflict reload, mobile width and live model policy passed.");
} finally {
  if (savedVersion !== undefined) {
    if (originalRow) {
      await pool.query("UPDATE agent_instructions SET instructions=$1,version=version+1,updated_at=now() WHERE id=1 AND version=$2", [original.instructions, savedVersion]);
    } else {
      await pool.query("DELETE FROM agent_instructions WHERE id=1 AND version=$1", [savedVersion]);
    }
  }
  for (const id of ids) {
    await pool.query("DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE user_id=$1)", [id]);
    await pool.query("DELETE FROM chat_sessions WHERE user_id=$1", [id]);
    await pool.query("DELETE FROM session WHERE (sess->'passport'->'user'->>'id')=$1 OR (sess->'passport'->>'user')=$1", [String(id)]);
    await pool.query("DELETE FROM users WHERE id=$1", [id]);
  }
  await admin.close(); await member.close(); await browser.close(); await pool.end();
}
