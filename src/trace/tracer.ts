import "dotenv/config";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api.js";
import type { TraceNode } from "../lib/types.js";

function requiredEnv(name: "CONVEX_URL" | "TRACE_INGEST_KEY"): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} must be set before using the tracer`);
  }
  return value;
}

let client: ConvexHttpClient | undefined;

function convexClient(): ConvexHttpClient {
  client ??= new ConvexHttpClient(requiredEnv("CONVEX_URL"));
  return client;
}

export async function startRun(): Promise<string> {
  const runId = crypto.randomUUID();
  await convexClient().mutation(api.trace.startRun, { ingestKey: requiredEnv("TRACE_INGEST_KEY"), runId });
  return runId;
}

export async function recordTrace(node: TraceNode): Promise<void> {
  await convexClient().mutation(api.trace.recordTrace, { ingestKey: requiredEnv("TRACE_INGEST_KEY"), ...node });
}

export async function endRun(runId: string): Promise<void> {
  await convexClient().mutation(api.trace.endRun, { ingestKey: requiredEnv("TRACE_INGEST_KEY"), runId });
}
