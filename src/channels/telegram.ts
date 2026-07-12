import { randomUUID } from "node:crypto";
import "dotenv/config";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api.js";
import type { Request, SpecialistId, Task, TaskResult } from "../lib/types.js";
import type { IncomingRequest, ManagedRunResult } from "../manager/manager.js";
import { manageRequest } from "../manager/manager.js";
import { clearRunBudget } from "../router/budget.js";
import { runMessagingTask } from "../specialists/messaging.js";
import { runResearchTask, type ResearchBrief } from "../specialists/research.js";
import { endRun, startRun } from "../trace/tracer.js";

export type TelegramTextUpdate = {
  updateId: number;
  messageId: number;
  senderId: string;
  chatId: string;
  chatType: string;
  text: string;
  ts: number;
};

type SupportedCommand = "start" | "help" | "ask" | "research" | "message" | "status" | "cost" | "dashboard" | "book" | "publish";

export type ParsedTelegramCommand = {
  command: SupportedCommand;
  argument: string;
};

type RequesterActivity = {
  requestedAt: number;
  status: "running" | "success" | "failed";
  routedCostUsd: number;
  frontierEstimateUsd: number;
};

export type TelegramHandlerDependencies = {
  allowedUserIds: ReadonlySet<string>;
  dashboardUrl: string | null;
  claimUpdate: (update: TelegramTextUpdate) => Promise<{ claimed: boolean }>;
  completeUpdate: (
    updateId: number,
    status: "succeeded" | "failed",
    runId?: string,
    error?: string,
  ) => Promise<void>;
  sendPrivateReply: (requester: string, text: string) => Promise<void>;
  manageRequest: (request: IncomingRequest) => Promise<ManagedRunResult>;
  runDirectTask: (
    update: TelegramTextUpdate,
    template: Extract<SpecialistId, "research" | "messaging">,
    instruction: string,
  ) => Promise<ManagedRunResult>;
  latestRequesterActivity: (requester: string) => Promise<RequesterActivity | null>;
};

export const BOT_COMMANDS: ReadonlyArray<{ command: SupportedCommand; description: string }> = [
  { command: "start", description: "Start Switchboard and see available commands" },
  { command: "help", description: "Show Switchboard command help" },
  { command: "ask", description: "Ask the Manager to route a request" },
  { command: "research", description: "Run a sourced research task directly" },
  { command: "message", description: "Post directly to the allowlisted channel" },
  { command: "status", description: "Show your most recent request status" },
  { command: "cost", description: "Show your latest routed and frontier cost" },
  { command: "dashboard", description: "Show public trace dashboard availability" },
  { command: "book", description: "Booking command — not live yet" },
  { command: "publish", description: "Publishing command — not live yet" },
];

const SUPPORTED_COMMANDS = new Set<string>(BOT_COMMANDS.map(({ command }) => command));
const HELP_TEXT = [
  "Switchboard commands:",
  "/ask <text> — let the Manager choose a specialist",
  "/research <query> — run sourced research directly",
  "/message <text> — post to the allowlisted channel",
  "/status — show your latest request status",
  "/cost — show your latest routed and frontier-estimate cost",
  "/dashboard — show the trace dashboard when a live deployment is configured",
  "/book — not live yet",
  "/publish — not live yet",
].join("\n");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredEnv(name: "CONVEX_URL" | "TELEGRAM_BOT_TOKEN" | "TRACE_INGEST_KEY"): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function allowedUserIds(): Set<string> {
  const raw = process.env.TELEGRAM_ALLOWED_USERS ?? "";
  const ids = raw.split(",").map((id) => id.trim()).filter((id) => id !== "");
  if (ids.length === 0) {
    throw new Error("TELEGRAM_ALLOWED_USERS is required");
  }
  return new Set(ids);
}

export function parseTelegramCommand(text: string): ParsedTelegramCommand | null {
  const match = /^\s*\/([a-z]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*?))?\s*$/i.exec(text);
  if (match === null) {
    return null;
  }
  const command = (match[1] ?? "").toLowerCase();
  if (!SUPPORTED_COMMANDS.has(command)) {
    return null;
  }
  return { command: command as SupportedCommand, argument: (match[2] ?? "").trim() };
}

