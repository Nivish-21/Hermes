import type { Task, TaskResult } from "../lib/types.js";
import { runOavr } from "./base.js";

type LinkupResult = {
  name: string;
  url: string;
  content: string;
};

export type ResearchBrief = {
  query: string;
  summary: string;
  citations: Array<{ title: string; url: string }>;
};

export type ResearchEvidence = {
  brief: ResearchBrief;
  savedToConvex: boolean;
  replyAttempted: boolean;
  deliveredToTelegram: boolean;
  telegramMessageId: number;
  citationsResolvable: boolean;
};

export type SaveResearchBrief = (input: {
  task: Task;
  brief: ResearchBrief;
}) => Promise<void>;

function requiredEnv(name: "LINKUP_API_KEY" | "TELEGRAM_BOT_TOKEN"): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseLinkupResults(value: unknown): LinkupResult[] {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    throw new Error("Linkup returned no results array");
  }

  return value.results.flatMap((candidate): LinkupResult[] => {
    if (!isRecord(candidate) || typeof candidate.name !== "string" || typeof candidate.url !== "string" || typeof candidate.content !== "string") {
      return [];
    }
    try {
      const url = new URL(candidate.url);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        return [];
      }
      return [{ name: candidate.name, url: candidate.url, content: candidate.content }];
    } catch {
      return [];
    }
  });
}

async function searchLinkup(query: string): Promise<LinkupResult[]> {
  const response = await fetch("https://api.linkup.so/v1/search", {
    method: "POST",
    headers: {
      authorization: `Bearer ${requiredEnv("LINKUP_API_KEY")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      depth: "standard",
      outputType: "searchResults",
      maxResults: 5,
    }),
  });
  if (!response.ok) {
    throw new Error(`Linkup search failed with HTTP ${response.status}`);
  }
  return parseLinkupResults(await response.json() as unknown);
}

function buildBrief(query: string, results: LinkupResult[]): ResearchBrief {
  const citations = results.map((result) => ({ title: result.name, url: result.url }));
  const summary = results
    .map((result, index) => `${index + 1}. ${result.name}: ${result.content}`)
    .join("\n\n");
  return { query, summary, citations };
}

function allowedRequesters(): Set<string> {
  const raw = process.env.TELEGRAM_ALLOWED_USERS ?? "";
  return new Set(raw.split(",").map((value) => value.trim()).filter((value) => value !== ""));
}

async function sendResearchReply(requester: string, brief: ResearchBrief): Promise<number> {
  if (!allowedRequesters().has(requester)) {
    throw new Error("Research replies are allowed only to configured Telegram users");
  }

  const citationText = brief.citations
    .map((citation, index) => `${index + 1}. ${citation.title}\n${citation.url}`)
    .join("\n\n");
  const text = `Research brief: ${brief.query}\n\n${brief.summary}\n\nSources:\n${citationText}`;
  const response = await fetch(
    `https://api.telegram.org/bot${requiredEnv("TELEGRAM_BOT_TOKEN")}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: requester, text, disable_web_page_preview: true }),
    },
  );
  const payload = await response.json() as unknown;
  if (!isRecord(payload) || payload.ok !== true || !isRecord(payload.result) || typeof payload.result.message_id !== "number") {
    throw new Error("Telegram did not confirm the research reply");
  }
  return payload.result.message_id;
}

async function isResolvableCitation(url: string): Promise<boolean> {
  try {
    const headResponse = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (headResponse.ok) {
      return true;
    }
    const getResponse = await fetch(url, { method: "GET", redirect: "follow" });
    return getResponse.ok;
  } catch {
    return false;
  }
}

export async function runResearchTask(
  task: Task,
  requester: string,
  query: string,
  saveBrief: SaveResearchBrief,
): Promise<TaskResult> {
  if (task.template !== "research") {
    throw new Error("Research specialist received a non-research task");
  }
  if (query.trim() === "") {
    throw new Error("A research query cannot be empty");
  }

  let replyAttempted = false;
  let completedAction: ResearchEvidence | undefined;

  return runOavr({
    observe: async (): Promise<{ query: string }> => ({ query }),
    act: async (state): Promise<ResearchEvidence> => {
      if (completedAction !== undefined) {
        return completedAction;
      }
      if (replyAttempted) {
        throw new Error("Research reply outcome is unknown; refusing to send a duplicate reply");
      }

      const results = await searchLinkup(state.query);
      if (results.length === 0) {
        throw new Error("Linkup returned no usable results");
      }
      const brief = buildBrief(state.query, results);
      await saveBrief({ task, brief });
      replyAttempted = true;
      try {
        const telegramMessageId = await sendResearchReply(requester, brief);
        completedAction = {
          brief,
          savedToConvex: true,
          replyAttempted: true,
          deliveredToTelegram: true,
          telegramMessageId,
          citationsResolvable: false,
        };
      } catch {
        // Telegram may have accepted a post before a network failure reached us.
        // Preserve the attempt so OAVR and the Manager never replay this reply.
        completedAction = {
          brief,
          savedToConvex: true,
          replyAttempted: true,
          deliveredToTelegram: false,
          telegramMessageId: 0,
          citationsResolvable: false,
        };
      }
      return completedAction;
    },
    verify: async (evidence): Promise<{ ok: boolean; evidence: ResearchEvidence; reason?: string }> => {
      const citationChecks = await Promise.all(
        evidence.brief.citations.map((citation) => isResolvableCitation(citation.url)),
      );
      const citationsResolvable = evidence.brief.citations.length > 0 && citationChecks.every(Boolean);
      const verifiedEvidence: ResearchEvidence = { ...evidence, citationsResolvable };
      const ok = citationsResolvable && evidence.savedToConvex && evidence.deliveredToTelegram && evidence.telegramMessageId > 0;
      return {
        ok,
        evidence: verifiedEvidence,
        ...(ok ? {} : { reason: "Research evidence was not fully saved, delivered, and resolvable" }),
      };
    },
    recover: async (): Promise<void> => undefined,
  }, { task, requester });
}
