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

const convexUrl = requiredEnv("CONVEX_URL");
const ingestKey = requiredEnv("TRACE_INGEST_KEY");

const client = new ConvexHttpClient(convexUrl);

export async function startRun(): Promise<string> {
  const runId = crypto.randomUUID();
  await client.mutation(api.trace.startRun, { ingestKey, runId });
  return runId;
}

export async function recordTrace(node: TraceNode): Promise<void> {
  await client.mutation(api.trace.recordTrace, { ingestKey, ...node });
}

export async function endRun(runId: string): Promise<void> {
  await client.mutation(api.trace.endRun, { ingestKey, runId });
}
