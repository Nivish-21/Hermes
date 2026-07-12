import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  BudgetExceededError,
  clearRunBudget,
  getRunSpend,
  releaseBudget,
  reserveBudget,
  settleBudget,
} from "../src/router/budget.js";

const runId = "budget-settlement-regression";

function withBudgetLimit(limit: string, execute: () => void): void {
  const previous = process.env.SWITCHBOARD_MAX_USD_PER_RUN;
  process.env.SWITCHBOARD_MAX_USD_PER_RUN = limit;
  try {
    execute();
  } finally {
    clearRunBudget(runId);
    if (previous === undefined) {
      delete process.env.SWITCHBOARD_MAX_USD_PER_RUN;
    } else {
      process.env.SWITCHBOARD_MAX_USD_PER_RUN = previous;
    }
  }
}

test("failed settlement releases the entire reservation", () => {
  withBudgetLimit("0.10", () => {
    reserveBudget(runId, 0.05);
    assert.throws(
      () => settleBudget(runId, 0.05, 0.11),
      BudgetExceededError,
    );
    releaseBudget(runId, 0.05);
    assert.equal(getRunSpend(runId), 0);
  });
});
