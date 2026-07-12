export class BudgetExceededError extends Error {
  public readonly runId: string;
  public readonly attemptedUsd: number;
  public readonly limitUsd: number;

  public constructor(runId: string, attemptedUsd: number, limitUsd: number) {
    super(
      `Run ${runId} would exceed the USD budget: ${attemptedUsd.toFixed(6)} > ${limitUsd.toFixed(6)}`,
    );
    this.name = "BudgetExceededError";
    this.runId = runId;
    this.attemptedUsd = attemptedUsd;
    this.limitUsd = limitUsd;
  }
}

const reservedByRun = new Map<string, number>();

function readUsdLimit(): number {
  const rawLimit = process.env.SWITCHBOARD_MAX_USD_PER_RUN;
  if (rawLimit === undefined || rawLimit.trim() === "") {
    throw new Error("SWITCHBOARD_MAX_USD_PER_RUN is required");
  }

  const limit = Number(rawLimit);
  if (!Number.isFinite(limit) || limit < 0) {
    throw new Error("SWITCHBOARD_MAX_USD_PER_RUN must be a non-negative number");
  }
  return limit;
}

function validateCost(costUsd: number): void {
  if (!Number.isFinite(costUsd) || costUsd < 0) {
    throw new Error("Model costUsd must be a finite, non-negative number");
  }
}

export function getRunSpend(runId: string): number {
  return reservedByRun.get(runId) ?? 0;
}

export function reserveBudget(runId: string, costUsd: number): void {
  validateCost(costUsd);
  const limitUsd = readUsdLimit();
  const attemptedUsd = getRunSpend(runId) + costUsd;
  if (attemptedUsd > limitUsd) {
    throw new BudgetExceededError(runId, attemptedUsd, limitUsd);
  }
  reservedByRun.set(runId, attemptedUsd);
}

export function settleBudget(runId: string, estimatedUsd: number, actualUsd: number): void {
  validateCost(estimatedUsd);
  validateCost(actualUsd);

  const currentSpend = getRunSpend(runId);
  const settledSpend = currentSpend - estimatedUsd + actualUsd;
  const limitUsd = readUsdLimit();
  if (settledSpend > limitUsd) {
    throw new BudgetExceededError(runId, settledSpend, limitUsd);
  }
  reservedByRun.set(runId, settledSpend);
}

export function releaseBudget(runId: string, costUsd: number): void {
  validateCost(costUsd);
  const remainingSpend = Math.max(0, getRunSpend(runId) - costUsd);
  if (remainingSpend === 0) {
    reservedByRun.delete(runId);
    return;
  }
  reservedByRun.set(runId, remainingSpend);
}

export function clearRunBudget(runId: string): void {
  reservedByRun.delete(runId);
}
