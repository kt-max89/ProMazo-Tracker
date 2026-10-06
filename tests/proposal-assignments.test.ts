import assert from "node:assert/strict";
import test from "node:test";
import { eligibleProposalUsers, legacyProposalAssignment, resolveProposalAssignments, type AssignmentUser } from "../shared/proposalAssignments";
import { reviewedProposalSchema, validateProposal } from "../server/proposalSchema";

const users: AssignmentUser[] = [
  { id: 1, displayName: "Reviewer", email: "reviewer@example.test", isActive: true, teamId: 1 },
  { id: 2, displayName: "Alex", email: "alex@example.test", isActive: true, teamId: 1 },
  { id: 3, displayName: "Alex", email: "alex2@example.test", isActive: true, teamId: 1 },
  { id: 4, displayName: "Outside", email: "outside@example.test", isActive: true, teamId: 2 },
  { id: 5, displayName: "Inactive", email: "inactive@example.test", isActive: false, teamId: 1 },
  { id: 6, displayName: "No team", email: "none@example.test", isActive: true, teamId: null },
];

test("reviewed draft IDs survive both parsers including explicit empty selections", () => {
  for (const ids of [[], [2, 3], [2, 2]]) {
    const tasks = [{ title: "Task", assignedToName: "Reviewer", assigneeIds: ids, sprintId: null }];
    assert.deepEqual(validateProposal({ type: "create_task", tasks })?.tasks[0].assigneeIds, ids);
    assert.deepEqual(reviewedProposalSchema.parse({ tasks }).tasks[0].assigneeIds, ids);
    assert.deepEqual(resolveProposalAssignments(tasks, users, 1), [Array.from(new Set(ids))]);
  }
  assert.equal(validateProposal({ type: "create_task", tasks: [{ title: "Old", assignedToName: "Alex" }] })?.tasks[0].assignedToName, "Alex");
  const normalized = reviewedProposalSchema.parse({ tasks: [{
    title: "  Old  ", description: " \n## Header\n\nContent\n ", projectName: " Project ", milestoneName: " Milestone ",
    dueDate: " 2026-12-31 ", assignedToName: " Reviewer ", assigneeIds: [],
  }] }).tasks[0];
  assert.equal(normalized.description, "## Header\n\nContent");
  assert.equal(normalized.projectName, "Project");
  assert.equal(normalized.milestoneName, "Milestone");
  assert.equal(normalized.dueDate, "2026-12-31");
});

test("approval rejects any malformed row rather than partially approving a batch", () => {
  for (const ids of [[-1], [1.5], ["2"], null]) {
    assert.equal(reviewedProposalSchema.safeParse({ tasks: [{ title: "Valid", assigneeIds: [] }, { title: "Invalid", assigneeIds: ids }] }).success, false);
  }
  assert.equal(reviewedProposalSchema.safeParse({ tasks: [{ title: "Valid" }, { title: " " }] }).success, false);
});

test("only active same-team users are eligible, never all no-team users", () => {
  assert.deepEqual(eligibleProposalUsers(users, users[0]).map(user => user.id), [1, 2, 3]);
  assert.deepEqual(eligibleProposalUsers(users, users[5]), []);
  assert.deepEqual(eligibleProposalUsers(users, undefined), []);
});

test("legacy matching is eligible and unambiguous; exact matches precede partials", () => {
  assert.deepEqual(legacyProposalAssignment(" review ", users, users[0]).ids, [1]);
  assert.match(legacyProposalAssignment("Alex", users, users[0]).warning!, /ambiguous/);
  for (const name of ["Outside", "Inactive", "Missing"]) {
    assert.match(legacyProposalAssignment(name, users, users[0]).warning!, /unavailable/);
  }
  assert.deepEqual(resolveProposalAssignments([{ title: "Old" }], users, 1), [[1]]);
  assert.deepEqual(resolveProposalAssignments([{ title: "Old" }], users, 6), [[]]);
  assert.throws(() => resolveProposalAssignments([{ title: "Old", assignedToName: "Alex" }], users, 1), /ambiguous/);
});

test("all selections are validated against refreshed reviewer and member status before creation", () => {
  const drafts = [{ title: "First", assigneeIds: [2] }, { title: "Second", assigneeIds: [3, 4] }];
  assert.throws(() => resolveProposalAssignments(drafts, users, 1), /Task 2.*Outside.*Remove/);
  for (const change of [{ teamId: 2 }, { isActive: false }]) {
    const refreshed = users.map(user => user.id === 2 ? { ...user, ...change } : user);
    assert.throws(() => resolveProposalAssignments([{ title: "Stale", assigneeIds: [2] }], refreshed, 1), /no longer eligible/);
  }
  const movedReviewer = users.map(user => user.id === 1 ? { ...user, teamId: 2 } : user);
  assert.throws(() => resolveProposalAssignments([{ title: "Stale", assigneeIds: [2] }], movedReviewer, 1), /no longer eligible/);
  assert.throws(() => resolveProposalAssignments([{ title: "Deleted", assigneeIds: [99] }], users, 1), /User #99/);
  assert.throws(() => resolveProposalAssignments([], users.map(user => ({ ...user, isActive: false })), 1), /account is no longer active/);
});
