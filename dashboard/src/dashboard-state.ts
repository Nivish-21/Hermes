export function isDashboardLoading(
  runsResult: readonly unknown[] | undefined,
  selectedRun: unknown | undefined,
  runData: unknown | undefined,
): boolean {
  if (runsResult === undefined) return true;
  return runsResult.length > 0 && (selectedRun === undefined || runData === undefined);
}

export type RunStatusFilter = "all" | "success" | "failed" | "running";

export function filterRunsByStatus<T extends { status: string }>(runs: readonly T[], filter: RunStatusFilter): T[] {
  return filter === "all" ? [...runs] : runs.filter((run) => run.status === filter);
}
