import { mutation } from "./_generated/server";
import { v } from "convex/values";

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
    await ctx.db.insert("tasks", args);
  },
});
