import "dotenv/config";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

type BetaStatus = "approved" | "blocked";

function requiredEnv(name: "CONVEX_URL" | "TRACE_INGEST_KEY"): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseStatus(value: string | undefined): BetaStatus {
  if (value === undefined || value === "approved") {
    return "approved";
  }
  if (value === "blocked") {
    return "blocked";
  }
  throw new Error("Usage: npx tsx scripts/approve-beta-user.ts <telegram-user-id> [approved|blocked]");
}

async function main(): Promise<void> {
  const telegramUserId = process.argv[2]?.trim();
  if (telegramUserId === undefined || !/^\d+$/.test(telegramUserId)) {
    throw new Error("Usage: npx tsx scripts/approve-beta-user.ts <telegram-user-id> [approved|blocked]");
  }
  const status = parseStatus(process.argv[3]);
  const client = new ConvexHttpClient(requiredEnv("CONVEX_URL"));
  await client.mutation(api.betaSignup.approve, {
    ingestKey: requiredEnv("TRACE_INGEST_KEY"),
    telegramUserId,
    status,
  });
  console.log(`Beta signup ${status} for Telegram user ${telegramUserId}`);
}

void main();
