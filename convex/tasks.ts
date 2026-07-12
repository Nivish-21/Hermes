import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { assertTelemetry } from "./ingest";

const specialist = v.union(v.literal("research"), v.literal("messaging"));
const taskStatus = v.union(v.literal("pending"), v.literal("running"), v.literal("success"), v.literal("failed"), v.literal("escalated"));
const params = v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.null()));

export const create = mutation({
  args: {
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
    assertTelemetry("attempts", args.attempts, true);
    assertTelemetry("costUsd", args.costUsd);
    assertTelemetry("latencyMs", args.latencyMs);
    const run = await ctx.db.query("runs").withIndex("by_runId", (q) => q.eq("runId", args.runId)).unique();
    if (run === null || run.status !== "running") {
      throw new Error(`Cannot add a task to inactive run ${args.runId}`);
    }
    await ctx.db.insert("tasks", args);
  },
});
