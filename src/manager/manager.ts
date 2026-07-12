import { randomUUID } from "node:crypto";
import "dotenv/config";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api.js";
import type { Channel, Request, SpecialistId, Task, TaskResult } from "../lib/types.js";
import { callModel, type ModelResponse } from "../router/modelRouter.js";
import { clearRunBudget } from "../router/budget.js";
import { normalizeBookingInstruction, runBookingTask } from "../specialists/booking.js";
import { runMessagingTask } from "../specialists/messaging.js";
import {
  normalizePublishInstruction,
  runPublishTask,
  type PublishCheckpoint,
} from "../specialists/publish.js";
import { runResearchTask, type ResearchBrief } from "../specialists/research.js";
import { endRun, recordTrace, startRun } from "../trace/tracer.js";

export type IncomingRequest = {
  id?: string;
  channel: Channel;
  requester: string;
  transcript: string;
  ts?: number;
};

type ManagerPlan = {
  specialist: SpecialistId;
  instruction: string;
};

type RoutedPlan = {
  plan: ManagerPlan;
  traceId: string;
};

type ManagerReview = {
  accept: boolean;
  notes: string;
};

export type ManagedRunResult = {
  request: Request;
  result: TaskResult;
};

function requiredEnv(name: "CONVEX_URL" | "OPENAI_API_KEY" | "TRACE_INGEST_KEY"): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function estimatedModelCost(): number {
  const value = process.env.SWITCHBOARD_ESTIMATED_MODEL_CALL_USD ?? "0.01";
  const costUsd = Number(value);
  if (!Number.isFinite(costUsd) || costUsd < 0) {
    throw new Error("SWITCHBOARD_ESTIMATED_MODEL_CALL_USD must be non-negative");
  }
  return costUsd;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseModelText(value: unknown): { text: string; promptTokens: number; completionTokens: number } {
  if (!isRecord(value) || !Array.isArray(value.choices) || !isRecord(value.usage)) {
    throw new Error("OpenAI returned an invalid response");
  }
  const choice = value.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message) || typeof choice.message.content !== "string") {
    throw new Error("OpenAI returned no text completion");
  }
  const promptTokens = value.usage.prompt_tokens;
  const completionTokens = value.usage.completion_tokens;
  if (typeof promptTokens !== "number" || typeof completionTokens !== "number") {
    throw new Error("OpenAI returned invalid token usage");
  }
  return { text: choice.message.content, promptTokens, completionTokens };
}

