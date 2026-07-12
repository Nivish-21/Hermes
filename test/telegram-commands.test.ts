import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { ManagedRunResult } from "../src/manager/manager.js";
import type { TelegramHandlerDependencies } from "../src/channels/telegram.js";

process.env.CONVEX_URL ??= "https://example.convex.cloud";
process.env.TRACE_INGEST_KEY ??= "test-ingest-key";
process.env.TELEGRAM_BOT_TOKEN ??= "test-bot-token";

const {
  BOT_COMMANDS,
  configuredDashboardUrl,
  createTelegramUpdateHandler,
  parseTelegramCommand,
  registerTelegramCommands,
} = await import("../src/channels/telegram.js");

type DirectCall = { template: "research" | "messaging"; instruction: string };
type Completion = { updateId: number; status: "succeeded" | "failed"; runId?: string; error?: string };

function update(text: string, senderId = 42): unknown {
  return {
    update_id: 10,
    message: {
      message_id: 20,
      date: 1_700_000_000,
      text,
      from: { id: senderId },
      chat: { id: senderId, type: "private" },
    },
  };
}

function successfulRun(transcript: string, runId = "run-1"): ManagedRunResult {
  return {
    request: {
      id: "request-1",
      runId,
      channel: "text",
      requester: "42",
      transcript,
      ts: 1_700_000_000_000,
    },
    result: {
      taskId: "task-1",
      runId,
      status: "success",
      evidence: {},
      attempts: 1,
      modelPath: [],
      costUsd: 0,
      latencyMs: 0,
    },
  };
}

function harness(options: { claimed?: boolean; dashboardUrl?: string | null; replyError?: Error } = {}): {
  handle: ReturnType<typeof createTelegramUpdateHandler>;
  managerTranscripts: string[];
  directCalls: DirectCall[];
  replies: string[];
  replyRecipients: string[];
  completions: Completion[];
  claims: number[];
} {
  const managerTranscripts: string[] = [];
  const directCalls: DirectCall[] = [];
  const replies: string[] = [];
  const replyRecipients: string[] = [];
  const completions: Completion[] = [];
  const claims: number[] = [];
  const dependencies: TelegramHandlerDependencies = {
    allowedUserIds: new Set(["42"]),
    dashboardUrl: options.dashboardUrl ?? null,
    claimUpdate: async (textUpdate) => {
      claims.push(textUpdate.updateId);
      return { claimed: options.claimed ?? true };
    },
    completeUpdate: async (updateId, status, runId, error) => {
      completions.push({
        updateId,
        status,
        ...(runId === undefined ? {} : { runId }),
        ...(error === undefined ? {} : { error }),
      });
    },
    sendPrivateReply: async (requester, text) => {
      if (options.replyError !== undefined) {
        throw options.replyError;
      }
      replyRecipients.push(requester);
      replies.push(text);
    },
    manageRequest: async (incoming) => {
      managerTranscripts.push(incoming.transcript);
      return successfulRun(incoming.transcript);
    },
    runDirectTask: async (_textUpdate, template, instruction) => {
      directCalls.push({ template, instruction });
      return successfulRun(instruction, `run-${template}`);
    },
    latestRequesterActivity: async () => null,
  };
  return {
    handle: createTelegramUpdateHandler(dependencies),
    managerTranscripts,
    directCalls,
    replies,
    replyRecipients,
    completions,
    claims,
  };
}

test("registers the complete BotFather command surface with honest descriptions", () => {
  assert.deepEqual(
    BOT_COMMANDS.map(({ command }) => command),
    ["start", "help", "ask", "research", "message", "status", "cost", "dashboard", "book", "publish"],
  );
  assert.match(BOT_COMMANDS.find(({ command }) => command === "book")?.description ?? "", /not live yet/i);
  assert.match(BOT_COMMANDS.find(({ command }) => command === "publish")?.description ?? "", /not live yet/i);
});

test("live command registration still calls Telegram setMyCommands", { concurrency: false }, async () => {
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? JSON.parse(init.body) as unknown : init?.body,
    });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await registerTelegramCommands();
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.equal(calls.length, 1);
  assert.match(calls[0]?.url ?? "", /\/setMyCommands$/);
  assert.deepEqual(calls[0]?.body, { commands: BOT_COMMANDS });
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

