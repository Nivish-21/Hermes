import { query } from "./_generated/server";
import { v } from "convex/values";
import { assertIngestKey } from "./ingest";

export const lastRunForRequester = query({
  args: {
    ingestKey: v.string(),
    requester: v.string(),
  },
  handler: async (ctx, args) => {
    assertIngestKey(args.ingestKey);
    const request = await ctx.db
      .query("requests")
      .withIndex("by_requesterAndTs", (q) => q.eq("requester", args.requester))
      .order("desc")
      .first();
    if (request === null) {
      return null;
    }
    const [run, tasks] = await Promise.all([
      ctx.db.query("runs").withIndex("by_runId", (q) => q.eq("runId", request.runId)).unique(),
      ctx.db.query("tasks").withIndex("by_runId", (q) => q.eq("runId", request.runId)).collect(),
    ]);
    const task = tasks.find((candidate) => candidate.requestId === request.id);
    return {
      runStatus: run?.status ?? "failed",
      taskStatus: task?.status ?? "failed",
      totalCostUsd: run?.totalCostUsd ?? 0,
      attempts: task?.attempts ?? 0,
    };
  },
});
