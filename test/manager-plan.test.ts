import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseManagerPlan } from "../src/manager/manager.js";

test("rejects an unimplemented publish specialist", () => {
  assert.throws(
    () => parseManagerPlan(JSON.stringify({ specialist: "publish", instruction: "Publish this" })),
    /invalid routing plan/,
  );
});

test("accepts implemented specialists", () => {
  assert.deepEqual(
    parseManagerPlan(JSON.stringify({ specialist: "booking", instruction: "{\"mode\":\"next_available\"}" })),
    { specialist: "booking", instruction: "{\"mode\":\"next_available\"}" },
  );
});