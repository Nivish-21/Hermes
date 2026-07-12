import { query } from "./_generated/server";
import { v } from "convex/values";
import { assertIngestKey } from "./ingest";

export type RequesterActivity = {
  requestedAt: number;
  status: "running" | "success" | "failed";
  routedCostUsd: number;
  frontierEstimateUsd: number;
};

type CostEntry = {
  costUsd: number;
  frontierCostUsd?: number;
};

export function totalRequesterCosts(costs: ReadonlyArray<CostEntry>): Pick<RequesterActivity, "routedCostUsd" | "frontierEstimateUsd"> {
  return {
    routedCostUsd: costs.reduce((total, entry) => total + entry.costUsd, 0),
    frontierEstimateUsd: costs.reduce(
      (total, entry) => total + (entry.frontierCostUsd ?? entry.costUsd),
      0,
    ),
  };
}

export const latest = query({
  args: { ingestKey: v.string(), requester: v.string() },
  handler: async (ctx, args): Promise<RequesterActivity | null> => {
    assertIngestKey(args.ingestKey);
    const request = await ctx.db
      .query("requests")
      .withIndex("by_requesterAndTs", (q) => q.eq("requester", args.requester))
      .order("desc")
      .first();
    if (request === null) {
      return null;
    }

    const [run, costs] = await Promise.all([
      ctx.db.query("runs").withIndex("by_runId", (q) => q.eq("runId", request.runId)).unique(),
      ctx.db.query("costLog").withIndex("by_runId", (q) => q.eq("runId", request.runId)).collect(),
    ]);
    const { routedCostUsd, frontierEstimateUsd } = totalRequesterCosts(costs);
    return {
      requestedAt: request.ts,
      status: run?.status ?? "running",
      routedCostUsd,
      frontierEstimateUsd,
    };
  },
});
