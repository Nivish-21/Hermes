import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseManagerPlan } from "../src/manager/manager.js";

test("accepts implemented specialists", () => {
  assert.deepEqual(
    parseManagerPlan(JSON.stringify({ specialist: "booking", instruction: "{\"mode\":\"next_available\"}" })),
    { specialist: "booking", instruction: "{\"mode\":\"next_available\"}" },
  );
  assert.deepEqual(
    parseManagerPlan(JSON.stringify({ specialist: "publish", instruction: "{\"content\":\"Hello\"}" })),
    { specialist: "publish", instruction: "{\"content\":\"Hello\"}" },
  );
});