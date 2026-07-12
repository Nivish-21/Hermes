import type { TraceNode } from "../lib/types.js";

export async function startRun(): Promise<string> {
  const runId = crypto.randomUUID();
  console.log("[trace:start]", { runId });
  return runId;
}

export async function recordTrace(node: TraceNode): Promise<void> {
  console.log("[trace:node]", node);
}

export async function endRun(runId: string): Promise<void> {
  console.log("[trace:end]", { runId });
}
