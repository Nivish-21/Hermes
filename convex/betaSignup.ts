import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { assertIngestKey } from "./ingest";

const signupStatus = v.union(v.literal("pending"), v.literal("approved"), v.literal("blocked"));

export const request = mutation({
  args: { ingestKey: v.string(), telegramUserId: v.string() },
  handler: async (ctx, args): Promise<"pending" | "approved" | "blocked"> => {
    assertIngestKey(args.ingestKey);
    const existing = await ctx.db
      .query("betaSignups")
      .withIndex("by_telegramUserId", (q) => q.eq("telegramUserId", args.telegramUserId))
      .unique();
    if (existing !== null) {
      return existing.status;
    }
    const now = Date.now();
    await ctx.db.insert("betaSignups", {
      telegramUserId: args.telegramUserId,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    return "pending";
  },
});

export const status = query({
  args: { ingestKey: v.string(), telegramUserId: v.string() },
  handler: async (ctx, args): Promise<"pending" | "approved" | "blocked" | null> => {
    assertIngestKey(args.ingestKey);
    const signup = await ctx.db
      .query("betaSignups")
      .withIndex("by_telegramUserId", (q) => q.eq("telegramUserId", args.telegramUserId))
      .unique();
    return signup?.status ?? null;
  },
});

export const approve = mutation({
  args: { ingestKey: v.string(), telegramUserId: v.string(), status: signupStatus },
  handler: async (ctx, args): Promise<void> => {
    assertIngestKey(args.ingestKey);
    const signup = await ctx.db
      .query("betaSignups")
      .withIndex("by_telegramUserId", (q) => q.eq("telegramUserId", args.telegramUserId))
      .unique();
    if (signup === null) {
      throw new Error(`No beta signup exists for ${args.telegramUserId}`);
    }
    await ctx.db.patch(signup._id, { status: args.status, updatedAt: Date.now() });
  },
});
