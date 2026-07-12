import "dotenv/config";
import type { ManagedRunResult } from "../manager/manager.js";
import { manageRequest } from "../manager/manager.js";

type TelegramTextUpdate = {
  updateId: number;
  messageId: number;
  senderId: string;
  text: string;
  ts: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function allowedUserIds(): Set<string> {
  const raw = process.env.TELEGRAM_ALLOWED_USERS ?? process.env.ALLOWED_TELEGRAM_USER_ID ?? "";
  const ids = raw.split(",").map((id) => id.trim()).filter((id) => id !== "");
  if (ids.length === 0) {
    throw new Error("TELEGRAM_ALLOWED_USERS is required");
  }
  return new Set(ids);
}

function parseTextUpdate(update: unknown): TelegramTextUpdate | null {
  if (!isRecord(update) || typeof update.update_id !== "number" || !isRecord(update.message)) {
    return null;
  }
  const message = update.message;
  if (typeof message.message_id !== "number" || typeof message.date !== "number" || typeof message.text !== "string" || !isRecord(message.from) || typeof message.from.id !== "number") {
    return null;
  }
  return {
    updateId: update.update_id,
    messageId: message.message_id,
    senderId: String(message.from.id),
    text: message.text,
    ts: message.date * 1_000,
  };
}

export async function handleTelegramUpdate(update: unknown): Promise<ManagedRunResult | null> {
  const textUpdate = parseTextUpdate(update);
  if (textUpdate === null || textUpdate.text.trim() === "") {
    return null;
  }
  if (!allowedUserIds().has(textUpdate.senderId)) {
    return null;
  }

  return manageRequest({
    id: `telegram-${textUpdate.updateId}-${textUpdate.messageId}`,
    channel: "text",
    requester: textUpdate.senderId,
    transcript: textUpdate.text,
    ts: textUpdate.ts,
  });
}

function requiredBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (token === undefined || token === "") {
    throw new Error("TELEGRAM_BOT_TOKEN is required");
  }
  return token;
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
    `https://api.telegram.org/bot${requiredBotToken()}/getUpdates?${parameters.toString()}`,
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
    const result = await handleTelegramUpdate(update);
    if (result !== null) {
      runs.push(result);
    }
  }
  return { nextOffset, runs };
}
