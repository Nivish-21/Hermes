import "dotenv/config";
import { randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { SpecialistId, TraceNode } from "../src/lib/types.js";

type SeedScenario = {
  template: SpecialistId;
  transcript: string;
  status: "success" | "failed";
  verifyPass: boolean;
};

const scenarios: SeedScenario[] = [
  { template: "research", transcript: "Research three current AI agent evaluation practices and send citations.", status: "success", verifyPass: true },
  { template: "messaging", transcript: "Post the demo readiness update to the allowlisted channel.", status: "success", verifyPass: true },
  { template: "research", transcript: "Research a deliberately ambiguous competitor query for rehearsal.", status: "failed", verifyPass: false },
];

function requiredEnv(name: "CONVEX_URL" | "MANAGER_MODEL_ID" | "TRACE_INGEST_KEY"): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0 || value.startsWith("your_") || value.startsWith("confirmed_")) {
    throw new Error(`${name} must be configured in .env before seeding`);
  }
  return value;
}

function cheapModelId(managerModel: string): string {
  const configuredModel = process.env.CHEAP_MODEL_ID?.trim();
  if (configuredModel === undefined || configuredModel.length === 0 || configuredModel.startsWith("confirmed_")) {
    return managerModel;
  }
  return configuredModel;
}

function node(input: Omit<TraceNode, "id" | "ts">): TraceNode {
  return { ...input, id: randomUUID(), ts: Date.now() };
}

async function seedScenario(client: ConvexHttpClient, ingestKey: string, scenario: SeedScenario): Promise<string> {
  const runId = randomUUID();
  const requestId = randomUUID();
  const taskId = randomUUID();
  const managerModel = requiredEnv("MANAGER_MODEL_ID");
  const cheapModel = cheapModelId(managerModel);

  await client.mutation(api.trace.startRun, { ingestKey, runId });
  await client.mutation(api.requests.create, {
    id: requestId,
    runId,
    channel: "text",
    requester: "demo-operator",
    transcript: scenario.transcript,
    ts: Date.now(),
    status: "completed",
  });
  await client.mutation(api.tasks.create, {
    id: taskId,
    runId,
    requestId,
    template: scenario.template,
    params: { rehearsal: true },
    status: scenario.status,
    attempts: 1,
    modelPath: [managerModel, cheapModel],
    costUsd: 0.006,
    latencyMs: 420,
  });

  const managerNode = node({
    runId,
    requestId,
    kind: "manager",
    model: managerModel,
    promptTok: 220,
    complTok: 95,
    costUsd: 0.012,
    latencyMs: 180,
  });
  const specialistNode = node({
    runId,
    requestId,
    taskId,
    parentId: managerNode.id,
    kind: "specialist",
    model: cheapModel,
    promptTok: 180,
    complTok: 120,
    costUsd: 0.006,
    latencyMs: 420,
  });
  const verifyNode = node({
    runId,
    requestId,
    taskId,
    parentId: specialistNode.id,
    kind: "verify",
    model: cheapModel,
    promptTok: 40,
    complTok: 10,
    costUsd: 0.001,
    latencyMs: 60,
    verifyPass: scenario.verifyPass,
  });

  await client.mutation(api.trace.recordTrace, { ingestKey, ...managerNode });
  await client.mutation(api.trace.recordTrace, { ingestKey, ...specialistNode });
  await client.mutation(api.trace.recordTrace, { ingestKey, ...verifyNode });
  await client.mutation(api.trace.endRun, { ingestKey, runId });
  return runId;
}

async function main(): Promise<void> {
  const client = new ConvexHttpClient(requiredEnv("CONVEX_URL"));
  const ingestKey = requiredEnv("TRACE_INGEST_KEY");
  const runIds = await Promise.all(scenarios.map(async (scenario) => await seedScenario(client, ingestKey, scenario)));
  console.log(JSON.stringify({ seededRunIds: runIds }, null, 2));
}

void main();
