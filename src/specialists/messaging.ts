import type { Task, TaskResult } from "../lib/types.js";
import { runOavr } from "./base.js";

type TelegramChat = {
  id: number;
};

type TelegramMessage = {
  message_id: number;
  chat: TelegramChat;
};

type TelegramApiEnvelope = {
  ok: boolean;
  result?: unknown;
  description?: string;
};

export type MessagingEvidence = {
  channelId: string;
  messageId: number;
  acceptedByTelegram: boolean;
};

function requiredEnv(name: "TELEGRAM_BOT_TOKEN" | "ALLOWED_CHANNEL_ID"): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseEnvelope(value: unknown): TelegramApiEnvelope {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    throw new Error("Telegram returned an invalid response");
  }
  return {
    ok: value.ok,
    ...(value.result === undefined ? {} : { result: value.result }),
    ...(typeof value.description === "string" ? { description: value.description } : {}),
  };
}

function parseMessage(value: unknown): TelegramMessage {
  if (!isRecord(value) || typeof value.message_id !== "number" || !isRecord(value.chat) || typeof value.chat.id !== "number") {
    throw new Error("Telegram did not return a message confirmation");
  }
  return { message_id: value.message_id, chat: { id: value.chat.id } };
}

async function telegramCall(method: string, payload: Record<string, unknown>): Promise<unknown> {
  const token = requiredEnv("TELEGRAM_BOT_TOKEN");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const envelope = parseEnvelope(await response.json() as unknown);
  if (!response.ok || !envelope.ok) {
    throw new Error(envelope.description ?? `Telegram ${method} failed`);
  }
  return envelope.result;
}

async function observeAllowlistedChannel(): Promise<string> {
  const channelId = requiredEnv("ALLOWED_CHANNEL_ID");
  await telegramCall("getChat", { chat_id: channelId });
  return channelId;
}

async function postOnlyToAllowlistedChannel(text: string): Promise<TelegramMessage> {
  const channelId = requiredEnv("ALLOWED_CHANNEL_ID");
  const message = parseMessage(await telegramCall("sendMessage", {
    chat_id: channelId,
    text,
    disable_web_page_preview: true,
  }));
  if (String(message.chat.id) !== channelId) {
    throw new Error("Telegram returned a message for a non-allowlisted channel");
  }
  return message;
}

export async function runMessagingTask(
  task: Task,
  requester: string,
  text: string,
): Promise<TaskResult> {
  if (task.template !== "messaging") {
    throw new Error("Messaging specialist received a non-messaging task");
  }
  if (text.trim() === "") {
    throw new Error("A message cannot be empty");
  }

  return runOavr({
    observe: async (): Promise<string> => observeAllowlistedChannel(),
    act: async (): Promise<TelegramMessage> => postOnlyToAllowlistedChannel(text),
    verify: async (message): Promise<{ ok: boolean; evidence: MessagingEvidence; reason?: string }> => {
      const channelId = await observeAllowlistedChannel();
      const acceptedByTelegram = message.message_id > 0 && String(message.chat.id) === channelId;
      return {
        ok: acceptedByTelegram,
        evidence: { channelId, messageId: message.message_id, acceptedByTelegram },
        ...(acceptedByTelegram ? {} : { reason: "Message was not confirmed in the allowlisted channel" }),
      };
    },
    recover: async (): Promise<void> => undefined,
  }, { task, requester });
}
