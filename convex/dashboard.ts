import { query } from "./_generated/server";
import { v } from "convex/values";

// The judges' dashboard is intentionally public, but this module exposes only
// a sanitized demo projection. Raw requests, requesters, transcripts, task params,
// task IDs, and Convex document IDs are never returned to browser clients.
export const listRuns = query({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.db.query("runs").order("desc").take(25);
    return runs.map((run) => ({
      runId: run.runId,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      successCount: run.successCount,
      escalationCount: run.escalationCount,
      totalCostUsd: run.totalCostUsd,
      status: run.status,
    }));
  },
});

export const getRunData = query({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    const nodes = await ctx.db.query("traceNodes").withIndex("by_runId", (q) => q.eq("runId", args.runId)).collect();
    const costs = await ctx.db.query("costLog").withIndex("by_runId", (q) => q.eq("runId", args.runId)).collect();
    const actualCostUsd = costs.reduce((total, entry) => total + entry.costUsd, 0);
    const frontierOnlyEstimateUsd = costs.reduce((total, entry) => total + (entry.frontierCostUsd ?? entry.costUsd), 0);
    return {
      actualCostUsd,
      frontierOnlyEstimateUsd,
      nodes: nodes.map((node) => ({
        id: node.id,
        runId: node.runId,
        kind: node.kind,
        model: node.model,
        promptTok: node.promptTok,
        complTok: node.complTok,
        costUsd: node.costUsd,
        latencyMs: node.latencyMs,
        verifyPass: node.verifyPass,
        parentId: node.parentId,
        ts: node.ts,
      })),
    };
  },
});
