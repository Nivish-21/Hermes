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
    ts: Date.now(),
  };
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

    try {
      const state = await definition.observe(context);
      const action = await definition.act(state, model, context);
      await recordTrace(traceNode(context.task, "specialist", model));

      const verification = await definition.verify(action, context);
      lastEvidence = verification.evidence;
      await recordTrace(
        traceNode(context.task, "verify", model, verification.ok),
      );

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

      await definition.recover(
        verification.reason ?? "Verification failed",
        context,
      );
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : "Unknown OAVR failure";
      lastEvidence = { reason };
      await recordTrace(traceNode(context.task, "verify", model, false));
      await definition.recover(reason, context);
    }
  }

  const escalationModel = pickModel(2);
  await recordTrace(traceNode(context.task, "escalation", escalationModel, false));
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
