import { strict as assert } from "node:assert";
import { test } from "node:test";

process.env.CONVEX_URL ??= "https://example.convex.cloud";
process.env.TRACE_INGEST_KEY ??= "test-ingest-key";
process.env.TELEGRAM_BOT_TOKEN ??= "test-bot-token";

const { BOT_COMMANDS, parseTelegramCommand } = await import("../src/channels/telegram.js");

test("registers the complete BotFather command surface with honest descriptions", () => {
  assert.deepEqual(
    BOT_COMMANDS.map(({ command }) => command),
    ["start", "help", "ask", "research", "message", "status", "cost", "dashboard", "book", "publish"],
  );
  assert.match(BOT_COMMANDS.find(({ command }) => command === "book")?.description ?? "", /not live yet/i);
  assert.match(BOT_COMMANDS.find(({ command }) => command === "publish")?.description ?? "", /not live yet/i);
});

test("parses supported commands case-insensitively and strips bot usernames", () => {
  assert.deepEqual(parseTelegramCommand("  /ASK@SwitchboardBot   find this  "), {
    command: "ask",
    argument: "find this",
  });
  assert.deepEqual(parseTelegramCommand("/research current AI agency news"), {
    command: "research",
    argument: "current AI agency news",
  });
});

test("keeps ordinary and unknown-command text on the Manager path", () => {
  assert.equal(parseTelegramCommand("please research this"), null);
  assert.equal(parseTelegramCommand("/unknown do something"), null);
});

test("recognizes no-argument commands without inventing an argument", () => {
  assert.deepEqual(parseTelegramCommand("/status"), { command: "status", argument: "" });
  assert.deepEqual(parseTelegramCommand("/help   "), { command: "help", argument: "" });
});
