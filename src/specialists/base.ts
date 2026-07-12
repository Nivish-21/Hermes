import { randomUUID } from "node:crypto";
import type { Task, TaskResult, TraceNode } from "../lib/types.js";
import { pickModel } from "../router/modelRouter.js";
import { recordTrace } from "../trace/tracer.js";

export type Verification<TEvidence> = {
  ok: boolean;
  evidence: TEvidence;
  reason?: string;
};

export type OavrContext = {
  task: Task;
  requester: string;
  parentId?: string;
};

export type OavrTask<TState, TAction, TEvidence> = {
  observe: (context: OavrContext) => Promise<TState>;
  act: (state: TState, model: string, context: OavrContext) => Promise<TAction>;
  verify: (action: TAction, context: OavrContext) => Promise<Verification<TEvidence>>;
  recover: (reason: string, context: OavrContext) => Promise<void>;
};

const MAX_ATTEMPTS = 3;

function traceNode(
  task: Task,
  kind: TraceNode["kind"],
  model: string,
  verifyPass?: boolean,
  parentId?: string,
): TraceNode {
  return {
    id: randomUUID(),
    runId: task.runId,
    requestId: task.requestId,
    taskId: task.id,
    kind,
    model,
    promptTok: 0,
    complTok: 0,
    costUsd: 0,
    latencyMs: 0,
    ...(verifyPass === undefined ? {} : { verifyPass }),
    ...(parentId === undefined ? {} : { parentId }),
    ts: Date.now(),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown OAVR failure";
}

async function traceSafely(node: TraceNode): Promise<string | undefined> {
  try {
    await recordTrace(node);
    return undefined;
  } catch (error: unknown) {
    return `Trace write failed: ${errorMessage(error)}`;
  }
}

async function recoverSafely<TState, TAction, TEvidence>(
  definition: OavrTask<TState, TAction, TEvidence>,
  reason: string,
  context: OavrContext,
): Promise<string | undefined> {
  try {
    await definition.recover(reason, context);
    return undefined;
  } catch (error: unknown) {
    return `Recovery failed: ${errorMessage(error)}`;
  }
}

export async function runOavr<TState, TAction, TEvidence>(
  definition: OavrTask<TState, TAction, TEvidence>,
  context: OavrContext,
): Promise<TaskResult> {
  const modelPath: string[] = [];
  const startedAt = Date.now();
  let lastEvidence: TEvidence | { reason: string } = { reason: "No attempt completed" };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const model = pickModel(attempt);
    modelPath.push(model);

    const specialistNode = traceNode(
      context.task,
      "specialist",
      model,
      undefined,
      context.parentId,
    );
    const specialistTraceFailure = await traceSafely(specialistNode);
    if (specialistTraceFailure !== undefined) {
      lastEvidence = { reason: specialistTraceFailure };
      const recoveryFailure = await recoverSafely(definition, specialistTraceFailure, context);
      if (recoveryFailure !== undefined) {
        lastEvidence = { reason: `${specialistTraceFailure}; ${recoveryFailure}` };
      }
      continue;
    }

    try {
      const state = await definition.observe(context);
      const action = await definition.act(state, model, context);
      const verification = await definition.verify(action, context);
      lastEvidence = verification.evidence;

      const verificationTraceFailure = await traceSafely(
        traceNode(
          context.task,
          "verify",
          model,
          verification.ok,
          specialistNode.id,
        ),
      );
      if (verificationTraceFailure !== undefined) {
        lastEvidence = { reason: verificationTraceFailure };
        const recoveryFailure = await recoverSafely(definition, verificationTraceFailure, context);
        if (recoveryFailure !== undefined) {
          lastEvidence = { reason: `${verificationTraceFailure}; ${recoveryFailure}` };
        }
        continue;
      }

      if (verification.ok) {
        return {
          taskId: context.task.id,
          runId: context.task.runId,
          status: "success",
          evidence: verification.evidence,
          attempts: attempt,
          modelPath,
          costUsd: 0,
          latencyMs: Date.now() - startedAt,
        };
      }

      const recoveryFailure = await recoverSafely(
        definition,
        verification.reason ?? "Verification failed",
        context,
      );
      if (recoveryFailure !== undefined) {
        lastEvidence = { reason: recoveryFailure };
      }
    } catch (error: unknown) {
      const reason = errorMessage(error);
      lastEvidence = { reason };
      const failureTraceError = await traceSafely(
        traceNode(context.task, "verify", model, false, specialistNode.id),
      );
      const recoveryFailure = await recoverSafely(definition, reason, context);
      if (failureTraceError !== undefined || recoveryFailure !== undefined) {
        lastEvidence = { reason: [reason, failureTraceError, recoveryFailure].filter((part): part is string => part !== undefined).join("; ") };
      }
    }
  }

  const escalationModel = pickModel(MAX_ATTEMPTS);
  const escalationTraceFailure = await traceSafely(
    traceNode(context.task, "escalation", escalationModel, false, context.parentId),
  );
  if (escalationTraceFailure !== undefined) {
    lastEvidence = { reason: escalationTraceFailure };
  }
  return {
    taskId: context.task.id,
    runId: context.task.runId,
    status: "escalated",
    evidence: lastEvidence,
    attempts: MAX_ATTEMPTS,
    modelPath,
    costUsd: 0,
    latencyMs: Date.now() - startedAt,
  };
}
