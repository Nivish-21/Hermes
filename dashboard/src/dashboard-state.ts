export function isDashboardLoading(
  runsResult: readonly unknown[] | undefined,
  selectedRun: unknown | undefined,
  runData: unknown | undefined,
): boolean {
  if (runsResult === undefined) return true;
  return runsResult.length > 0 && (selectedRun === undefined || runData === undefined);
}
