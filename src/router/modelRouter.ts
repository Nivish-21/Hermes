import { randomUUID } from "node:crypto";
import type { SpecialistId, TraceNode } from "../lib/types.js";
import { recordTrace } from "../trace/tracer.js";
import { releaseBudget, reserveBudget, settleBudget } from "./budget.js";

export type ModelRole = "manager" | "specialist";

export type ModelCallContext = {
  runId: string;
  requestId: string;
  taskId?: string;
  parentId?: string;
  specialist?: SpecialistId;
};

export type ModelResponse<T> = {
  value: T;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
};

export type TracedModelResponse<T> = ModelResponse<T> & {
  traceId: string;
};

export type ModelExecutor<T> = (
  modelId: string,
) => Promise<ModelResponse<T>>;

export type ModelCallInput<T> = {
  role: ModelRole;
  attempt: number;
  context: ModelCallContext;
  estimatedCostUsd: number;
  execute: ModelExecutor<T>;
};

function requiredModelId(name: "MANAGER_MODEL_ID" | "CHEAP_MODEL_ID"): string {
  const modelId = process.env[name]?.trim();
  if (modelId === undefined || modelId === "") {
    throw new Error(`${name} is required in the environment`);
  }
  return modelId;
}

export function pickModel(attempt: number, role: ModelRole = "specialist"): string {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error("Model attempt must be a positive integer");
  }

  const managerModelId = requiredModelId("MANAGER_MODEL_ID");
  if (role === "manager" || attempt > 2) {
    return managerModelId;
  }

  return process.env.CHEAP_MODEL_ID?.trim() || managerModelId;
}

function validateTokenCount(name: string, count: number): void {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function traceKind(role: ModelRole): TraceNode["kind"] {
  return role === "manager" ? "manager" : "specialist";
}

export async function callModel<T>(input: ModelCallInput<T>): Promise<TracedModelResponse<T>> {
  const model = pickModel(input.attempt, input.role);
  reserveBudget(input.context.runId, input.estimatedCostUsd);
  const startedAt = Date.now();

  try {
    const response = await input.execute(model);
    validateTokenCount("promptTokens", response.promptTokens);
    validateTokenCount("completionTokens", response.completionTokens);

    const latencyMs = Date.now() - startedAt;
    settleBudget(
      input.context.runId,
      input.estimatedCostUsd,
      response.costUsd,
    );

    const node: TraceNode = {
      id: randomUUID(),
      runId: input.context.runId,
      requestId: input.context.requestId,
      ...(input.context.taskId === undefined
        ? {}
        : { taskId: input.context.taskId }),
      ...(input.context.parentId === undefined
        ? {}
        : { parentId: input.context.parentId }),
      kind: traceKind(input.role),
      model,
      promptTok: response.promptTokens,
      complTok: response.completionTokens,
      costUsd: response.costUsd,
      latencyMs,
      ts: Date.now(),
    };
    await recordTrace(node);
    return { ...response, traceId: node.id };
  } catch (error: unknown) {
    releaseBudget(input.context.runId, input.estimatedCostUsd);
    throw error;
  }
}
