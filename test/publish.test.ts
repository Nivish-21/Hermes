import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { Task } from "../src/lib/types.js";

process.env.CONVEX_URL ??= "https://example.convex.cloud";
process.env.TRACE_INGEST_KEY ??= "test-ingest-key";
process.env.CHEAP_MODEL_ID ??= "test-cheap-model";
process.env.MANAGER_MODEL_ID ??= "test-manager-model";
process.env.CLOUDFLARE_ACCOUNT_ID = "account-id";
process.env.CLOUDFLARE_API_TOKEN = "api-token";
process.env.CLOUDFLARE_KV_NAMESPACE_ID = "namespace-id";
process.env.CLOUDFLARE_PUBLISH_KEY = "live-content";
process.env.CLOUDFLARE_PUBLISH_LIVE_URL = "https://publish.example.com/";

const { createPublishDefinition, normalizePublishInstruction } = await import("../src/specialists/publish.js");

const task: Task = {
  id: "publish-task",
  runId: "publish-run",
  requestId: "publish-request",
  template: "publish",
  params: {},
};

test("publish instructions are canonical JSON with content only", () => {
  assert.equal(
    normalizePublishInstruction('{"content":"<h1>New release</h1>"}'),
    '{"content":"<h1>New release</h1>"}',
  );
  assert.throws(() => normalizePublishInstruction("plain text"), /structured JSON/);
  assert.throws(() => normalizePublishInstruction('{"content":"   "}'), /cannot be empty/);
  assert.throws(
    () => normalizePublishInstruction('{"content":"safe","url":"https://attacker.example"}'),
    /only the content field/,
  );
});

test("publish writes KV once and verifies expected content from a fresh live fetch", async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  let published = false;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, ...(typeof init?.body === "string" ? { body: init.body } : {}) });
    if (url.startsWith("https://api.cloudflare.com/") && method === "PUT") {
      published = true;
      return Response.json({ success: true, errors: [], messages: [], result: {} });
    }
    return new Response(published ? "new content" : "old content", { status: 200 });
  };
  const definition = createPublishDefinition("new content", task, fetcher);

  const state = await definition.observe({ task, requester: "owner" });
  const action = await definition.act(state, "test-model", { task, requester: "owner" });
  const verification = await definition.verify(action, { task, requester: "owner" });

  assert.equal(verification.ok, true);
  assert.equal(verification.evidence.httpStatus, 200);
  assert.equal(verification.evidence.contentMatched, true);
  assert.equal(verification.evidence.deploymentAttempted, true);
  assert.equal(calls.filter((call) => call.method === "PUT").length, 1);
  assert.equal(calls.find((call) => call.method === "PUT")?.body, "new content");
  assert.match(calls[0]?.url ?? "", /switchboard_observe=/);
  assert.match(calls.at(-1)?.url ?? "", /switchboard_version=/);
});

test("an ambiguous write outcome is durably checkpointed before PUT and retains deployment evidence", async () => {
  let putCount = 0;
  let writeStarted = false;
  const events: string[] = [];
  const checkpoints: unknown[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (!url.startsWith("https://api.cloudflare.com/") && method === "GET") {
      if (writeStarted) {
        throw new TypeError("live verification connection reset");
      }
      return new Response("old content", { status: 200 });
    }
    if (method === "PUT") {
      events.push("put");
      putCount += 1;
      writeStarted = true;
      throw new TypeError("network connection reset");
    }
    throw new Error("unexpected fetch");
  };
  const definition = createPublishDefinition("new content", task, fetcher, {
    saveCheckpoint: async (checkpoint: unknown): Promise<void> => {
      events.push("checkpoint");
      checkpoints.push(checkpoint);
    },
  });
  const state = await definition.observe({ task, requester: "owner" });
  const action = await definition.act(state, "test-model", { task, requester: "owner" });
  const verification = await definition.verify(action, { task, requester: "owner" });
  const retryAction = await definition.act(state, "test-model", { task, requester: "owner" });

  assert.deepEqual(events, ["checkpoint", "put"]);
  assert.deepEqual(checkpoints, [{
    liveUrl: "https://publish.example.com/",
    kvKey: "live-content",
    version: action.version,
    deploymentAttempted: true,
  }]);
  assert.equal(verification.ok, false);
  assert.equal(verification.evidence.deploymentAttempted, true);
  assert.equal(verification.evidence.version, action.version);
  assert.equal(verification.evidence.liveUrl, "https://publish.example.com/");
  assert.strictEqual(retryAction, action);
  assert.equal(putCount, 1);
});

