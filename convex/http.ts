import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { validateRegistration } from "./registrations";

const http = httpRouter();

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const RATE_WINDOW_MS = 60 * 60 * 1_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function hash(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requesterAddress(request: Request): string | null {
  const forwarded = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0];
  return forwarded?.trim() || null;
}

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

http.route({
  path: "/register",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
});

http.route({
  path: "/register",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Request body must be valid JSON." }, 400);
    }
    try {
      if (isRecord(body) && typeof body.website === "string" && body.website.trim() !== "") {
        return json({ registered: true }, 201);
      }
      const registration = validateRegistration(body);
      const now = Date.now();
      const keys: Array<{ key: string; limit: number }> = [
        { key: `email:${await hash(registration.email)}`, limit: 5 },
      ];
      const address = requesterAddress(request);
      if (address !== null) keys.push({ key: `network:${await hash(address)}`, limit: 20 });
      for (const entry of keys) {
        const rate = await ctx.runMutation(internal.registrations.consumeRateLimit, {
          key: entry.key,
          now,
          limit: entry.limit,
          windowMs: RATE_WINDOW_MS,
        });
        if (!rate.allowed) {
          return new Response(JSON.stringify({ error: "Too many registration attempts. Please try again later." }), {
            status: 429,
            headers: {
              "content-type": "application/json",
              "retry-after": String(Math.ceil(rate.retryAfterMs / 1_000)),
              ...corsHeaders,
            },
          });
        }
      }
      await ctx.runMutation(internal.registrations.submit, registration);
      return json({ registered: true }, 201);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Registration could not be completed.";
      return json({ error: message }, 400);
    }
  }),
});

export default http;
