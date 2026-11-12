// Real sign-in and saved history, isolated disposable fixtures. Chat SSE is
// controlled to exercise UI navigation/reset races, not model/task mutation.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chromium, expect, type Page } from "@playwright/test";
import bcrypt from "bcrypt";
import { pool } from "../server/db";

if (!process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT === "1") throw Error("Development preview only");
const baseURL = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const suffix = randomUUID().slice(0, 8), password = randomUUID();
const browser = await chromium.launch({ executablePath: existsSync("/repl/tools/bin/chromium") ? "/repl/tools/bin/chromium" : undefined, args: ["--no-sandbox"] });
const ids: number[] = [];
const errors: string[] = [];

async function checkNavigation(page: Page) {
  const links = page.locator('[data-testid="sidebar"] [data-testid^="link-sidebar-"]');
  await expect(links).toHaveText(["My tasks", "All tasks", "Team overview"]);
}

async function checkHeader(page: Page, role: string, width: number, sidebarOpen: boolean, path: string) {
  const header = page.getByTestId("page-header");
  await expect(header).toBeVisible();
  const account = page.getByTestId("header-account-group");
  await expect(account.getByTestId("live-presence")).toBeVisible();
  await expect(header.locator('a[href="/admin"]')).toHaveCount(role === "admin" ? 1 : 0);
  const bounds = await header.evaluate(header => {
    const h = header.getBoundingClientRect();
    const group = header.querySelector('[data-testid="header-account-group"]')!.getBoundingClientRect();
    const title = header.querySelector('[data-testid="header-title-group"]')!.getBoundingClientRect();
    const overflowing = [...header.querySelectorAll("*")].filter(node => {
      const r = node.getBoundingClientRect();
      return r.width > 0 && (r.right > h.right + 1 || r.left < h.left - 1);
    }).map(node => ({ tag: node.tagName, text: node.textContent?.slice(0, 35), classes: node.getAttribute("class") }));
    const controls = [...header.querySelectorAll("button")].map(node => {
      const r = node.getBoundingClientRect();
      return { label: node.title || node.getAttribute("aria-label"), w: r.width, h: r.height };
    });
    return { right: h.right, paddingRight: parseFloat(getComputedStyle(header).paddingRight),
      accountRight: group.right, accountLeft: group.left, titleRight: title.right,
      titleBottom: title.bottom, accountTop: group.top, overflowing, controls };
  });
  const label = `${role} ${path} width=${width} sidebar=${sidebarOpen}`;
  assert.ok(bounds.right <= width + 1, `${label}: header outside viewport`);
  assert.deepEqual(bounds.overflowing, [], `${label}: header child overflow`);
  assert.ok(bounds.controls.every(button => button.w >= 20 && button.h >= 20), `${label}: header controls too squeezed`);
  assert.ok(bounds.accountLeft >= bounds.titleRight - 1 || bounds.accountTop >= bounds.titleBottom - 1,
    `${label}: title and account groups overlap`);
  assert.ok(Math.abs(bounds.accountRight - (bounds.right - bounds.paddingRight)) <= 1,
    `${label}: account group is not right-aligned: ${JSON.stringify(bounds)}`);
}

