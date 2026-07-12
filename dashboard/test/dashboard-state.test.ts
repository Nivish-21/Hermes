import assert from "node:assert/strict";
import test from "node:test";
import { filterRunsByStatus, isDashboardLoading } from "../src/dashboard-state";

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

test("run filters preserve order and select only the requested status", () => {
  const runs = [
    { runId: "latest", status: "failed" },
    { runId: "prior", status: "success" },
    { runId: "active", status: "running" },
  ];

  assert.deepEqual(filterRunsByStatus(runs, "all"), runs);
  assert.deepEqual(filterRunsByStatus(runs, "success"), [runs[1]]);
  assert.deepEqual(filterRunsByStatus(runs, "failed"), [runs[0]]);
  assert.deepEqual(filterRunsByStatus(runs, "running"), [runs[2]]);
});
