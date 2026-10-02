import assert from "node:assert/strict";
import { expect, type Page, type APIResponse } from "@playwright/test";

export async function assertJsonResponse(response: APIResponse, status: number) {
  assert.equal(response.status(), status);
  assert.match(response.headers()["content-type"] ?? "", /^application\/json\b/i);
  return response.json();
}

type WorkspaceFixture = { id: number; name: string };

export async function verifyTeamWorkspaceLoading(
  page: Page,
  memberTeam: WorkspaceFixture,
  otherTeam: WorkspaceFixture,
  project: WorkspaceFixture,
  memberName: string,
) {
  const request = page.context().request;
  const membershipBefore = await (await request.get("/api/auth/me")).json();
  assert.equal(membershipBefore.teamId, memberTeam.id);
  const original = await assertJsonResponse(await request.get(`/api/teams/${memberTeam.id}`), 200);
  const contract = `Loading regression agreement for ${memberTeam.name}`;
  await assertJsonResponse(await request.patch(`/api/teams/${memberTeam.id}`, {
    data: { socialContract: contract },
  }), 200);
  try {
    async function expectMemberWorkspace() {
      await expect(page.getByRole("heading", { name: memberTeam.name, exact: true })).toBeVisible();
      await expect(page.getByText(contract, { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: project.name, exact: true })).toBeVisible();
      await expect(page.locator("aside").getByText(memberName, { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Team unavailable", exact: true })).toHaveCount(0);
    }
    await page.goto("/team-overview");
    await page.getByTestId(`team-row-${memberTeam.id}`).getByRole("link", { name: memberTeam.name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/teams/${memberTeam.id}$`));
    await expectMemberWorkspace();
    await page.reload();
    await expectMemberWorkspace();
    await page.goto(`/teams/${memberTeam.id}`);
    await expectMemberWorkspace();

    const other = await assertJsonResponse(await request.get(`/api/teams/${otherTeam.id}`), 200);
    assert.equal(other.id, otherTeam.id);
    assert.equal(other.name, otherTeam.name);
    await page.goto("/team-overview");
    await page.getByTestId(`team-row-${otherTeam.id}`).getByRole("link", { name: otherTeam.name, exact: true }).click();
    await expect(page.getByRole("heading", { name: otherTeam.name, exact: true })).toBeVisible();
    await page.goto(`/teams/${otherTeam.id}`);
    await expect(page.getByRole("heading", { name: otherTeam.name, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: otherTeam.name, exact: true })).toBeVisible();

    const path = `**/api/teams/${memberTeam.id}`;
    let failures = 0;
    await page.route(path, route => {
      failures++;
      return route.fulfill({
        status: 503, contentType: "application/json", body: '{"message":"Temporary loading failure"}',
      });
    });
    try {
      await page.goto(`/teams/${memberTeam.id}`);
      await expect(page.getByRole("heading", { name: "Team unavailable", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Try again", exact: true }).click();
      await expect.poll(() => failures).toBe(2);
      await expect(page.getByRole("heading", { name: "Team unavailable", exact: true })).toBeVisible();
    } finally {
      await page.unroute(path);
    }
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expectMemberWorkspace();

    const missingId = 2147483647;
    const missing = await assertJsonResponse(await request.get(`/api/teams/${missingId}`), 404);
    assert.equal(missing.message, "Team not found");
    await page.goto(`/teams/${missingId}`);
    await expect(page.getByRole("heading", { name: "Team not found", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Team Overview", exact: true }).click();
    await expect(page.getByTestId("team-overview-page")).toBeVisible();
    const membershipAfter = await (await request.get("/api/auth/me")).json();
    assert.equal(membershipAfter.teamId, membershipBefore.teamId, "Opening workspaces must not change membership");
    const restored = await assertJsonResponse(await request.get(`/api/teams/${memberTeam.id}`), 200);
    assert.equal(restored.id, memberTeam.id);
    assert.equal(restored.socialContract, contract);
    console.log("Team loading: JSON 200/404, overview links, direct access, refresh, non-member access, missing state and retry recovery passed.");
  } finally {
    await assertJsonResponse(await request.patch(`/api/teams/${memberTeam.id}`, {
      data: { socialContract: original.socialContract },
    }), 200);
  }
}