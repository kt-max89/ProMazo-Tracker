import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { appendReflectionSchema, type InsertSprintReflection } from "../shared/schema";

test("reflection additions accept partial/blank fields but reject forged identity and targets", () => {
  assert.equal(appendReflectionSchema.safeParse({ additions: [{ field: "impact", text: "  new impact  " }] }).success, true);
  const parsed = appendReflectionSchema.parse({ additions: [{ field: "summary", text: "  " }, { field: "impact", text: " new " }] });
  assert.deepEqual(parsed.additions, [{ field: "impact", text: "new" }]);
  for (const body of [
    { additions: [] }, { additions: [{ field: "summary", text: " " }] },
    { additions: [{ field: "impact", text: "x", authorId: 1 }] },
    { additions: [{ field: "impact", text: "x" }], sprintId: 1 },
    { additions: [{ field: "wasteDescription", text: "x" }] },
    { additions: [{ field: "newWaste", text: "x" }] },
    { additions: [{ field: "summary", text: "x", wasteIndex: 0 }] },
    { additions: [{ field: "wasteDescription", text: "x", wasteIndex: 0, wasteAdditionId: 1 }] },
  ]) assert.equal(appendReflectionSchema.safeParse(body).success, false);
});

test("reflection persistence, owner appends, per-sprint gates, and chatbot authorization", {
  skip: !process.env.DATABASE_URL && "DATABASE_URL is not configured",
}, async () => {
  const { pool } = await import("../server/db");
  const { applyReflectionSchema } = await import("../server/reflectionMigration");
  const { appendReflection, createReflection, getReflection, listReflections, reflectionAccess } = await import("../server/reflectionService");
  const { runSeeTeamTool } = await import("../server/seeTeamTool");
  const suffix = randomUUID();
  const userIds: number[] = [], sprintIds: number[] = [];
  try {
    const users = await pool.query(`INSERT INTO users(email,password_hash,display_name,role)
      VALUES ($1,'test','Owner','user'),($2,'test','Viewer','user'),($3,'test','Admin','admin') RETURNING id,role,display_name`,
    [`owner-${suffix}@example.test`, `viewer-${suffix}@example.test`, `admin-${suffix}@example.test`]);
    userIds.push(...users.rows.map(row => row.id));
    const [owner, viewer, admin] = users.rows.map(row => ({ id: row.id, role: row.role, displayName: row.display_name }));
    const sprints = await pool.query("INSERT INTO sprints(number) VALUES ($1),($2) RETURNING id,number", [1000000 + Math.floor(Math.random() * 1000000), 2100000 + Math.floor(Math.random() * 1000000)]);
    sprintIds.push(...sprints.rows.map(row => row.id));
    const input: InsertSprintReflection = {
      sprintId: sprintIds[0], summary: `secret-${suffix}`,
      wastes: [{ category: "wastefulness", description: "Original waste" }, { category: "overload", description: "Second waste" }],
      kaizenWhat: "Original what", kaizenWhy: "Original why", kaizenDone: "Original done", impact: "Original impact",
    };
    const original = await createReflection({ ...input, authorId: owner.id, authorName: owner.displayName });
    const duplicate = await createReflection({ ...input, authorId: owner.id, authorName: owner.displayName });
    const lockedOther = await createReflection({ ...input, sprintId: sprintIds[1], authorId: owner.id, authorName: owner.displayName });
    // Existing invalid submissions are preserved but do not unlock peers.
    await pool.query(`INSERT INTO reflections(author_id,author_name,sprint_id,summary,wastes,kaizen_what,kaizen_why,kaizen_done,impact)
      VALUES($1,'Viewer',$2,'Invalid','[]','x','x','x','x')`, [viewer.id, sprintIds[0]]);
    assert.equal((await reflectionAccess(viewer)).find(row => row.sprintId === sprintIds[0])?.canRead, false);
    assert.equal((await reflectionAccess(admin)).find(row => row.sprintId === sprintIds[0])?.canRead, true);
    for (const options of [{}, { limit: 10 }, { sprintId: sprintIds[0] }, { authorId: owner.id }, { sprintId: sprintIds[0], authorId: owner.id }]) {
      assert.equal((await listReflections(viewer, options)).some(row => row.authorId === owner.id), false);
    }
    await assert.rejects(getReflection(viewer, original.id), /Submit your own reflection/);
    assert.equal((await getReflection(admin, original.id)).summary, input.summary);
    for (const actor of [viewer, admin]) {
      await assert.rejects(appendReflection(actor, original.id, { additions: [{ field: "summary", text: "forged" }] }), /Only the author/);
    }
    await assert.rejects(appendReflection(owner, 2147483647, { additions: [{ field: "summary", text: "x" }] }), /not found/);
    await assert.rejects(appendReflection(owner, original.id, { additions: [{ field: "wasteDescription", wasteIndex: 500, text: "x" }] }), /Waste target/);
    await assert.rejects(appendReflection(owner, original.id, { authorId: admin.id, additions: [{ field: "summary", text: "x" }] }), /Unrecognized key/);
    await assert.rejects(appendReflection(owner, original.id, { additions: [{ field: "summary", text: input.summary }] }), /unchanged/);
    const first = await appendReflection(owner, original.id, { additions: [
      { field: "summary", text: " Added summary " }, { field: "impact", text: " " },
      { field: "wasteDescription", wasteIndex: 0, text: "Waste follow-up" },
      { field: "newWaste", category: "imbalance", text: "Added waste" },
    ] });
    assert.equal(first.additions?.length, 3);
    const addedWaste = first.additions!.find(item => item.field === "newWaste")!;
    await appendReflection(owner, original.id, { additions: [
      { field: "kaizenWhat", text: "Added what" }, { field: "kaizenWhy", text: "Added why" },
      { field: "kaizenDone", text: "Added done" }, { field: "impact", text: "Added impact" },
      { field: "wasteDescription", wasteAdditionId: addedWaste.id, text: "Added waste context" },
    ] });
    await assert.rejects(appendReflection(owner, duplicate.id, { additions: [{ field: "wasteDescription", wasteAdditionId: addedWaste.id, text: "cross-reflection target" }] }), /Waste target/);
    await assert.rejects(appendReflection(owner, original.id, { additions: [{ field: "summary", text: "Added summary" }] }), /unchanged/);
    await Promise.all(["Concurrent A", "Concurrent B"].map(text => appendReflection(owner, original.id, { additions: [{ field: "summary", text }] })));
    const final = await getReflection(owner, original.id);
    assert.equal(final.additions?.length, 10);
    assert.equal(final.summary, original.summary);
    assert.deepEqual(final.wastes, original.wastes);
    assert.equal(final.kaizenWhat, original.kaizenWhat);
    assert.equal(final.createdAt, original.createdAt);
    assert.ok(final.additions?.every(item => item.authorId === owner.id && item.createdAt && item.authorName === "Owner"));
    // Idempotent additive migration never modifies old submissions or history.
    const before = await pool.query("SELECT * FROM reflections WHERE sprint_id = ANY($1::int[]) ORDER BY id", [sprintIds]);
    await applyReflectionSchema(pool); await applyReflectionSchema(pool);
    assert.deepEqual((await pool.query("SELECT * FROM reflections WHERE sprint_id = ANY($1::int[]) ORDER BY id", [sprintIds])).rows, before.rows);
    assert.deepEqual((await getReflection(owner, original.id)).additions, final.additions);
    const storage = { getAllUsers: async () => [] } as unknown as import("../server/storage").IStorage;
    for (const args of [
      { include: ["reflections"] as ("reflections")[] },
      { include: ["reflections"] as ("reflections")[], sprintNumber: sprints.rows[0].number, person: "Owner", query: suffix },
      { include: ["reflections"] as ("reflections")[], currentSprint: true },
    ]) {
      const result = await runSeeTeamTool(args, storage, viewer, { getSettings: async () => ({ currentSprintId: sprintIds[0] }) });
      assert.ok(!result.content.includes(input.summary));
      assert.match(result.content, /Submit your own valid reflection/);
    }
    const submission = await createReflection({ ...input, summary: "Viewer submission", authorId: viewer.id, authorName: viewer.displayName });
    assert.equal((await reflectionAccess(viewer)).find(row => row.sprintId === sprintIds[0])?.canRead, true);
    assert.equal((await reflectionAccess(viewer)).find(row => row.sprintId === sprintIds[1])?.canRead, false);
    assert.equal((await getReflection(viewer, original.id)).additions?.length, 10);
    await assert.rejects(getReflection(viewer, lockedOther.id), /Submit your own reflection/);
    const authorized = await listReflections(viewer, { sprintId: sprintIds[0], authorId: owner.id, limit: 10 });
    assert.deepEqual(authorized.map(row => row.id).sort(), [original.id, duplicate.id].sort());
    const context = await runSeeTeamTool({ include: ["reflections"], sprintNumber: sprints.rows[0].number, query: "Concurrent" }, storage, viewer);
    assert.match(context.content, /Concurrent A/); assert.match(context.content, /Concurrent B/);
    assert.match(context.content, /Addition .*Sprint summary/);
    const adminContext = await runSeeTeamTool({ include: ["reflections"], sprintNumber: sprints.rows[1].number }, storage, admin);
    assert.ok(adminContext.content.includes(input.summary));
    // Any remaining valid duplicate continues to satisfy access.
    await createReflection({ ...input, authorId: viewer.id, authorName: viewer.displayName });
    await pool.query("DELETE FROM reflections WHERE id=$1", [submission.id]);
    assert.equal((await reflectionAccess(viewer)).find(row => row.sprintId === sprintIds[0])?.canRead, true);
  } finally {
    await pool.query("DELETE FROM reflections WHERE sprint_id=ANY($1::int[])", [sprintIds]);
    await pool.query("DELETE FROM sprints WHERE id=ANY($1::int[])", [sprintIds]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [userIds]);
  }
});
