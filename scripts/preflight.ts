import "dotenv/config";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

type Check = {
  name: string;
  ok: boolean;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function configuredUserIds(): string[] {
  return requiredEnv("TELEGRAM_ALLOWED_USERS").split(",").map((value) => value.trim()).filter((value) => value !== "");
}

async function telegramCall(token: string, method: string, body?: Record<string, string>): Promise<unknown> {
  const init: RequestInit = body === undefined
    ? { method: "GET" }
    : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, init);
  return await response.json() as unknown;
}

async function main(): Promise<void> {
  const managerModel = requiredEnv("MANAGER_MODEL_ID");
  const openAiKey = requiredEnv("OPENAI_API_KEY");
  const convexUrl = requiredEnv("CONVEX_URL");
  const viteConvexUrl = requiredEnv("VITE_CONVEX_URL");
  const ingestKey = requiredEnv("TRACE_INGEST_KEY");
  const telegramToken = requiredEnv("TELEGRAM_BOT_TOKEN");
  const channelId = requiredEnv("ALLOWED_CHANNEL_ID");
  const linkupKey = requiredEnv("LINKUP_API_KEY");
  const maxRunCost = Number(requiredEnv("SWITCHBOARD_MAX_USD_PER_RUN"));
  const estimatedCallCost = Number(requiredEnv("SWITCHBOARD_ESTIMATED_MODEL_CALL_USD"));
  const userIds = configuredUserIds();

  const checks: Check[] = [
    { name: "budget supports route and review", ok: Number.isFinite(maxRunCost) && Number.isFinite(estimatedCallCost) && maxRunCost >= estimatedCallCost * 2 },
    { name: "Convex runtime and dashboard URLs match", ok: convexUrl === viteConvexUrl },
    { name: "Telegram allowed users are numeric IDs", ok: userIds.length > 0 && userIds.every((value) => /^\d+$/.test(value)) },
    { name: "Telegram channel is a numeric ID", ok: /^-?\d+$/.test(channelId) },
  ];

  const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${openAiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: managerModel, messages: [{ role: "user", content: "Reply with OK." }], max_completion_tokens: 4 }),
  });
  checks.push({ name: "OpenAI Manager model accepts Chat Completions", ok: openAiResponse.ok });

  const linkupResponse = await fetch("https://api.linkup.so/v1/search", {
    method: "POST",
    headers: { authorization: `Bearer ${linkupKey}`, "content-type": "application/json" },
    body: JSON.stringify({ q: "Switchboard agent verification", depth: "standard", outputType: "searchResults", maxResults: 1 }),
  });
  const linkupPayload = await linkupResponse.json() as unknown;
  checks.push({ name: "Linkup search returns results", ok: linkupResponse.ok && isRecord(linkupPayload) && Array.isArray(linkupPayload.results) });

  const [bot, channel, webhook] = await Promise.all([
    telegramCall(telegramToken, "getMe"),
    telegramCall(telegramToken, "getChat", { chat_id: channelId }),
    telegramCall(telegramToken, "getWebhookInfo"),
  ]);
  const webhookResult = isRecord(webhook) && isRecord(webhook.result) ? webhook.result : undefined;
  checks.push({ name: "Telegram bot token is valid", ok: isRecord(bot) && bot.ok === true });
  checks.push({ name: "Allowlisted Telegram channel is reachable", ok: isRecord(channel) && channel.ok === true });
  checks.push({ name: "Telegram webhook is clear for long polling", ok: isRecord(webhook) && webhook.ok === true && webhookResult?.url === "" });

  const client = new ConvexHttpClient(convexUrl);
  const updateId = Date.now();
  const claim = await client.mutation(api.telegramUpdates.claim, {
    ingestKey,
    updateId,
    messageId: 1,
    senderId: "preflight",
    receivedAt: Date.now(),
  });
  await client.mutation(api.telegramUpdates.complete, {
    ingestKey,
    updateId,
    status: "failed",
    error: "preflight",
  });
  checks.push({ name: "Convex protected ingestion accepts local trace key", ok: claim.claimed });

  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}`);
  }
  if (checks.some((check) => !check.ok)) {
    process.exitCode = 1;
  }
}

void main();
