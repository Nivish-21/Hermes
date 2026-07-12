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

type RequesterRunCandidate = {
  requester: string;
  runId: string;
  ts: number;
};

export function selectLatestRequesterRun<T extends RequesterRunCandidate>(
  requests: ReadonlyArray<T>,
  requester: string,
): { runId: string; requestedAt: number } | null {
  const latest = requests
    .filter((request) => request.requester === requester)
    .reduce<T | null>(
      (selected, request) => selected === null || request.ts > selected.ts ? request : selected,
      null,
    );
  return latest === null ? null : { runId: latest.runId, requestedAt: latest.ts };
}

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
    const requests = await ctx.db
      .query("requests")
      .withIndex("by_requesterAndTs", (q) => q.eq("requester", args.requester))
      .order("desc")
      .take(1);
    const selected = selectLatestRequesterRun(requests, args.requester);
    if (selected === null) {
      return null;
    }

    const [run, costs] = await Promise.all([
      ctx.db.query("runs").withIndex("by_runId", (q) => q.eq("runId", selected.runId)).unique(),
      ctx.db.query("costLog").withIndex("by_runId", (q) => q.eq("runId", selected.runId)).collect(),
    ]);
    const { routedCostUsd, frontierEstimateUsd } = totalRequesterCosts(costs);
    return {
      requestedAt: selected.requestedAt,
      status: run?.status ?? "running",
      routedCostUsd,
      frontierEstimateUsd,
    };
  },
});
