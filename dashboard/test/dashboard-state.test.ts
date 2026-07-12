import assert from "node:assert/strict";
import test from "node:test";
import { isDashboardLoading } from "../src/dashboard-state";

const run = { runId: "run-1" };
const runData = { nodes: [] };

test("dashboard stays loading until initial runs resolve", () => {
  assert.equal(isDashboardLoading(undefined, undefined, undefined), true);
});

test("dashboard stays loading while a non-empty run list awaits selection", () => {
  assert.equal(isDashboardLoading([run], undefined, undefined), true);
});

test("dashboard stays loading while selected run data resolves", () => {
  assert.equal(isDashboardLoading([run], run, undefined), true);
});

test("dashboard is empty only after an empty run list resolves", () => {
  assert.equal(isDashboardLoading([], undefined, undefined), false);
});

test("dashboard is ready once selected run data resolves", () => {
  assert.equal(isDashboardLoading([run], run, runData), false);
});
