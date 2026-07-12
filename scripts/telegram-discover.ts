import "dotenv/config";

type TelegramIdentity = {
  id: number;
  type: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (token === undefined || token === "") {
    throw new Error("TELEGRAM_BOT_TOKEN is required");
  }
  return token;
}

function identities(update: unknown): TelegramIdentity[] {
  if (!isRecord(update)) {
    return [];
  }
  const message = isRecord(update.message) ? update.message : isRecord(update.channel_post) ? update.channel_post : undefined;
  if (message === undefined) {
    return [];
  }
  const found: TelegramIdentity[] = [];
  if (isRecord(message.chat) && typeof message.chat.id === "number" && typeof message.chat.type === "string") {
    found.push({ id: message.chat.id, type: message.chat.type });
  }
  if (isRecord(message.from) && typeof message.from.id === "number") {
    found.push({ id: message.from.id, type: "user" });
  }
  return found;
}

async function main(): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${requiredBotToken()}/getUpdates?timeout=0`);
  const payload = await response.json() as unknown;
  if (!response.ok || !isRecord(payload) || payload.ok !== true || !Array.isArray(payload.result)) {
    throw new Error("Telegram getUpdates did not return updates");
  }
  const unique = new Map<number, TelegramIdentity>();
  for (const update of payload.result) {
    for (const identity of identities(update)) {
      unique.set(identity.id, identity);
    }
  }
  console.log(JSON.stringify({ identities: Array.from(unique.values()) }, null, 2));
}

void main();
