import { strict as assert } from "node:assert";
import { test } from "node:test";
import { totalRequesterCosts } from "../convex/requesterActivity.js";

test("requester costs sum routed spend and frontier estimates without exposing request data", () => {
  assert.deepEqual(
    totalRequesterCosts([
      { costUsd: 0.01, frontierCostUsd: 0.04 },
      { costUsd: 0.02 },
    ]),
    { routedCostUsd: 0.03, frontierEstimateUsd: 0.06 },
  );
});
