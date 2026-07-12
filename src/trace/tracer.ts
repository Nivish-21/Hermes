import "dotenv/config";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api.js";
import type { TraceNode } from "../lib/types.js";

const convexUrl = process.env.CONVEX_URL;
if (convexUrl === undefined || convexUrl.length === 0) {
  throw new Error("CONVEX_URL must be set before using the tracer");
}

const client = new ConvexHttpClient(convexUrl);

export async function startRun(): Promise<string> {
  const runId = crypto.randomUUID();
  await client.mutation(api.trace.startRun, { runId });
  return runId;
}

export async function recordTrace(node: TraceNode): Promise<void> {
  await client.mutation(api.trace.recordTrace, node);
}

export async function endRun(runId: string): Promise<void> {
  await client.mutation(api.trace.endRun, { runId, status: "success" });
}
