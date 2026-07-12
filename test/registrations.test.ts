import { strict as assert } from "node:assert";
import { test } from "node:test";
import { validateRegistration } from "../convex/registrations.js";

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
