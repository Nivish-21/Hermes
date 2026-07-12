import "dotenv/config";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api.js";
import type { ManagedRunResult } from "../manager/manager.js";
import { manageRequest } from "../manager/manager.js";

type TelegramTextUpdate = {
  updateId: number;
  messageId: number;
  senderId: string;
  chatId: string;
  chatType: string;
  text: string;
  ts: number;
};

export type TelegramCommand = {
  command: string;
  argument: string;
};

type CommandAction = {
  prompt?: string;
  reply?: string;
};

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

export function parseTelegramCommand(text: string): TelegramCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const [rawCommand, ...parts] = trimmed.split(/\s+/);
  if (rawCommand === undefined) {
    return null;
  }
  const command = rawCommand.slice(1).split("@", 1)[0]?.toLowerCase();
  if (command === undefined || command === "") {
    return null;
  }
  return { command, argument: parts.join(" ") };
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

function helpText(): string {
  return [
    "Switchboard can route a request to Research, Messaging, or Booking.",
    "Use /ask followed by a plain-English request.",
    "Use /research followed by a research question.",
    "Use /message followed by text for the allowlisted team channel.",
    "Use /book followed by a calendar request.",
    "Use /status or /cost for your latest run.",
    "Use /dashboard for the configured dashboard link.",
    "/publish is not live.",
  ].join("\n");
}

async function sendPrivateReply(chatId: string, text: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${requiredEnv("TELEGRAM_BOT_TOKEN")}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  const payload = await response.json() as unknown;
  if (!response.ok || !isRecord(payload) || payload.ok !== true) {
    throw new Error("Telegram did not confirm the command reply");
  }
}

export async function resolveTelegramCommand(command: TelegramCommand, requester: string): Promise<CommandAction> {
  if (command.command === "start" || command.command === "help") {
    return { reply: helpText() };
  }
  if (command.command === "ask") {
    return command.argument === "" ? { reply: "Use /ask followed by a request." } : { prompt: command.argument };
  }
  if (command.command === "research") {
    return command.argument === "" ? { reply: "Use /research followed by a research question." } : { prompt: `Research this request with citations: ${command.argument}` };
  }
  if (command.command === "message") {
    return command.argument === "" ? { reply: "Use /message followed by the exact team update to post." } : { prompt: `Post this exact message to the allowlisted team channel: ${command.argument}` };
  }
  if (command.command === "book") {
    return command.argument === "" ? { reply: "Use /book followed by a calendar request." } : { prompt: `Book this calendar request: ${command.argument}` };
  }
  if (command.command === "status" || command.command === "cost") {
    const lastRun = await convexClient().query(api.operator.lastRunForRequester, {
      ingestKey: requiredEnv("TRACE_INGEST_KEY"),
      requester,
    });
    if (lastRun === null) {
      return { reply: "No completed Switchboard run exists for this account yet." };
    }
    if (command.command === "status") {
      return { reply: `Latest run: ${lastRun.runStatus}. Task: ${lastRun.taskStatus}. Attempts: ${lastRun.attempts}.` };
    }
    return { reply: `Latest run cost: $${lastRun.totalCostUsd.toFixed(4)}.` };
  }
  if (command.command === "dashboard") {
    const dashboardUrl = process.env.DASHBOARD_URL?.trim();
    return { reply: dashboardUrl === undefined || dashboardUrl === "" ? "Dashboard URL is not configured yet." : dashboardUrl };
  }
  if (command.command === "publish") {
    return { reply: `/${command.command} is pending and not available in the live Switchboard demo.` };
  }
  return { reply: helpText() };
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

export async function handleTelegramUpdate(update: unknown): Promise<ManagedRunResult | null> {
  const textUpdate = parseTextUpdate(update);
  if (textUpdate === null || textUpdate.text.trim() === "") {
    return null;
  }
  if (!allowedUserIds().has(textUpdate.senderId) || textUpdate.chatType !== "private" || textUpdate.chatId !== textUpdate.senderId) {
    return null;
  }

  const claim = await convexClient().mutation(api.telegramUpdates.claim, {
    ingestKey: requiredEnv("TRACE_INGEST_KEY"),
    updateId: textUpdate.updateId,
    messageId: textUpdate.messageId,
    senderId: textUpdate.senderId,
    receivedAt: textUpdate.ts,
  });
  if (!claim.claimed) {
    return null;
  }

  let result: ManagedRunResult | undefined;
  try {
    const command = parseTelegramCommand(textUpdate.text);
    const action = command === null ? { prompt: textUpdate.text } : await resolveTelegramCommand(command, textUpdate.senderId);
    if (action.reply !== undefined) {
      await sendPrivateReply(textUpdate.chatId, action.reply);
      await completeTelegramUpdate(textUpdate.updateId, "succeeded");
      return null;
    }
    if (action.prompt === undefined) {
      throw new Error("Telegram command did not produce a request prompt");
    }
    result = await manageRequest({
      id: `telegram-${textUpdate.updateId}-${textUpdate.messageId}`,
      channel: "text",
      requester: textUpdate.senderId,
      transcript: action.prompt,
      ts: textUpdate.ts,
    });
    const status = result.result.status === "success" ? "succeeded" : "failed";
    await completeTelegramUpdate(
      textUpdate.updateId,
      status,
      result.request.runId,
      status === "succeeded" ? undefined : `Specialist ended with ${result.result.status}`,
    );
    return result;
  } catch (error: unknown) {
    const message = errorMessage(error);
    if (result === undefined) {
      try {
        await completeTelegramUpdate(textUpdate.updateId, "failed", undefined, message);
      } catch (completionError: unknown) {
        console.error("Telegram update failure could not be persisted", { message: errorMessage(completionError) });
      }
    }
    throw error;
  }
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
