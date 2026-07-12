import { strict as assert } from "node:assert";
import { test } from "node:test";
import { evaluateRateLimit, validateRegistration } from "../convex/registrations.js";

test("accepts a normalized email with optional name and company", () => {
  assert.deepEqual(validateRegistration({
    email: "  Person@Example.COM ",
    name: "  Ada Lovelace ",
    company: "  Analytical Engines  ",
  }), {
    email: "person@example.com",
    name: "Ada Lovelace",
    company: "Analytical Engines",
  });
});

test("requires a valid email and bounds optional registration fields", () => {
  for (const value of [
    {},
    { email: "not-an-email" },
    { email: "person@example.com", name: 42 },
    { email: "person@example.com", company: "x".repeat(161) },
  ]) {
    assert.throws(() => validateRegistration(value));
  }
});

test("registration rate limits reset by window and reject excess attempts", () => {
  const first = evaluateRateLimit(null, 1_000, 2, 60_000);
  assert.equal(first.allowed, true);
  const second = evaluateRateLimit(first.next, 2_000, 2, 60_000);
  assert.equal(second.allowed, true);
  const blocked = evaluateRateLimit(second.next, 3_000, 2, 60_000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 58_000);
  const reset = evaluateRateLimit(second.next, 61_000, 2, 60_000);
  assert.deepEqual(reset, { allowed: true, next: { windowStartedAt: 61_000, attempts: 1 }, retryAfterMs: 0 });
});
