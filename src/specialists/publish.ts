import { createHash } from "node:crypto";
import type { Task, TaskResult } from "../lib/types.js";
import { runOavr, type OavrContext, type OavrTask } from "./base.js";

const MAX_PUBLISH_CONTENT_BYTES = 25 * 1024 * 1024;
const DEFAULT_VERIFICATION_BACKOFF_MS: readonly number[] = [0, 30_000, 60_000];

type PublishInstruction = {
  content: string;
};

export type PublishState = {
  currentContent: string | null;
};

export type PublishAction = {
  content: string;
  version: string;
  alreadyPublished: boolean;
  deploymentAttempted: boolean;
};

export type PublishEvidence = {
  liveUrl: string;
  kvKey: string;
  version: string;
  httpStatus: number;
  contentMatched: boolean;
  alreadyPublished: boolean;
  deploymentAttempted: boolean;
  verifiedByFreshRead: boolean;
};

export type PublishCheckpoint = Pick<
  PublishEvidence,
  "liveUrl" | "kvKey" | "version" | "deploymentAttempted"
>;

type PublishOptions = {
  saveCheckpoint?: (checkpoint: PublishCheckpoint) => Promise<void>;
  verificationBackoffMs?: readonly number[];
  sleep?: (delayMs: number) => Promise<void>;
};

type CloudflareEnvelope = {
  success: boolean;
};

type PublishEnvironmentName =
  | "CLOUDFLARE_ACCOUNT_ID"
  | "CLOUDFLARE_API_TOKEN"
  | "CLOUDFLARE_KV_NAMESPACE_ID"
  | "CLOUDFLARE_PUBLISH_KEY"
  | "CLOUDFLARE_PUBLISH_LIVE_URL";

function requiredEnv(name: PublishEnvironmentName): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function parsePublishInstruction(instruction: string): PublishInstruction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(instruction);
  } catch {
    throw new Error("Publish instruction must be structured JSON");
  }
  if (!isRecord(parsed) || !hasExactKeys(parsed, ["content"])) {
    throw new Error("Publish instruction accepts only the content field");
  }
  if (typeof parsed.content !== "string" || parsed.content.trim() === "") {
    throw new Error("Publish content cannot be empty");
  }
  if (Buffer.byteLength(parsed.content, "utf8") > MAX_PUBLISH_CONTENT_BYTES) {
    throw new Error("Publish content exceeds Cloudflare Workers KV's 25 MiB value limit");
  }
  return { content: parsed.content };
}

export function normalizePublishInstruction(instruction: string): string {
  return JSON.stringify(parsePublishInstruction(instruction));
}

function cloudflareKvUrl(): string {
  const accountId = requiredEnv("CLOUDFLARE_ACCOUNT_ID");
  const namespaceId = requiredEnv("CLOUDFLARE_KV_NAMESPACE_ID");
  const key = requiredEnv("CLOUDFLARE_PUBLISH_KEY");
  if (Buffer.byteLength(key, "utf8") > 512) {
    throw new Error("CLOUDFLARE_PUBLISH_KEY exceeds Cloudflare Workers KV's 512-byte key limit");
  }
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/values/${encodeURIComponent(key)}`;
}

function liveUrl(): URL {
  const value = requiredEnv("CLOUDFLARE_PUBLISH_LIVE_URL");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") {
    throw new Error("CLOUDFLARE_PUBLISH_LIVE_URL must use HTTPS");
  }
  return parsed;
}

function cloudflareHeaders(contentType = false): HeadersInit {
  return {
    authorization: `Bearer ${requiredEnv("CLOUDFLARE_API_TOKEN")}`,
    ...(contentType ? { "content-type": "text/plain; charset=utf-8" } : {}),
  };
}

async function readCurrentLiveContent(fetcher: typeof fetch, taskId: string): Promise<string | null> {
  const url = liveUrl();
  url.searchParams.set("switchboard_observe", taskId);
  const response = await fetcher(url, {
    method: "GET",
    cache: "no-store",
    headers: { "cache-control": "no-cache" },
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Cloudflare live content observation failed with HTTP ${response.status}`);
  }
  return response.text();
}

function parseCloudflareEnvelope(value: unknown): CloudflareEnvelope {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    throw new Error("Cloudflare returned an invalid KV write response");
  }
  return { success: value.success };
}

async function writeContent(
  fetcher: typeof fetch,
  content: string,
  url: string,
  headers: HeadersInit,
): Promise<void> {
  const response = await fetcher(url, {
    method: "PUT",
    headers,
    body: content,
  });
  const envelope = parseCloudflareEnvelope(await response.json() as unknown);
  if (!response.ok || !envelope.success) {
    throw new Error(`Cloudflare KV publish failed with HTTP ${response.status}`);
  }
}

