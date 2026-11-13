import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Clock, AlertCircle, Flag, CheckCircle2 } from "lucide-react";
import { STATUSES, statusMeta } from "../client/src/lib/task-status-meta";
import { taskStatuses } from "../shared/schema";

test("shared board metadata preserves status values, ordering, labels and icons", () => {
  assert.deepEqual(STATUSES.map(status => status.value), [...taskStatuses]);
  assert.deepEqual(STATUSES.map(status => status.label), ["Not started", "In progress", "Needs review", "Done"]);
  assert.deepEqual(STATUSES.map(status => status.icon), [Clock, AlertCircle, Flag, CheckCircle2]);
  for (const status of STATUSES) assert.equal(statusMeta(status.value), status);
  assert.equal(statusMeta("unknown"), STATUSES[0]);
});

test("all status surfaces use gray, blue, green and purple with explicit theme variants", () => {
  const families = ["slate", "blue", "green", "purple"];
  STATUSES.forEach((status, index) => {
    const family = families[index];
    assert.equal(status.badgeColor, index === 0
      ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
      : `bg-${family}-100 text-${family}-700 dark:bg-${family}-900 dark:text-${family}-300`);
    assert.equal(status.columnBg, index === 0
      ? "bg-slate-50 dark:bg-slate-900/30"
      : `bg-${family}-50 dark:bg-${family}-950/30`);
    assert.equal(status.columnBorder, index === 0
      ? "border-slate-200 dark:border-slate-800"
      : `border-${family}-200 dark:border-${family}-900`);
    assert.equal(status.headerColor, index === 0
      ? "text-slate-600 dark:text-slate-400"
      : `text-${family}-700 dark:text-${family}-400`);
  });
});

test("both boards use shared metadata rather than a local status palette", () => {
  for (const page of ["tasks-page", "my-tasks-page"]) {
    const source = readFileSync(new URL(`../client/src/pages/${page}.tsx`, import.meta.url), "utf8");
    assert.match(source, /import \{[^}]*STATUSES[^}]*\} from "@\/lib\/task-status-meta"/);
    assert.doesNotMatch(source, /const STATUSES\s*=/);
    for (const property of ["columnBg", "columnBorder", "headerColor"]) {
      assert.ok(source.includes(`status.${property}`), `${page} uses shared ${property}`);
    }
  }
  const mainBoard = readFileSync(new URL("../client/src/pages/tasks-page.tsx", import.meta.url), "utf8");
  assert.match(mainBoard, /statusMeta\(task.status\)/);
  assert.match(mainBoard, /meta.badgeColor/);
});
