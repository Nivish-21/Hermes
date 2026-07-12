import assert from "node:assert/strict";
import test from "node:test";
import { buildTraceForest, type TraceNodeView } from "../src/trace-tree";

const node = (overrides: Partial<TraceNodeView> & Pick<TraceNodeView, "id" | "kind" | "ts">): TraceNodeView => ({
  runId: "run-internal",
  model: "model",
  promptTok: 10,
  complTok: 5,
  costUsd: 0.01,
  latencyMs: 100,
  verifyPass: undefined,
  parentId: undefined,
  ...overrides,
});

test("buildTraceForest nests trace nodes by parentId in timestamp order", () => {
  const forest = buildTraceForest([
    node({ id: "verify", kind: "verify", parentId: "specialist", ts: 30 }),
    node({ id: "manager", kind: "manager", ts: 10 }),
    node({ id: "specialist", kind: "specialist", parentId: "manager", ts: 20 }),
  ]);

  assert.deepEqual(
    forest.map((branch) => ({
      id: branch.node.id,
      children: branch.children.map((child) => ({
        id: child.node.id,
        children: child.children.map((grandchild) => grandchild.node.id),
      })),
    })),
    [{ id: "manager", children: [{ id: "specialist", children: ["verify"] }] }],
  );
});

test("buildTraceForest keeps orphaned sanitized nodes visible as roots", () => {
  const forest = buildTraceForest([
    node({ id: "manager", kind: "manager", ts: 10 }),
    node({ id: "orphan", kind: "verify", parentId: "missing", ts: 20 }),
  ]);

  assert.deepEqual(forest.map((branch) => branch.node.id), ["manager", "orphan"]);
});
