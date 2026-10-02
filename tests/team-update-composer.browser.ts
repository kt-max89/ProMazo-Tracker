import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import type { TeamPost } from "../shared/schema";

// Called with a normally authenticated disposable user by the workspace suite.
// Only this user's published post is mutated; feed fixtures isolate real posts.
export async function verifyTeamUpdateComposer(page: Page, suffix: string) {
  const feed: TeamPost[] = [];
  let feedState: "loading" | "empty" | "failed" | "ready" = "loading";
  let releaseFeed!: () => void;
  const feedGate = new Promise<void>(resolve => { releaseFeed = resolve; });
  let publishState: "failed" | "pending" | "ready" = "failed";
  let releasePublish!: () => void;
  const publishGate = new Promise<void>(resolve => { releasePublish = resolve; });
  let submissions = 0;
  const pattern = "**/api/team-posts";
  await page.route(pattern, async route => {
    if (route.request().method() === "GET") {
      if (feedState === "loading") await feedGate;
      await route.fulfill({
        status: feedState === "failed" ? 500 : 200,
        json: feedState === "failed" ? { message: "Intentional feed failure" } : feedState === "empty" ? [] : feed,
      });
      return;
    }
    submissions++;
    if (publishState === "failed") {
      await route.fulfill({ status: 500, json: { message: "Intentional publish failure" } });
      return;
    }
    if (publishState === "pending") await publishGate;
    const response = await route.fetch();
    assert.ok(response.ok());
    feed.unshift(await response.json());
    await route.fulfill({ response });
  });
  await page.route("**/api/team-posts?all=true", route => route.fulfill({ json: feed }));
  const add = page.getByTestId("button-add-team-update");
  const textarea = page.getByTestId("input-team-post");
  const publish = page.getByTestId("button-publish-team-post");
  const updates = page.locator('section[aria-labelledby="team-updates-heading"]');
  try {
    await page.goto("/team-overview");
    await expect(add).toBeVisible();
    await expect(add).toHaveAttribute("aria-expanded", "false");
    await expect(textarea).toHaveCount(0);
    await expect(publish).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "What’s happening?" })).toHaveCount(0);
    await add.focus();
    await page.keyboard.press("Enter");
    await expect(textarea).toBeFocused();
    await expect(add).toHaveAttribute("aria-expanded", "true");
    await add.click();
    feedState = "empty";
    releaseFeed();
    await expect(updates.getByText("No team updates yet. Be the first to share one.")).toBeVisible();
    await expect(add).toBeVisible();
    feedState = "failed";
    await page.reload();
    await expect(updates.getByText(/We couldn’t load team updates/)).toBeVisible();
    await expect(add).toBeVisible();
    await add.click();
    await expect(textarea).toBeFocused();
    await textarea.fill(" \n\t ");
    await expect(publish).toBeDisabled();
    await textarea.evaluate(el => el.closest("form")!.requestSubmit());
    assert.equal(submissions, 0, "Whitespace does not submit even through the form");
    const draft = `## Update ${suffix}\n\n**Markdown** draft`;
    await textarea.fill(draft);
    await publish.click();
    await expect(page.getByText("Intentional publish failure", { exact: true })).toBeVisible();
    await expect(textarea).toHaveValue(draft);
    await expect(add).toHaveAttribute("aria-expanded", "true");
    await add.click();
    await add.focus();
    await page.keyboard.press("Space");
    await expect(textarea).toBeFocused();
    await expect(textarea).toHaveValue(draft);
    publishState = "pending";
    await publish.focus();
    await page.keyboard.press("Enter");
    await expect(publish).toBeDisabled();
    await expect(textarea).toBeDisabled();
    await expect(add).toBeDisabled();
    await textarea.evaluate(el => el.closest("form")!.requestSubmit());
    assert.equal(submissions, 2, "The pending form cannot send a duplicate");
    feedState = "ready";
    releasePublish();
    await expect(textarea).toHaveCount(0);
    await expect(add).toHaveAttribute("aria-expanded", "false");
    await expect(add).toBeFocused();
    const post = feed[0];
    const article = page.getByTestId(`team-post-${post.id}`);
    await expect(article.getByRole("heading", { name: `Update ${suffix}` })).toBeVisible();
    await expect(article.locator("strong")).toHaveText("Markdown");
    await add.click();
    await expect(textarea).toHaveValue("");
    await add.click();
    // The same heading still supports feed expansion, pinning, and deletion.
    for (let i = 1; i <= 4; i++) feed.push({
      ...post, id: -i, authorId: null, authorName: "Feed fixture", body: `Existing update ${i}`,
    });
    await page.reload();
    await page.getByTestId("button-show-all-posts").click();
    await expect(page.getByTestId("button-show-fewer-posts")).toBeVisible();
    await expect(add).toBeVisible();
    await page.getByTestId("button-close-sidebar").click();
    await page.setViewportSize({ width: 320, height: 844 });
    await add.focus();
    await page.keyboard.press("Enter");
    await expect(textarea).toBeFocused();
    await expect(page.getByTestId("button-show-fewer-posts")).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1));
    for (const button of [add, page.getByTestId("button-show-fewer-posts"), publish]) {
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= 321, "Mobile controls fit");
    }
    await mkdir("screenshots", { recursive: true });
    await updates.screenshot({ path: "screenshots/team-update-composer-mobile.png" });
    await page.getByTestId("button-show-fewer-posts").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("button-show-all-posts")).toBeVisible();
    await expect(textarea).toBeVisible();
    await add.click();
    await page.route(`**/api/team-posts/${post.id}/pin`, async route => {
      const response = await route.fetch();
      assert.ok(response.ok());
      Object.assign(post, await response.json());
      await route.fulfill({ response });
    });
    await article.getByRole("button", { name: "Pin post", exact: true }).click();
    await expect(article.getByRole("button", { name: "Unpin post", exact: true })).toBeVisible();
    await article.getByRole("button", { name: "Unpin post", exact: true }).click();
    await expect(article.getByRole("button", { name: "Pin post", exact: true })).toBeVisible();
    await page.route(`**/api/team-posts/${post.id}`, async route => {
      const response = await route.fetch();
      assert.ok(response.ok());
      feed.splice(feed.indexOf(post), 1);
      await route.fulfill({ response });
    });
    await article.getByRole("button", { name: "Delete your post" }).click();
    await page.getByTestId("button-confirm-delete-team-post").click();
    await expect(article).toHaveCount(0);
    await expect(add).toBeVisible();
    console.log("Team update composer: hidden/loading/empty/error, focus, blank/pending guards, failure draft, success refresh/reset, Markdown, expansion, pin/delete, keyboard and 320px layout passed.");
  } finally {
    releaseFeed();
    releasePublish();
    await page.unrouteAll({ behavior: "wait" });
    await page.setViewportSize({ width: 1280, height: 900 });
  }
}