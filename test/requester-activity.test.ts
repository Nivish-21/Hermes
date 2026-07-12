import { strict as assert } from "node:assert";
import { test } from "node:test";
import { assertIngestKey } from "../convex/ingest.js";
import { selectLatestRequesterRun, totalRequesterCosts } from "../convex/requesterActivity.js";

test("requester costs sum routed spend and frontier estimates without exposing request data", () => {
  assert.deepEqual(
    totalRequesterCosts([
      { costUsd: 0.01, frontierCostUsd: 0.04 },
      { costUsd: 0.02 },
    ]),
    { routedCostUsd: 0.03, frontierEstimateUsd: 0.06 },
  );
});

test("private requester selection filters by requester and chooses the latest request", () => {
  const selected = selectLatestRequesterRun([
    { requester: "alice", runId: "alice-old", ts: 100, transcript: "private old text" },
    { requester: "bob", runId: "bob-newest", ts: 500, transcript: "other private text" },
    { requester: "alice", runId: "alice-new", ts: 300, transcript: "private new text" },
  ], "alice");

  assert.deepEqual(selected, { runId: "alice-new", requestedAt: 300 });
  assert.deepEqual(Object.keys(selected ?? {}).sort(), ["requestedAt", "runId"]);
  assert.equal(selectLatestRequesterRun([], "alice"), null);
});

test("private requester activity requires the configured ingest key", { concurrency: false }, () => {
  const previous = process.env.TRACE_INGEST_KEY;
  try {
    process.env.TRACE_INGEST_KEY = "expected-ingest-key";
    assert.doesNotThrow(() => assertIngestKey("expected-ingest-key"));
    assert.throws(() => assertIngestKey("wrong-ingest-key"), /Unauthorized/);
  } finally {
    if (previous === undefined) {
      delete process.env.TRACE_INGEST_KEY;
    } else {
      process.env.TRACE_INGEST_KEY = previous;
    }
  }
});
