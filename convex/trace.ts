import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { assertIngestKey, assertTelemetry } from "./ingest";

const traceKind = v.union(v.literal("manager"), v.literal("specialist"), v.literal("verify"), v.literal("escalation"));

function configuredPrice(name: "FRONTIER_INPUT_USD_PER_MILLION_TOKENS" | "FRONTIER_OUTPUT_USD_PER_MILLION_TOKENS"): number | undefined {
  const rawPrice = process.env[name];
  if (rawPrice === undefined || rawPrice.trim() === "") {
    return undefined;
  }
  const price = Number(rawPrice);
  assertTelemetry(name, price);
  return price;
}

function frontierEquivalentCost(promptTok: number, complTok: number, actualCostUsd: number): number {
  const inputPrice = configuredPrice("FRONTIER_INPUT_USD_PER_MILLION_TOKENS");
  const outputPrice = configuredPrice("FRONTIER_OUTPUT_USD_PER_MILLION_TOKENS");
  if (inputPrice === undefined || outputPrice === undefined) {
    return actualCostUsd;
  }
  return (promptTok * inputPrice + complTok * outputPrice) / 1_000_000;
}

export const startRun = mutation({
  args: { ingestKey: v.string(), runId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    assertIngestKey(args.ingestKey);
    const existing = await ctx.db.query("runs").withIndex("by_runId", (q) => q.eq("runId", args.runId)).unique();
    if (existing !== null) {
      return;
    }
    await ctx.db.insert("runs", {
      runId: args.runId,
      startedAt: Date.now(),
      requestCount: 1,
      successCount: 0,
      escalationCount: 0,
      totalCostUsd: 0,
      status: "running",
    });
  },
});

export const recordTrace = mutation({
  args: {
    ingestKey: v.string(),
    id: v.string(),
    runId: v.string(),
    requestId: v.string(),
    taskId: v.optional(v.string()),
    kind: traceKind,
    model: v.string(),
    promptTok: v.number(),
    complTok: v.number(),
    costUsd: v.number(),
    latencyMs: v.number(),
    verifyPass: v.optional(v.boolean()),
    parentId: v.optional(v.string()),
    ts: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    assertIngestKey(args.ingestKey);
    assertTelemetry("promptTok", args.promptTok, true);
    assertTelemetry("complTok", args.complTok, true);
    assertTelemetry("costUsd", args.costUsd);
    assertTelemetry("latencyMs", args.latencyMs);
    assertTelemetry("ts", args.ts, true);

    const run = await ctx.db.query("runs").withIndex("by_runId", (q) => q.eq("runId", args.runId)).unique();
    if (run === null) {
      throw new Error(`Unknown run ${args.runId}`);
    }
    if (run.status !== "running") {
      throw new Error(`Run ${args.runId} is already complete`);
    }
    const request = await ctx.db.query("requests").withIndex("by_runIdAndId", (q) => q.eq("runId", args.runId).eq("id", args.requestId)).unique();
    if (request === null) {
      throw new Error(`Unknown request ${args.requestId} for run ${args.runId}`);
    }
    const taskId = args.taskId;
    if (taskId !== undefined) {
      const task = await ctx.db.query("tasks").withIndex("by_runIdAndId", (q) => q.eq("runId", args.runId).eq("id", taskId)).unique();
      if (task === null || task.requestId !== args.requestId) {
        throw new Error(`Trace task ${taskId} does not belong to request ${args.requestId}`);
      }
    }
    const parentId = args.parentId;
    if (parentId !== undefined) {
      const parent = await ctx.db.query("traceNodes").withIndex("by_nodeId", (q) => q.eq("id", parentId)).unique();
      if (parent === null || parent.runId !== args.runId) {
        throw new Error(`Trace parent ${parentId} does not belong to run ${args.runId}`);
      }
    }
    const duplicate = await ctx.db.query("traceNodes").withIndex("by_nodeId", (q) => q.eq("id", args.id)).unique();
    if (duplicate !== null) {
      throw new Error(`Trace node ${args.id} already exists`);
    }

    const { ingestKey: _, ...node } = args;
    const frontierCostUsd = frontierEquivalentCost(node.promptTok, node.complTok, node.costUsd);
    await ctx.db.insert("traceNodes", node);
    await ctx.db.insert("costLog", {
      runId: node.runId,
      ts: node.ts,
      model: node.model,
      promptTok: node.promptTok,
      complTok: node.complTok,
      costUsd: node.costUsd,
      frontierCostUsd,
      role: node.kind,
    });
    await ctx.db.patch(run._id, { totalCostUsd: run.totalCostUsd + node.costUsd });
  },
});

export const endRun = mutation({
  args: { ingestKey: v.string(), runId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    assertIngestKey(args.ingestKey);
    const run = await ctx.db.query("runs").withIndex("by_runId", (q) => q.eq("runId", args.runId)).unique();
    if (run === null) {
      throw new Error(`Unknown run ${args.runId}`);
    }
    if (run.status !== "running") {
      return;
    }

    const [nodes, tasks] = await Promise.all([
      ctx.db.query("traceNodes").withIndex("by_runId", (q) => q.eq("runId", args.runId)).collect(),
      ctx.db.query("tasks").withIndex("by_runId", (q) => q.eq("runId", args.runId)).collect(),
    ]);
    const incompleteTasks = tasks.filter((task) => task.status === "pending" || task.status === "running");
    await Promise.all(
      incompleteTasks.map(async (task) => await ctx.db.patch(task._id, {
        status: "failed",
        evidence: JSON.stringify({ reason: "Run ended before task reached a terminal state" }),
      })),
    );
    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    const latestVerifyByTask = new Map<string, (typeof nodes)[number]>();
    for (const node of nodes) {
      if (node.kind !== "verify" || node.verifyPass === undefined || node.taskId === undefined) {
        continue;
      }
      const task = tasksById.get(node.taskId);
      if (task === undefined || task.requestId !== node.requestId) {
        continue;
      }
      const verificationKey = node.taskId;
      const previous = latestVerifyByTask.get(verificationKey);
      if (previous === undefined || node.ts >= previous.ts) {
        latestVerifyByTask.set(verificationKey, node);
      }
    }

    const successCount = tasks.filter((task) => latestVerifyByTask.get(task.id)?.verifyPass === true).length;
    const escalationCount = nodes.filter((node) => node.kind === "escalation").length;
    const status = tasks.length > 0 && successCount === tasks.length ? "success" : "failed";
    await ctx.db.patch(run._id, {
      endedAt: Date.now(),
      successCount,
      escalationCount,
      status,
    });
  },
});
