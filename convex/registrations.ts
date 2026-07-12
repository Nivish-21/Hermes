import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { assertIngestKey } from "./ingest";

export type Registration = {
  email: string;
  name?: string;
  company?: string;
};

type RateLimitState = {
  windowStartedAt: number;
  attempts: number;
};

export function evaluateRateLimit(
  current: RateLimitState | null,
  now: number,
  limit: number,
  windowMs: number,
): { allowed: boolean; next: RateLimitState; retryAfterMs: number } {
  if (current === null || now - current.windowStartedAt >= windowMs) {
    return { allowed: true, next: { windowStartedAt: now, attempts: 1 }, retryAfterMs: 0 };
  }
  if (current.attempts >= limit) {
    return {
      allowed: false,
      next: current,
      retryAfterMs: Math.max(1, windowMs - (now - current.windowStartedAt)),
    };
  }
  return {
    allowed: true,
    next: { ...current, attempts: current.attempts + 1 },
    retryAfterMs: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalText(value: unknown, field: "name" | "company", maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(`${field} must be at most ${maxLength} characters`);
  }
  return normalized === "" ? undefined : normalized;
}

export function validateRegistration(value: unknown): Registration {
  if (!isRecord(value) || typeof value.email !== "string") {
    throw new Error("email is required");
  }
  const email = value.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("email must be valid");
  }
  const name = optionalText(value.name, "name", 100);
  const company = optionalText(value.company, "company", 160);
  return {
    email,
    ...(name === undefined ? {} : { name }),
    ...(company === undefined ? {} : { company }),
  };
}

export const submit = internalMutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    company: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const existing = await ctx.db
      .query("registrations")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();
    const now = Date.now();
    if (existing === null) {
      await ctx.db.insert("registrations", { ...args, createdAt: now, updatedAt: now });
      return;
    }
    await ctx.db.patch(existing._id, { ...args, updatedAt: now });
  },
});

export const consumeRateLimit = internalMutation({
  args: { key: v.string(), now: v.number(), limit: v.number(), windowMs: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("registrationRateLimits").withIndex("by_key", (q) => q.eq("key", args.key)).unique();
    const result = evaluateRateLimit(existing, args.now, args.limit, args.windowMs);
    if (result.allowed) {
      if (existing === null) {
        await ctx.db.insert("registrationRateLimits", { key: args.key, ...result.next });
      } else {
        await ctx.db.patch(existing._id, result.next);
      }
    }
    return { allowed: result.allowed, retryAfterMs: result.retryAfterMs };
  },
});

export const listForOperator = query({
  args: { ingestKey: v.string() },
  handler: async (ctx, args) => {
    assertIngestKey(args.ingestKey);
    return await ctx.db.query("registrations").withIndex("by_createdAt").order("desc").collect();
  },
});
