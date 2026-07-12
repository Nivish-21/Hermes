import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseTelegramCommand } from "../src/channels/telegram.js";

test("parses a Telegram command with an optional bot suffix", () => {
  assert.deepEqual(
    parseTelegramCommand("/research@switchboard_bot agent reliability"),
    { command: "research", argument: "agent reliability" },
  );
});

test("does not treat plain-English requests as commands", () => {
  assert.equal(parseTelegramCommand("Research agent reliability"), null);
});
