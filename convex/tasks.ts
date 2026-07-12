import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { assertIngestKey, assertTelemetry } from "./ingest";

const specialist = v.union(v.literal("research"), v.literal("messaging"), v.literal("booking"), v.literal("publish"));
const taskStatus = v.union(v.literal("pending"), v.literal("running"), v.literal("success"), v.literal("failed"), v.literal("escalated"));
const params = v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.null()));

type TaskStatus = "pending" | "running" | "success" | "failed" | "escalated";

function assertTaskTransition(current: TaskStatus, next: TaskStatus): void {
  if (current === next) {
    return;
  }
  if (current === "pending" && next === "running") {
    return;
  }
  if (current === "running" && (next === "success" || next === "failed" || next === "escalated")) {
    return;
  }
  throw new Error(`Invalid task status transition ${current} -> ${next}`);
}

export const create = mutation({
  args: {
    ingestKey: v.string(),
    id: v.string(),
    runId: v.string(),
    requestId: v.string(),
    template: specialist,
    params,
    status: taskStatus,
    attempts: v.number(),
    modelPath: v.array(v.string()),
    costUsd: v.number(),
    latencyMs: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    assertIngestKey(args.ingestKey);
    assertTelemetry("attempts", args.attempts, true);
    assertTelemetry("costUsd", args.costUsd);
    assertTelemetry("latencyMs", args.latencyMs);
    const run = await ctx.db.query("runs").withIndex("by_runId", (q) => q.eq("runId", args.runId)).unique();
    const request = await ctx.db.query("requests").withIndex("by_runIdAndId", (q) => q.eq("runId", args.runId).eq("id", args.requestId)).unique();
    if (run === null || run.status !== "running" || request === null) {
      throw new Error(`Cannot add a task to inactive run or unknown request ${args.runId}/${args.requestId}`);
    }
    const existing = await ctx.db.query("tasks").withIndex("by_runIdAndId", (q) => q.eq("runId", args.runId).eq("id", args.id)).unique();
    const { ingestKey: _, ...task } = args;
    if (existing === null) {
      await ctx.db.insert("tasks", task);
      return;
    }
    if (existing.requestId !== args.requestId || existing.template !== args.template || JSON.stringify(existing.params) !== JSON.stringify(args.params)) {
      throw new Error(`Conflicting task replay ${args.runId}/${args.id}`);
    }
    return;
  },
});

export const update = mutation({
  args: {
    ingestKey: v.string(),
    id: v.string(),
    runId: v.string(),
    status: taskStatus,
    attempts: v.number(),
    modelPath: v.array(v.string()),
    costUsd: v.number(),
    latencyMs: v.number(),
    evidence: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    assertIngestKey(args.ingestKey);
    assertTelemetry("attempts", args.attempts, true);
    assertTelemetry("costUsd", args.costUsd);
    assertTelemetry("latencyMs", args.latencyMs);
    const run = await ctx.db.query("runs").withIndex("by_runId", (q) => q.eq("runId", args.runId)).unique();
    const task = await ctx.db.query("tasks").withIndex("by_runIdAndId", (q) => q.eq("runId", args.runId).eq("id", args.id)).unique();
    if (run === null || run.status !== "running" || task === null) {
      throw new Error(`Cannot update an unknown task in inactive run ${args.runId}/${args.id}`);
    }
    assertTaskTransition(task.status, args.status);
    await ctx.db.patch(task._id, {
      status: args.status,
      attempts: args.attempts,
      modelPath: args.modelPath,
      costUsd: args.costUsd,
      latencyMs: args.latencyMs,
      evidence: args.evidence,
    });
  },
});
