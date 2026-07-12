import "dotenv/config";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

function requiredEnv(name: "CONVEX_URL" | "TRACE_INGEST_KEY"): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function main(): Promise<void> {
  const client = new ConvexHttpClient(requiredEnv("CONVEX_URL"));
  const registrations = await client.query(api.registrations.listForOperator, {
    ingestKey: requiredEnv("TRACE_INGEST_KEY"),
  });
  console.table(registrations.map(({ email, name, company, createdAt, updatedAt }) => ({
    email,
    name: name ?? "",
    company: company ?? "",
    createdAt: new Date(createdAt).toISOString(),
    updatedAt: new Date(updatedAt).toISOString(),
  })));
}

void main();