test("requires an explicit valid HTTPS dashboard deployment URL", () => {
  assert.equal(configuredDashboardUrl(undefined), null);
  assert.equal(configuredDashboardUrl("   "), null);
  assert.equal(configuredDashboardUrl("not-a-url"), null);
  assert.equal(configuredDashboardUrl("http://dashboard.example.com"), null);
  assert.equal(configuredDashboardUrl("https://dashboard.example.com/path"), "https://dashboard.example.com/path");
});

test("/start and /help reply immediately without invoking the Manager", async () => {
  for (const command of ["/start", "/help"]) {
    const state = harness();
    assert.equal(await state.handle(update(command)), null);
    assert.equal(state.managerTranscripts.length, 0);
    assert.equal(state.directCalls.length, 0);
    assert.match(state.replies[0] ?? "", /Switchboard commands/);
    assert.deepEqual(state.completions, [{ updateId: 10, status: "succeeded" }]);
  }
});

test("/ask strips its prefix and sends only the argument to the Manager", async () => {
  const state = harness();
  await state.handle(update("/ask   compare these vendors"));
  assert.deepEqual(state.managerTranscripts, ["compare these vendors"]);
  assert.equal(state.directCalls.length, 0);
  assert.deepEqual(state.completions, [{ updateId: 10, status: "succeeded", runId: "run-1" }]);
});

test("/research and /message take deterministic direct specialist paths", async () => {
  const research = harness();
  await research.handle(update("/research current agency news"));
  assert.deepEqual(research.directCalls, [{ template: "research", instruction: "current agency news" }]);
  assert.equal(research.managerTranscripts.length, 0);

  const message = harness();
  await message.handle(update("/message launch complete"));
  assert.deepEqual(message.directCalls, [{ template: "messaging", instruction: "launch complete" }]);
  assert.equal(message.managerTranscripts.length, 0);
  assert.match(message.replies[0] ?? "", /Message task finished with status: success/);
});

test("/dashboard reports unavailable until an explicit deployment is configured", async () => {
  const unavailable = harness();
  await unavailable.handle(update("/dashboard"));
  assert.match(unavailable.replies[0] ?? "", /unavailable|not live/i);
  assert.doesNotMatch(unavailable.replies[0] ?? "", /pages\.dev/);

  const configured = harness({ dashboardUrl: "https://dashboard.example.com" });
  await configured.handle(update("/dashboard"));
  assert.equal(configured.replies[0], "Live Switchboard dashboard: https://dashboard.example.com");
});

test("/book and /publish remain honest pending fast paths", async () => {
  for (const command of ["book", "publish"]) {
    const state = harness();
    await state.handle(update(`/${command}`));
    assert.equal(state.managerTranscripts.length, 0);
    assert.equal(state.directCalls.length, 0);
    assert.match(state.replies[0] ?? "", new RegExp(`/${command} is not live yet`, "i"));
  }
});

test("allowlist, durable claim, completion, and private reply gates are enforced", async () => {
  const disallowed = harness();
  assert.equal(await disallowed.handle(update("/help", 99)), null);
  assert.equal(disallowed.claims.length, 0);
  assert.equal(disallowed.replies.length, 0);

  const duplicate = harness({ claimed: false });
  assert.equal(await duplicate.handle(update("/help")), null);
  assert.deepEqual(duplicate.claims, [10]);
  assert.equal(duplicate.replies.length, 0);
  assert.equal(duplicate.completions.length, 0);

  const allowed = harness();
  await allowed.handle(update("/help"));
  assert.deepEqual(allowed.claims, [10]);
  assert.equal(allowed.replies.length, 1);
  assert.deepEqual(allowed.replyRecipients, ["42"]);
  assert.deepEqual(allowed.completions, [{ updateId: 10, status: "succeeded" }]);
});

test("a reply failure terminalizes the durable claim as failed", async () => {
  const state = harness({ replyError: new Error("Telegram send failed") });
  await assert.rejects(state.handle(update("/help")), /Telegram send failed/);
  assert.deepEqual(state.completions, [{
    updateId: 10,
    status: "failed",
    error: "Telegram send failed",
  }]);
});
