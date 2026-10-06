// Real chat API/model and authenticated browser; fixtures never change shared
// sprint settings or real users/projects.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import bcrypt from "bcrypt";
import { pool } from "../server/db";
import { runProjectKnowledgeTool, loadTeamSprintContext } from "../server/projectKnowledgeTool";

if (!process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT === "1") throw Error("Development preview only");
const suffix = randomUUID().slice(0, 8);
const email = `context-${suffix}@example.test`, password = randomUUID();
const browser = await chromium.launch({
  executablePath: existsSync("/repl/tools/bin/chromium") ? "/repl/tools/bin/chromium" : undefined,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}` });
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));
const teamIds: number[] = [], projectIds: number[] = [];
let userId: number | undefined, historicalSprintId: number | undefined;

async function sendQuestion(question: string) {
  const done = page.waitForResponse(r => r.url().endsWith("/api/chat") && r.request().method() === "POST");
  await page.getByTestId("input-query").fill(question);
  await page.getByTestId("button-send").click();
  const response = await done;
  assert.ok(response.ok(), `chat status ${response.status()}`);
  const stream = await response.text();
  const events = stream.split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
  assert.ok(events.some(e => e.type === "done"), "chat finished");
  assert.ok(!events.some(e => e.type === "error"), "no chat error");
  const answer = events.filter(e => e.type === "token").map(e => e.data).join("");
  await expect(page.getByTestId("input-query")).toBeEnabled();
  return { answer, events };
}

try {
  const { rows: settings } = await pool.query("SELECT current_sprint_id FROM tracker_settings WHERE id=1");
  const currentSprintId = settings[0]?.current_sprint_id;
  assert.ok(currentSprintId, "Preview must have a selected current sprint");
  for (const name of [`Context team ${suffix}`, `Other team ${suffix}`]) {
    const { rows } = await pool.query("INSERT INTO teams (name) VALUES ($1) RETURNING id", [name]);
    teamIds.push(rows[0].id);
  }
  const { rows: users } = await pool.query(
    "INSERT INTO users (email,password_hash,role,display_name,team_id) VALUES ($1,$2,'user',$3,$4) RETURNING id",
    [email, await bcrypt.hash(password, 10), `Context User ${suffix}`, teamIds[0]],
  );
  userId = users[0].id;
  const names = [`Context Alpha ${suffix}`, `Context Shared ${suffix}`, `Context Outside ${suffix}`];
  for (let index = 0; index < names.length; index++) {
    const { rows } = await pool.query("INSERT INTO projects (name,description) VALUES ($1,$2) RETURNING id",
      [names[index], `# Overview\nStrategic objective: CobaltOverview${suffix}. This is saved project Markdown, not a sprint plan.`]);
    projectIds.push(rows[0].id);
    for (const teamId of index === 0 ? [teamIds[0]] : index === 1 ? teamIds : [teamIds[1]]) {
      await pool.query("INSERT INTO project_teams (project_id,team_id) VALUES ($1,$2)", [rows[0].id, teamId]);
    }
    await pool.query("INSERT INTO project_sprint_plans (project_id,sprint_id,content) VALUES ($1,$2,$3)",
      [rows[0].id, currentSprintId, `# Current sprint plan\nSprint goal: ${["MercuryReadiness", "JupiterQuality", "NeptuneLaunch"][index]}${suffix}.`]);
  }
  const { rows: historical } = await pool.query("INSERT INTO sprints (number) SELECT COALESCE(MAX(number),0)+100000 FROM sprints RETURNING id,number");
  historicalSprintId = historical[0].id;
  await pool.query("INSERT INTO project_sprint_plans (project_id,sprint_id,content) VALUES ($1,$2,$3)",
    [projectIds[0], historicalSprintId, `# Historical sprint\nArchived objective: SaturnArchive${suffix}.`]);

  // Verify actual service queries independently from LLM phrasing/routing.
  const source = await loadTeamSprintContext({ teamId: teamIds[0] }, true);
  assert.match(source, new RegExp(`MercuryReadiness${suffix}`));
  assert.match(source, new RegExp(`JupiterQuality${suffix}`));
  assert.doesNotMatch(source, new RegExp(`NeptuneLaunch${suffix}|SaturnArchive${suffix}`));
  const history = await runProjectKnowledgeTool({ projectId: projectIds[0], sprintNumber: historical[0].number });
  assert.match(history.content, new RegExp(`SaturnArchive${suffix}`));

  await page.goto("/auth");
  await page.getByTestId("input-email").fill(email);
  await page.getByTestId("input-password").fill(password);
  await page.getByTestId("button-submit-auth").click();
  await expect(page.getByTestId("input-query")).toBeVisible();
  const first = await sendQuestion("What should we focus on this sprint? Summarize saved sprint goals only; do not propose new tasks.");
  assert.match(first.answer, new RegExp(`MercuryReadiness${suffix}`));
  assert.match(first.answer, new RegExp(`JupiterQuality${suffix}`));
  assert.doesNotMatch(first.answer, new RegExp(`NeptuneLaunch${suffix}|SaturnArchive${suffix}`));
  assert.ok(first.events.some(e => e.type === "route" && e.data === "TEAM_SPRINT_PLANS"));
  await expect(page.getByText("Team sprint plans", { exact: true }).first()).toBeVisible();

  await pool.query("UPDATE project_sprint_plans SET content=$1,updated_at=now() WHERE project_id=$2 AND sprint_id=$3",
    [`# Edited current plan\nSprint goal: VenusVerification${suffix}.`, projectIds[0], currentSprintId]);
  const fresh = await sendQuestion("What are the current saved goals now? Use the latest saved team plans. Do not propose tasks.");
  assert.match(fresh.answer, new RegExp(`VenusVerification${suffix}`));
  assert.doesNotMatch(fresh.answer, new RegExp(`MercuryReadiness${suffix}`));

  const outside = await sendQuestion(`Read the current sprint plan for project "${names[2]}" (project ID ${projectIds[2]}). What is its saved goal? No task proposals.`);
  assert.match(outside.answer, new RegExp(`NeptuneLaunch${suffix}`));
  assert.ok(outside.events.some(e => e.type === "route" && e.data === "READ_PROJECT_CONTEXT"));
  await expect(page.getByText("Plans & overviews", { exact: true }).first()).toBeVisible();

  const overview = await sendQuestion(`Read the saved project overview for "${names[2]}" (project ID ${projectIds[2]}). What is its strategic objective? No task proposals.`);
  assert.match(overview.answer, new RegExp(`CobaltOverview${suffix}`));
  const old = await sendQuestion(`Read project ID ${projectIds[0]}'s saved plan for Sprint ${historical[0].number}, not the current sprint. What was its archived objective? No task proposals.`);
  assert.match(old.answer, new RegExp(`SaturnArchive${suffix}`));
  assert.deepEqual(errors, []);
  console.log("Real signed-in chat passed: automatic first-question team plans, fresh follow-ups, cross-team normal-user reads, overview, historical sprint and source badges.");
} finally {
  await context.close();
  await browser.close();
  if (userId) {
    await pool.query("DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE user_id=$1)", [userId]);
    await pool.query("DELETE FROM chat_sessions WHERE user_id=$1", [userId]);
    await pool.query("DELETE FROM session WHERE (sess->'passport'->'user'->>'id')=$1 OR (sess->'passport'->>'user')=$1", [String(userId)]);
    await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  }
  if (projectIds.length) {
    await pool.query("DELETE FROM project_sprint_plans WHERE project_id=ANY($1::int[])", [projectIds]);
    await pool.query("DELETE FROM project_teams WHERE project_id=ANY($1::int[])", [projectIds]);
    await pool.query("DELETE FROM projects WHERE id=ANY($1::int[])", [projectIds]);
  }
  if (teamIds.length) await pool.query("DELETE FROM teams WHERE id=ANY($1::int[])", [teamIds]);
  if (historicalSprintId) await pool.query("DELETE FROM sprints WHERE id=$1", [historicalSprintId]);
  await pool.end();
}
