import { mutation } from "./_generated/server";
import { v } from "convex/values";

const channel = v.union(v.literal("text"), v.literal("voice"), v.literal("dictation"));

export const create = mutation({
  args: {
    id: v.string(),
    runId: v.string(),
    channel,
    requester: v.string(),
    transcript: v.string(),
    ts: v.number(),
    status: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.insert("requests", args);
  },
});
