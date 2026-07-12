import { createHash } from "node:crypto";
import type { Task, TaskResult } from "../lib/types.js";
import { runOavr, type OavrContext, type OavrTask } from "./base.js";

const MAX_PUBLISH_CONTENT_BYTES = 25 * 1024 * 1024;

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

async function writeContent(fetcher: typeof fetch, content: string): Promise<void> {
  const response = await fetcher(cloudflareKvUrl(), {
    method: "PUT",
    headers: cloudflareHeaders(true),
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

export function createPublishDefinition(
  content: string,
  task: Task,
  fetcher: typeof fetch = fetch,
): OavrTask<PublishState, PublishAction, PublishEvidence> {
  const version = contentVersion(content);
  let deploymentAttempted = false;
  let completedAction: PublishAction | undefined;

  return {
    observe: async (): Promise<PublishState> => ({
      currentContent: await readCurrentLiveContent(fetcher, task.id),
    }),
    act: async (state): Promise<PublishAction> => {
      if (state.currentContent === content) {
        completedAction = {
          content,
          version,
          alreadyPublished: true,
          deploymentAttempted,
        };
        return completedAction;
      }
      if (completedAction !== undefined) {
        return completedAction;
      }
      if (deploymentAttempted) {
        throw new Error("Cloudflare publish outcome is unknown; refusing to publish again");
      }

      // Set the latch before starting the irreversible request. A timeout, malformed
      // response, or verification failure must never permit another write.
      deploymentAttempted = true;
      await writeContent(fetcher, content);
      completedAction = {
        content,
        version,
        alreadyPublished: false,
        deploymentAttempted: true,
      };
      return completedAction;
    },
    verify: async (action): Promise<{ ok: boolean; evidence: PublishEvidence; reason?: string }> => {
      const url = liveUrl();
      url.searchParams.set("switchboard_version", action.version);
      const response = await fetcher(url, {
        method: "GET",
        cache: "no-store",
        headers: { "cache-control": "no-cache" },
      });
      const body = await response.text();
      const contentMatched = body === action.content;
      const verifiedByFreshRead = response.status === 200 && contentMatched;
      const evidence: PublishEvidence = {
        liveUrl: liveUrl().toString(),
        kvKey: requiredEnv("CLOUDFLARE_PUBLISH_KEY"),
        version: action.version,
        httpStatus: response.status,
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
  return runOavr(createPublishDefinition(content, task), context);
}
