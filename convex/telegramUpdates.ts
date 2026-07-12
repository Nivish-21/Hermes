import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { assertIngestKey } from "./ingest";

const terminalStatus = v.union(v.literal("succeeded"), v.literal("failed"));

export const claim = mutation({
  args: {
    ingestKey: v.string(),
    updateId: v.number(),
    messageId: v.number(),
    senderId: v.string(),
    receivedAt: v.number(),
  },
  handler: async (ctx, args): Promise<{ claimed: boolean; status: "claimed" | "succeeded" | "failed" }> => {
    assertIngestKey(args.ingestKey);
    const existing = await ctx.db.query("telegramUpdates").withIndex("by_updateId", (q) => q.eq("updateId", args.updateId)).unique();
    if (existing !== null) {
      return { claimed: false, status: existing.status };
    }
    await ctx.db.insert("telegramUpdates", {
      updateId: args.updateId,
      messageId: args.messageId,
      senderId: args.senderId,
      receivedAt: args.receivedAt,
      status: "claimed",
    });
    return { claimed: true, status: "claimed" };
  },
});

export const complete = mutation({
  args: {
    ingestKey: v.string(),
    updateId: v.number(),
    status: terminalStatus,
    runId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    assertIngestKey(args.ingestKey);
    const update = await ctx.db.query("telegramUpdates").withIndex("by_updateId", (q) => q.eq("updateId", args.updateId)).unique();
    if (update === null) {
      throw new Error(`Unknown Telegram update ${args.updateId}`);
    }
    if (update.status !== "claimed") {
      return;
    }
    await ctx.db.patch(update._id, {
      status: args.status,
      completedAt: Date.now(),
      ...(args.runId === undefined ? {} : { runId: args.runId }),
      ...(args.error === undefined ? {} : { error: args.error }),
    });
  },
});