function parseTextUpdate(update: unknown): TelegramTextUpdate | null {
  if (!isRecord(update) || typeof update.update_id !== "number" || !isRecord(update.message)) {
    return null;
  }
  const message = update.message;
  if (typeof message.message_id !== "number" || typeof message.date !== "number" || typeof message.text !== "string" || !isRecord(message.from) || typeof message.from.id !== "number" || !isRecord(message.chat) || typeof message.chat.id !== "number" || typeof message.chat.type !== "string") {
    return null;
  }
  return {
    updateId: update.update_id,
    messageId: message.message_id,
    senderId: String(message.from.id),
    chatId: String(message.chat.id),
    chatType: message.chat.type,
    text: message.text,
    ts: message.date * 1_000,
  };
}

function convexClient(): ConvexHttpClient {
  return new ConvexHttpClient(requiredEnv("CONVEX_URL"));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Telegram update failure";
}

async function telegramCall(method: string, payload: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`https://api.telegram.org/bot${requiredEnv("TELEGRAM_BOT_TOKEN")}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const envelope = await response.json() as unknown;
  if (!response.ok || !isRecord(envelope) || envelope.ok !== true) {
    const description = isRecord(envelope) && typeof envelope.description === "string"
      ? envelope.description
      : `Telegram ${method} failed with HTTP ${response.status}`;
    throw new Error(description);
  }
  return envelope.result;
}

async function sendPrivateReply(requester: string, text: string): Promise<void> {
  if (!allowedUserIds().has(requester)) {
    throw new Error("Telegram replies are allowed only to configured users");
  }
  await telegramCall("sendMessage", {
    chat_id: requester,
    text,
    disable_web_page_preview: true,
  });
}

export async function registerTelegramCommands(): Promise<void> {
  await telegramCall("setMyCommands", { commands: BOT_COMMANDS });
}

async function completeTelegramUpdate(
  updateId: number,
  status: "succeeded" | "failed",
  runId?: string,
  error?: string,
): Promise<void> {
  await convexClient().mutation(api.telegramUpdates.complete, {
    ingestKey: requiredEnv("TRACE_INGEST_KEY"),
    updateId,
    status,
    ...(runId === undefined ? {} : { runId }),
    ...(error === undefined ? {} : { error }),
  });
}

async function persistDirectRequest(request: Request, task: Task): Promise<void> {
  const client = convexClient();
  const ingestKey = requiredEnv("TRACE_INGEST_KEY");
  await client.mutation(api.requests.create, { ingestKey, ...request, status: "running" });
  await client.mutation(api.tasks.create, {
    ingestKey,
    ...task,
    params: { instruction: String(task.params.instruction) },
    status: "running",
    attempts: 0,
    modelPath: [],
    costUsd: 0,
    latencyMs: 0,
  });
}

async function updateDirectTask(task: Task, result: TaskResult, evidence: unknown = result.evidence): Promise<void> {
  await convexClient().mutation(api.tasks.update, {
    ingestKey: requiredEnv("TRACE_INGEST_KEY"),
    id: task.id,
    runId: task.runId,
    status: result.status,
    attempts: result.attempts,
    modelPath: result.modelPath,
    costUsd: result.costUsd,
    latencyMs: result.latencyMs,
    evidence: JSON.stringify(evidence),
  });
}

async function saveDirectResearchBrief(task: Task, brief: ResearchBrief): Promise<void> {
  await convexClient().mutation(api.tasks.update, {
    ingestKey: requiredEnv("TRACE_INGEST_KEY"),
    id: task.id,
    runId: task.runId,
    status: "running",
    attempts: 1,
    modelPath: [],
    costUsd: 0,
    latencyMs: 0,
    evidence: JSON.stringify(brief),
  });
}

async function runDirectTask(
  update: TelegramTextUpdate,
  template: Extract<SpecialistId, "research" | "messaging">,
  instruction: string,
): Promise<ManagedRunResult> {
  const runId = await startRun();
  const request: Request = {
    id: `telegram-${update.updateId}-${update.messageId}`,
    runId,
    channel: "text",
    requester: update.senderId,
    transcript: instruction,
    ts: update.ts,
  };
  const task: Task = {
    id: randomUUID(),
    runId,
    requestId: request.id,
    template,
    params: { instruction },
  };

  try {
    await persistDirectRequest(request, task);
    const result = template === "research"
      ? await runResearchTask(task, request.requester, instruction, async ({ brief }) => saveDirectResearchBrief(task, brief))
      : await runMessagingTask(task, request.requester, instruction);
    await updateDirectTask(task, result);
    return { request, result };
  } finally {
    try {
      await endRun(runId);
    } finally {
      clearRunBudget(runId);
    }
  }
}

export function configuredDashboardUrl(raw: string | undefined): string | null {
  const explicit = raw?.trim();
  if (explicit === undefined || explicit === "") {
    return null;
  }
  try {
    const parsed = new URL(explicit);
    return parsed.protocol === "https:" ? parsed.toString().replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

async function latestRequesterActivity(requester: string): Promise<{
  requestedAt: number;
  status: "running" | "success" | "failed";
  routedCostUsd: number;
  frontierEstimateUsd: number;
} | null> {
  return convexClient().query(api.requesterActivity.latest, {
    ingestKey: requiredEnv("TRACE_INGEST_KEY"),
    requester,
  });
}

async function handleCommand(
  update: TelegramTextUpdate,
  parsed: ParsedTelegramCommand,
  dependencies: TelegramHandlerDependencies,
): Promise<ManagedRunResult | null> {
  if (parsed.command === "start" || parsed.command === "help") {
    await dependencies.sendPrivateReply(update.senderId, HELP_TEXT);
    return null;
  }
  if (parsed.command === "dashboard") {
    const reply = dependencies.dashboardUrl === null
      ? "The Switchboard dashboard is unavailable because no verified live deployment is configured yet."
      : `Live Switchboard dashboard: ${dependencies.dashboardUrl}`;
    await dependencies.sendPrivateReply(update.senderId, reply);
    return null;
  }
  if (parsed.command === "book" || parsed.command === "publish") {
    await dependencies.sendPrivateReply(update.senderId, `/${parsed.command} is not live yet. Use /help for available commands.`);
    return null;
  }
  if (parsed.command === "status" || parsed.command === "cost") {
    const latest = await dependencies.latestRequesterActivity(update.senderId);
    if (latest === null) {
      await dependencies.sendPrivateReply(update.senderId, "No previous Switchboard request was found for your Telegram account.");
    } else if (parsed.command === "status") {
      await dependencies.sendPrivateReply(update.senderId, `Your latest request is ${latest.status} (submitted ${new Date(latest.requestedAt).toISOString()}).`);
    } else {
      await dependencies.sendPrivateReply(
        update.senderId,
        `Latest request cost: routed $${latest.routedCostUsd.toFixed(6)}; frontier estimate $${latest.frontierEstimateUsd.toFixed(6)}.`,
      );
    }
    return null;
  }
  if (parsed.argument === "") {
    await dependencies.sendPrivateReply(update.senderId, `Usage: /${parsed.command} <text>`);
    return null;
  }
  if (parsed.command === "ask") {
    const result = await dependencies.manageRequest({
      id: `telegram-${update.updateId}-${update.messageId}`,
      channel: "text",
      requester: update.senderId,
      transcript: parsed.argument,
      ts: update.ts,
    });
    await dependencies.sendPrivateReply(update.senderId, `Manager task finished with status: ${result.result.status}.`);
    return result;
  }

  const template = parsed.command === "message" ? "messaging" : "research";
  const result = await dependencies.runDirectTask(update, template, parsed.argument);
  if (parsed.command === "message") {
    await dependencies.sendPrivateReply(update.senderId, `Message task finished with status: ${result.result.status}.`);
  } else if (result.result.status !== "success") {
    await dependencies.sendPrivateReply(update.senderId, `Research task finished with status: ${result.result.status}.`);
  }
  return result;
}

export function createTelegramUpdateHandler(
  dependencies: TelegramHandlerDependencies,
): (update: unknown) => Promise<ManagedRunResult | null> {
  return async (update: unknown): Promise<ManagedRunResult | null> => {
    const textUpdate = parseTextUpdate(update);
    if (textUpdate === null || textUpdate.text.trim() === "") {
      return null;
    }
    if (!dependencies.allowedUserIds.has(textUpdate.senderId) || textUpdate.chatType !== "private" || textUpdate.chatId !== textUpdate.senderId) {
      return null;
    }

    const claim = await dependencies.claimUpdate(textUpdate);
    if (!claim.claimed) {
      return null;
    }

    let result: ManagedRunResult | undefined;
    try {
      const command = parseTelegramCommand(textUpdate.text);
      result = command === null
        ? await dependencies.manageRequest({
          id: `telegram-${textUpdate.updateId}-${textUpdate.messageId}`,
          channel: "text",
          requester: textUpdate.senderId,
          transcript: textUpdate.text,
          ts: textUpdate.ts,
        })
        : await handleCommand(textUpdate, command, dependencies) ?? undefined;
      const status = result === undefined || result.result.status === "success" ? "succeeded" : "failed";
      await dependencies.completeUpdate(
        textUpdate.updateId,
        status,
        result?.request.runId,
        status === "succeeded" ? undefined : `Specialist ended with ${result?.result.status ?? "failed"}`,
      );
      return result ?? null;
    } catch (error: unknown) {
      const message = errorMessage(error);
      if (result === undefined) {
        try {
          await dependencies.completeUpdate(textUpdate.updateId, "failed", undefined, message);
        } catch (completionError: unknown) {
          console.error("Telegram update failure could not be persisted", { message: errorMessage(completionError) });
        }
      }
      throw error;
    }
  };
}

function liveDependencies(): TelegramHandlerDependencies {
  return {
    allowedUserIds: allowedUserIds(),
    dashboardUrl: configuredDashboardUrl(process.env.DASHBOARD_URL),
    claimUpdate: async (update) => convexClient().mutation(api.telegramUpdates.claim, {
      ingestKey: requiredEnv("TRACE_INGEST_KEY"),
      updateId: update.updateId,
      messageId: update.messageId,
      senderId: update.senderId,
      receivedAt: update.ts,
    }),
    completeUpdate: completeTelegramUpdate,
    sendPrivateReply,
    manageRequest,
    runDirectTask,
    latestRequesterActivity,
  };
}

export async function handleTelegramUpdate(update: unknown): Promise<ManagedRunResult | null> {
  return createTelegramUpdateHandler(liveDependencies())(update);
}

function parseUpdates(value: unknown): unknown[] {
  if (!isRecord(value) || value.ok !== true || !Array.isArray(value.result)) {
    throw new Error("Telegram getUpdates returned an invalid response");
  }
  return value.result;
}

export async function pollTelegramUpdates(
  offset?: number,
  timeoutSeconds = 30,
): Promise<{ nextOffset: number | undefined; runs: ManagedRunResult[] }> {
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 0 || timeoutSeconds > 50) {
    throw new Error("timeoutSeconds must be an integer from 0 to 50");
  }
  const parameters = new URLSearchParams({ timeout: String(timeoutSeconds) });
  if (offset !== undefined) {
    parameters.set("offset", String(offset));
  }
  const response = await fetch(
    `https://api.telegram.org/bot${requiredEnv("TELEGRAM_BOT_TOKEN")}/getUpdates?${parameters.toString()}`,
  );
  if (!response.ok) {
    throw new Error(`Telegram getUpdates failed with HTTP ${response.status}`);
  }

  const updates = parseUpdates(await response.json() as unknown);
  let nextOffset = offset;
  const runs: ManagedRunResult[] = [];
  for (const update of updates) {
    if (isRecord(update) && typeof update.update_id === "number") {
      nextOffset = update.update_id + 1;
    }
    try {
      const result = await handleTelegramUpdate(update);
      if (result !== null) {
        runs.push(result);
      }
    } catch (error: unknown) {
      console.error("Telegram update terminalized as failed", { message: errorMessage(error) });
    }
  }
  return { nextOffset, runs };
}
