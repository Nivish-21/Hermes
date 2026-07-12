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

test("an ambiguous write outcome latches and can never issue a second KV write", async () => {
  let putCount = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (!url.startsWith("https://api.cloudflare.com/") && method === "GET") {
      return new Response("old content", { status: 200 });
    }
    if (method === "PUT") {
      putCount += 1;
      throw new TypeError("network connection reset");
    }
    throw new Error("unexpected fetch");
  };
  const definition = createPublishDefinition("new content", task, fetcher);
  const state = await definition.observe({ task, requester: "owner" });

  await assert.rejects(
    definition.act(state, "test-model", { task, requester: "owner" }),
    /network connection reset/,
  );
  await assert.rejects(
    definition.act(state, "test-model", { task, requester: "owner" }),
    /outcome is unknown; refusing to publish again/,
  );
  assert.equal(putCount, 1);
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

  assert.equal(retryAction.alreadyPublished, true);
  assert.equal(putCount, 1);
});
