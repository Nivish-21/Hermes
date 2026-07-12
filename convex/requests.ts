import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { assertIngestKey } from "./ingest";

const channel = v.union(v.literal("text"), v.literal("voice"), v.literal("dictation"));

export const create = mutation({
  args: {
    ingestKey: v.string(),
    id: v.string(),
    runId: v.string(),
    channel,
    requester: v.string(),
    transcript: v.string(),
    ts: v.number(),
    status: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    assertIngestKey(args.ingestKey);
    const run = await ctx.db.query("runs").withIndex("by_runId", (q) => q.eq("runId", args.runId)).unique();
    if (run === null || run.status !== "running") {
      throw new Error(`Cannot add a request to inactive run ${args.runId}`);
    }
    const existing = await ctx.db.query("requests").withIndex("by_runIdAndId", (q) => q.eq("runId", args.runId).eq("id", args.id)).unique();
    if (existing !== null) {
      if (existing.channel !== args.channel || existing.requester !== args.requester || existing.transcript !== args.transcript || existing.ts !== args.ts) {
        throw new Error(`Conflicting request replay ${args.runId}/${args.id}`);
      }
      return;
    }
    const { ingestKey: _, ...request } = args;
    await ctx.db.insert("requests", request);
  },
});
