import { mutation } from "./_generated/server";
import { v } from "convex/values";

const traceKind = v.union(v.literal("manager"), v.literal("specialist"), v.literal("verify"), v.literal("escalation"));

export const startRun = mutation({
  args: { runId: v.string() },
  handler: async (ctx, args): Promise<void> => {
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
    await ctx.db.insert("traceNodes", args);
    await ctx.db.insert("costLog", {
      runId: args.runId,
      ts: args.ts,
      model: args.model,
      promptTok: args.promptTok,
      complTok: args.complTok,
      costUsd: args.costUsd,
      role: args.kind,
    });
    const run = await ctx.db.query("runs").withIndex("by_runId", (q) => q.eq("runId", args.runId)).unique();
    if (run !== null) {
      await ctx.db.patch(run._id, { totalCostUsd: run.totalCostUsd + args.costUsd });
    }
  },
});

export const endRun = mutation({
  args: { runId: v.string(), status: v.union(v.literal("success"), v.literal("failed")) },
  handler: async (ctx, args): Promise<void> => {
    const run = await ctx.db.query("runs").withIndex("by_runId", (q) => q.eq("runId", args.runId)).unique();
    if (run === null) {
      return;
    }
    const nodes = await ctx.db.query("traceNodes").withIndex("by_runId", (q) => q.eq("runId", args.runId)).collect();
    const successCount = nodes.filter((node) => node.verifyPass === true).length;
    const escalationCount = nodes.filter((node) => node.kind === "escalation").length;
    await ctx.db.patch(run._id, {
      endedAt: Date.now(),
      successCount,
      escalationCount,
      status: args.status,
    });
  },
});