function contentVersion(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function sleep(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

export function createPublishDefinition(
  content: string,
  task: Task,
  fetcher: typeof fetch = fetch,
  options: PublishOptions = {},
): OavrTask<PublishState, PublishAction, PublishEvidence> {
  const version = contentVersion(content);
  const verificationBackoffMs = options.verificationBackoffMs ?? DEFAULT_VERIFICATION_BACKOFF_MS;
  const wait = options.sleep ?? sleep;
  let deploymentAttempted = false;
  let completedAction: PublishAction | undefined;
  let verificationAttempt = 0;

  return {
    observe: async (): Promise<PublishState> => {
      if (completedAction !== undefined) {
        return { currentContent: null };
      }
      return { currentContent: await readCurrentLiveContent(fetcher, task.id) };
    },
    act: async (state): Promise<PublishAction> => {
      if (completedAction !== undefined) {
        return completedAction;
      }
      if (state.currentContent === content) {
        completedAction = {
          content,
          version,
          alreadyPublished: true,
          deploymentAttempted,
        };
        return completedAction;
      }
      if (deploymentAttempted) {
        throw new Error("Cloudflare publish outcome is unknown; refusing to publish again");
      }

      const writeUrl = cloudflareKvUrl();
      const writeHeaders = cloudflareHeaders(true);
      const checkpoint: PublishCheckpoint = {
        liveUrl: liveUrl().toString(),
        kvKey: requiredEnv("CLOUDFLARE_PUBLISH_KEY"),
        version,
        deploymentAttempted: true,
      };
      await options.saveCheckpoint?.(checkpoint);

      // Persist the marker and cache the action before starting the irreversible
      // request. A timeout or malformed response must never permit another write,
      // and verification must retain evidence that the write may have succeeded.
      deploymentAttempted = true;
      completedAction = {
        content,
        version,
        alreadyPublished: false,
        deploymentAttempted: true,
      };
      try {
        await writeContent(fetcher, content, writeUrl, writeHeaders);
      } catch {
        // The request may have reached Cloudflare. Verify the live target instead of
        // throwing away the durable attempt marker or issuing another PUT.
      }
      return completedAction;
    },
    verify: async (action): Promise<{ ok: boolean; evidence: PublishEvidence; reason?: string }> => {
      const delayMs = verificationBackoffMs[verificationAttempt]
        ?? verificationBackoffMs.at(-1)
        ?? 0;
      verificationAttempt += 1;
      if (delayMs > 0) {
        await wait(delayMs);
      }
      const url = liveUrl();
      url.searchParams.set("switchboard_version", action.version);
      url.searchParams.set("switchboard_verify_attempt", String(verificationAttempt));
      let httpStatus = 0;
      let contentMatched = false;
      try {
        const response = await fetcher(url, {
          method: "GET",
          cache: "no-store",
          headers: { "cache-control": "no-cache" },
        });
        httpStatus = response.status;
        contentMatched = await response.text() === action.content;
      } catch {
        // Keep the durable deployment marker in OAVR evidence even when the live
        // verification request itself has an ambiguous network outcome.
      }
      const verifiedByFreshRead = httpStatus === 200 && contentMatched;
      const evidence: PublishEvidence = {
        liveUrl: liveUrl().toString(),
        kvKey: requiredEnv("CLOUDFLARE_PUBLISH_KEY"),
        version: action.version,
        httpStatus,
        contentMatched,
        alreadyPublished: action.alreadyPublished,
        deploymentAttempted: action.deploymentAttempted,
        verifiedByFreshRead,
      };
      return {
        ok: verifiedByFreshRead,
        evidence,
        ...(verifiedByFreshRead ? {} : { reason: "Live Cloudflare URL did not return HTTP 200 with the expected content" }),
      };
    },
    recover: async (): Promise<void> => undefined,
  };
}

export async function runPublishTask(
  task: Task,
  requester: string,
  instruction: string,
  saveCheckpoint: (checkpoint: PublishCheckpoint) => Promise<void>,
  parentId?: string,
): Promise<TaskResult> {
  if (task.template !== "publish") {
    throw new Error("Publish specialist received a non-publish task");
  }
  const { content } = parsePublishInstruction(instruction);
  const context: OavrContext = {
    task,
    requester,
    ...(parentId === undefined ? {} : { parentId }),
  };
  return runOavr(createPublishDefinition(content, task, fetch, { saveCheckpoint }), context);
}
