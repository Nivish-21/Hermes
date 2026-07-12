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
      const registration = validateRegistration(body);
      await ctx.runMutation(internal.registrations.submit, registration);
      return json({ registered: true }, 201);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Registration could not be completed.";
      return json({ error: message }, 400);
    }
  }),
});

export default http;