async function completeWithOpenAi(modelId: string, prompt: string): Promise<ModelResponse<string>> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${requiredEnv("OPENAI_API_KEY")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI completion failed with HTTP ${response.status}`);
  }
  const parsed = parseModelText(await response.json() as unknown);
  return {
    value: parsed.text,
    promptTokens: parsed.promptTokens,
    completionTokens: parsed.completionTokens,
    costUsd: estimatedModelCost(),
  };
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) {
      throw new Error("Model response was not a JSON object");
    }
    return parsed;
  } catch {
    throw new Error("Manager model must return a JSON object without markdown");
  }
}

function parsePlan(text: string): ManagerPlan {
  const parsed = parseJsonObject(text);
  const specialist = parsed.specialist;
  const instruction = parsed.instruction;
  if ((specialist !== "research" && specialist !== "messaging" && specialist !== "booking" && specialist !== "publish") || typeof instruction !== "string" || instruction.trim() === "") {
    throw new Error("Manager returned an invalid routing plan");
  }
  return { specialist, instruction };
}

function parseReview(text: string): ManagerReview {
  const parsed = parseJsonObject(text);
  if (typeof parsed.accept !== "boolean" || typeof parsed.notes !== "string") {
    throw new Error("Manager returned an invalid review");
  }
  return { accept: parsed.accept, notes: parsed.notes };
}

function convexClient(): ConvexHttpClient {
  return new ConvexHttpClient(requiredEnv("CONVEX_URL"));
}

async function persistRequest(request: Request): Promise<void> {
  await convexClient().mutation(api.requests.create, {
    ingestKey: requiredEnv("TRACE_INGEST_KEY"),
    ...request,
    status: "running",
  });
}

async function createTask(task: Task): Promise<void> {
  const instruction = task.params.instruction;
  if (typeof instruction !== "string") {
    throw new Error("Task instruction must be a string before persistence");
  }
  await convexClient().mutation(api.tasks.create, {
    ingestKey: requiredEnv("TRACE_INGEST_KEY"),
    ...task,
    params: { instruction },
    status: "running",
    attempts: 0,
    modelPath: [],
    costUsd: 0,
    latencyMs: 0,
  });
}

async function updateTask(task: Task, result: TaskResult, evidence: unknown = result.evidence): Promise<void> {
  await convexClient().mutation(api.tasks.update, {
    ingestKey: requiredEnv("TRACE_INGEST_KEY"),
    id: task.id,
    runId: task.runId,
    status: result.status,
    attempts: result.attempts,
    modelPath: result.modelPath,
    costUsd: result.costUsd,
    latencyMs: result.latencyMs,
    evidence: JSON.stringify(evidence),
  });
}

async function saveResearchEvidence(task: Task, brief: ResearchBrief): Promise<void> {
  await convexClient().mutation(api.tasks.update, {
    ingestKey: requiredEnv("TRACE_INGEST_KEY"),
    id: task.id,
    runId: task.runId,
    status: "running",
    attempts: 1,
    modelPath: [],
    costUsd: 0,
    latencyMs: 0,
    evidence: JSON.stringify(brief),
  });
}

async function savePublishCheckpoint(task: Task, checkpoint: PublishCheckpoint): Promise<void> {
  await convexClient().mutation(api.tasks.update, {
    ingestKey: requiredEnv("TRACE_INGEST_KEY"),
    id: task.id,
    runId: task.runId,
    status: "running",
    attempts: 1,
    modelPath: [],
    costUsd: 0,
    latencyMs: 0,
    evidence: JSON.stringify(checkpoint),
  });
}

async function routeRequest(request: Request): Promise<RoutedPlan> {
  const bookingTimeZone = process.env.CALCOM_TIME_ZONE?.trim() || "UTC";
  const currentTime = new Date().toISOString();
  const prompt = [
    "You are Switchboard's manager. Route this Telegram request to exactly one specialist.",
    "Return JSON only: {\"specialist\":\"research\"|\"messaging\"|\"booking\"|\"publish\",\"instruction\":\"...\"}.",
    "Use research for sourced web information, messaging for posts to the owned allowlisted channel, booking for calendar scheduling requests, and publish for replacing content on the owned Cloudflare live page.",
    "For booking only, instruction must itself be a JSON string with either {\"mode\":\"next_available\"} or {\"mode\":\"requested_time\",\"requestedStart\":\"ISO-8601 timestamp\"}. Include no names, email addresses, or free-form request text in that inner JSON.",
    "For publish only, instruction must itself be a JSON string with exactly {\"content\":\"the complete content to publish\"}. Do not include a URL, credentials, or any other field; the target is fixed by trusted configuration.",
    `Booking time context: current UTC time is ${currentTime}; calendar timezone is ${bookingTimeZone}.`,
    `Request: ${request.transcript}`,
  ].join("\n");
  const completion = await callModel({
    role: "manager",
    attempt: 1,
    context: { runId: request.runId, requestId: request.id },
    estimatedCostUsd: estimatedModelCost(),
    execute: (modelId) => completeWithOpenAi(modelId, prompt),
  });
  return { plan: parsePlan(completion.value), traceId: completion.traceId };
}

async function reviewResult(
  request: Request,
  task: Task,
  result: TaskResult,
  parentId: string,
): Promise<ManagerReview> {
  const prompt = [
    "You are Switchboard's manager reviewing a specialist result.",
    "Return JSON only: {\"accept\":true|false,\"notes\":\"...\"}.",
    "Accept only status=success with evidence. Reject otherwise.",
    `Request: ${request.transcript}`,
    `Specialist: ${task.template}`,
    `Result: ${JSON.stringify(result)}`,
  ].join("\n");
  const completion = await callModel({
    role: "manager",
    attempt: 1,
    context: { runId: request.runId, requestId: request.id, taskId: task.id, parentId },
    estimatedCostUsd: estimatedModelCost(),
    execute: (modelId) => completeWithOpenAi(modelId, prompt),
  });
  const review = parseReview(completion.value);
  await recordTrace({
    id: randomUUID(),
    runId: request.runId,
    requestId: request.id,
    taskId: task.id,
    parentId: completion.traceId,
    kind: "verify",
    model: completion.model,
    promptTok: 0,
    complTok: 0,
    costUsd: 0,
    latencyMs: 0,
    verifyPass: review.accept,
    ts: Date.now(),
  });
  return review;
}

function hasAttemptedResearchReply(evidence: unknown): boolean {
  return isRecord(evidence) && (
    evidence.replyAttempted === true || evidence.deliveredToTelegram === true
  );
}

async function executeTask(
  request: Request,
  task: Task,
  parentId: string,
): Promise<TaskResult> {
  const instruction = typeof task.params.instruction === "string" ? task.params.instruction : request.transcript;
  if (task.template === "research") {
    return runResearchTask(
      task,
      request.requester,
      instruction,
      async ({ brief }) => saveResearchEvidence(task, brief),
      parentId,
    );
  }
  if (task.template === "booking") {
    return runBookingTask(task, request.requester, instruction, parentId);
  }
  if (task.template === "publish") {
    return runPublishTask(
      task,
      request.requester,
      instruction,
      async (checkpoint) => savePublishCheckpoint(task, checkpoint),
      parentId,
    );
  }
  return runMessagingTask(task, request.requester, instruction, parentId);
}

export async function manageRequest(incoming: IncomingRequest): Promise<ManagedRunResult> {
  const runId = await startRun();
  const request: Request = {
    id: incoming.id ?? randomUUID(),
    runId,
    channel: incoming.channel,
    requester: incoming.requester,
    transcript: incoming.transcript,
    ts: incoming.ts ?? Date.now(),
  };

  try {
    await persistRequest(request);
    const routed = await routeRequest(request);
    const instruction = routed.plan.specialist === "booking"
      ? normalizeBookingInstruction(routed.plan.instruction)
      : routed.plan.specialist === "publish"
        ? normalizePublishInstruction(routed.plan.instruction)
        : routed.plan.instruction;
    const task: Task = {
      id: randomUUID(),
      runId,
      requestId: request.id,
      template: routed.plan.specialist,
      params: { instruction },
    };
    await createTask(task);
    let result = await executeTask(request, task, routed.traceId);
    await updateTask(task, result);
    const review = await reviewResult(request, task, result, routed.traceId);
    // Research can be revised only before a Telegram reply attempt;
    // no specialist is replayed after an irreversible external side effect.
    if (!review.accept && task.template === "research" && !hasAttemptedResearchReply(result.evidence)) {
      const retryTask: Task = {
        ...task,
        params: { instruction: `${routed.plan.instruction}\nRevision notes: ${review.notes}` },
      };
      result = await executeTask(request, retryTask, routed.traceId);
      await updateTask(retryTask, result);
    }
    return { request, result };
  } finally {
    try {
      await endRun(runId);
    } finally {
      clearRunBudget(runId);
    }
  }
}