try {
  const hash = await bcrypt.hash(password, 4);
  for (const role of ["user", "admin"]) {
    const displayName = `LongNavigationVerificationNameWithoutSpaces${suffix} Long Display Name ${role}`;
    const { rows } = await pool.query("INSERT INTO users(email,password_hash,display_name,role) VALUES($1,$2,$3,$4) RETURNING id",
      [`navigation-${role}-${suffix}@example.test`, hash, displayName, role]);
    const userId = rows[0].id;
    ids.push(userId);
    const { rows: sessions } = await pool.query("INSERT INTO chat_sessions(user_id,title) VALUES($1,$2) RETURNING id",
      [userId, `Existing conversation ${suffix}`]);
    const sessionId = sessions[0].id;
    await pool.query("INSERT INTO chat_messages(session_id,role,content) VALUES($1,'user',$2),($1,'assistant',$3)",
      [sessionId, `Saved question ${suffix}`, `Saved answer ${suffix}`]);
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
    const login = await context.request.post("/api/auth/login", { data: { email: `navigation-${role}-${suffix}@example.test`, password } });
    assert.ok(login.ok());
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    let creates = 0;
    page.on("request", request => {
      if (new URL(request.url()).pathname === "/api/chat-sessions" && request.method() === "POST") creates++;
    });
    await page.goto("/");
    await checkNavigation(page);
    await page.getByTestId(`session-item-${sessionId}`).click();
    await expect(page.getByText(`Saved answer ${suffix}`, { exact: true })).toBeVisible();
    await page.getByTestId("input-query").fill("Unsent old draft");
    await page.getByTestId("link-sidebar-my-tasks").click();
    await expect(page.getByTestId("my-tasks-page")).toBeVisible();
    await expect(page.getByTestId("link-sidebar-my-tasks")).toHaveClass(/bg-primary\/10/);
    await page.getByTestId("button-new-chat").click();
    await expect(page.getByTestId("text-welcome")).toBeVisible();
    await expect(page.getByTestId("input-query")).toHaveValue("");
    await expect(page.getByText(`Saved answer ${suffix}`, { exact: true })).toHaveCount(0);

    // Individual project detail pages have no existing shared sidebar. Exercise
    // the Projects workspace, where New Chat is available.
    for (const path of ["/tasks", "/team-overview", "/projects"]) {
      await page.goto(path);
      await checkNavigation(page);
      await page.getByTestId("button-new-chat").click();
      await expect(page.getByTestId("text-welcome")).toBeVisible();
    }
    await page.getByTestId(`session-item-${sessionId}`).click();
    await expect(page.getByText(`Saved answer ${suffix}`, { exact: true })).toBeVisible();
    await page.getByTestId("input-query").fill("Another old draft");
    await page.getByTestId("button-new-chat").click();
    await expect(page.getByTestId("text-welcome")).toBeVisible();
    await expect(page.getByTestId("input-query")).toHaveValue("");
    assert.equal(creates, 0, "New Chat navigation never saves an empty conversation");
    const persisted = await (await context.request.get(`/api/chat-sessions/${sessionId}`)).json();
    assert.equal(persisted.messages.length, 2, "saved history preserved");

    // Complete a controlled creation proposal; reset must dismiss both messages
    // and review state without approving or saving any task.
    const mockBody = [
      { type: "token", data: "Controlled response" },
      { type: "done" },
      { type: "task_proposal", data: { proposalId: randomUUID(), type: "create_task", tasks: [{ title: `Unsaved proposal ${suffix}` }] } },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join("");
    await page.route("**/api/chat", route => route.fulfill({ status: 200, contentType: "text/event-stream", body: mockBody }));
    await page.getByTestId("input-query").fill("Controlled question");
    await page.getByTestId("button-send").click();
    await expect(page.getByTestId("proposal-modal")).toBeVisible();
    // Invoke the same reset handler while the modal is present. Approval is not
    // performed; the modal normally covers the underlying sidebar.
    await page.getByTestId("button-new-chat").evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByTestId("proposal-modal")).toHaveCount(0);
    await expect(page.getByTestId("text-welcome")).toBeVisible();
    await page.unroute("**/api/chat");

    // A slow history read must not populate a fresh conversation after reset.
    let releaseHistory!: () => void, historyStarted!: () => void;
    const historyGate = new Promise<void>(resolve => { releaseHistory = resolve; });
    const historySeen = new Promise<void>(resolve => { historyStarted = resolve; });
    await page.route(`**/api/chat-sessions/${sessionId}`, async route => {
      const response = await route.fetch();
      historyStarted(); await historyGate;
      await route.fulfill({ response }).catch(() => {});
    });
    await page.getByTestId(`session-item-${sessionId}`).click();
    await historySeen;
    await page.getByTestId("button-new-chat").click();
    releaseHistory();
    await expect(page.getByTestId("text-welcome")).toBeVisible();
    await expect(page.getByText(`Saved answer ${suffix}`, { exact: true })).toHaveCount(0);
    await page.unroute(`**/api/chat-sessions/${sessionId}`);

    // Reset while a prior chat response is outstanding: late proposals must not
    // reopen reviews or put the old answer in the new conversation.
    let releaseChat!: () => void, chatStarted!: () => void;
    const chatGate = new Promise<void>(resolve => { releaseChat = resolve; });
    const chatSeen = new Promise<void>(resolve => { chatStarted = resolve; });
    const requestEnded = page.waitForEvent("requestfailed", request => new URL(request.url()).pathname === "/api/chat");
    await page.route("**/api/chat", async route => {
      chatStarted(); await chatGate;
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: mockBody }).catch(() => {});
    });
    await page.getByTestId("input-query").fill("Delayed response");
    await page.getByTestId("button-send").click();
    await chatSeen;
    await page.getByTestId("button-new-chat").click();
    releaseChat();
    await requestEnded;
    await expect(page.getByTestId("text-welcome")).toBeVisible();
    await expect(page.getByTestId("proposal-modal")).toHaveCount(0);
    await expect(page.getByTestId("input-query")).toBeEnabled();
    await page.unroute("**/api/chat");

    for (const width of [1280, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ["/my-tasks", "/tasks", "/"]) {
        await page.goto(path); // Mount-time sidebar state follows viewport.
        if (role === "admin" && path === "/my-tasks") {
          await page.getByTestId("select-person-filter").click();
          await page.getByRole("option", {
            name: `LongNavigationVerificationNameWithoutSpaces${suffix} Long Display Name user`, exact: true,
          }).click();
          await expect(page.getByTestId("header-title-group")).toContainText("LongNavigationVerificationNameWithoutSpaces");
        }
        for (const sidebarOpen of [false, true]) {
          const visible = await page.getByTestId("sidebar").count() > 0;
          if (sidebarOpen && !visible) await page.getByTestId("button-open-sidebar").click();
          if (!sidebarOpen && visible) await page.getByTestId("button-close-sidebar").click();
          await checkHeader(page, role, width, sidebarOpen, path);
          const name = page.getByTestId("header-account-group").getByText(displayName, { exact: true });
          if (width < 640) await expect(name).toBeHidden();
          else await expect(name).toBeVisible();
          if (sidebarOpen) await checkNavigation(page);
        }
      }
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log("Passed: regular/admin navigation order, New Chat from all destinations, preserved saved history, no empty sessions, review reset, late history/model cancellation, and 36 desktop/tablet/phone header layouts.");
} finally {
  await browser.close();
  for (const id of ids) {
    await pool.query("DELETE FROM chat_sessions WHERE user_id=$1", [id]);
    await pool.query("DELETE FROM session WHERE (sess->'passport'->'user'->>'id')=$1 OR (sess->'passport'->>'user')=$1", [String(id)]);
    await pool.query("DELETE FROM users WHERE id=$1", [id]);
  }
  await pool.end();
}
