import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseTelegramCommand, resolveTelegramCommand } from "../src/channels/telegram.js";

test("parses a Telegram command with an optional bot suffix", () => {
  assert.deepEqual(
    parseTelegramCommand("/research@switchboard_bot agent reliability"),
    { command: "research", argument: "agent reliability" },
  );
});

test("does not treat plain-English requests as commands", () => {
  assert.equal(parseTelegramCommand("Research agent reliability"), null);
});

test("routes an explicit booking command through the manager", async () => {
  assert.deepEqual(
    await resolveTelegramCommand({ command: "book", argument: "the next available slot" }, "123"),
    { prompt: "Book this calendar request: the next available slot" },
  );
});