test("publish verification backs off between fresh reads until propagated content is visible", async () => {
  let putCount = 0;
  let observationReads = 0;
  let verificationReads = 0;
  const verificationUrls: string[] = [];
  const delays: number[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "PUT") {
      putCount += 1;
      return Response.json({ success: true, errors: [], messages: [], result: {} });
    }
    if (url.includes("switchboard_version=")) {
      verificationReads += 1;
      verificationUrls.push(url);
      return new Response(verificationReads >= 3 ? "new content" : "old content", { status: 200 });
    }
    observationReads += 1;
    return new Response("old content", { status: 200 });
  };
  const definition = createPublishDefinition("new content", task, fetcher, {
    verificationBackoffMs: [0, 25, 50],
    sleep: async (delayMs: number): Promise<void> => {
      delays.push(delayMs);
    },
  });

  let action = await definition.act(
    await definition.observe({ task, requester: "owner" }),
    "test-model",
    { task, requester: "owner" },
  );
  let verification = await definition.verify(action, { task, requester: "owner" });
  assert.equal(verification.ok, false);

  for (let attempt = 2; attempt <= 3; attempt += 1) {
    const retryAction = await definition.act(
      await definition.observe({ task, requester: "owner" }),
      "test-model",
      { task, requester: "owner" },
    );
    assert.strictEqual(retryAction, action);
    action = retryAction;
    verification = await definition.verify(action, { task, requester: "owner" });
  }

  assert.equal(verification.ok, true);
  assert.equal(observationReads, 1);
  assert.equal(verificationReads, 3);
  assert.equal(new Set(verificationUrls).size, 3);
  assert.deepEqual(
    verificationUrls.map((url) => new URL(url).searchParams.get("switchboard_verify_attempt")),
    ["1", "2", "3"],
  );
  assert.deepEqual(delays, [25, 50]);
  assert.equal(putCount, 1);
});

test("publish never sends PUT when the durable checkpoint fails", async () => {
  let putCount = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    if ((init?.method ?? "GET") === "PUT") {
      putCount += 1;
      return Response.json({ success: true });
    }
    return new Response("old content", { status: 200 });
  };
  const definition = createPublishDefinition("new content", task, fetcher, {
    saveCheckpoint: async (): Promise<void> => {
      throw new Error("Convex checkpoint unavailable");
    },
  });

  await assert.rejects(
    definition.act(
      await definition.observe({ task, requester: "owner" }),
      "test-model",
      { task, requester: "owner" },
    ),
    /Convex checkpoint unavailable/,
  );
  assert.equal(putCount, 0);
});

test("a retry reuses content already visible on the live surface instead of republishing", async () => {
  let currentContent = "old content";
  let putCount = 0;
  let verificationFailed = false;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "PUT") {
      putCount += 1;
      currentContent = String(init?.body);
      return Response.json({ success: true, errors: [], messages: [], result: {} });
    }
    if (url.includes("switchboard_version=") && !verificationFailed) {
      verificationFailed = true;
      return new Response(currentContent, { status: 503 });
    }
    return new Response(currentContent, { status: 200 });
  };
  const definition = createPublishDefinition("new content", task, fetcher);
  const firstState = await definition.observe({ task, requester: "owner" });
  const firstAction = await definition.act(firstState, "test-model", { task, requester: "owner" });
  const failedVerification = await definition.verify(firstAction, { task, requester: "owner" });
  assert.equal(failedVerification.ok, false);

  const retryState = await definition.observe({ task, requester: "owner" });
  const retryAction = await definition.act(retryState, "test-model", { task, requester: "owner" });

  assert.strictEqual(retryAction, firstAction);
  assert.equal(retryAction.alreadyPublished, false);
  assert.equal(putCount, 1);
});
