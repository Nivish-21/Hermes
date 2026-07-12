export function assertIngestKey(ingestKey: string): void {
  const expectedKey = process.env.TRACE_INGEST_KEY;
  if (expectedKey === undefined || expectedKey.length === 0) {
    throw new Error("TRACE_INGEST_KEY is not configured on the Convex deployment");
  }
  if (ingestKey !== expectedKey) {
    throw new Error("Unauthorized trace ingestion request");
  }
}

export function assertTelemetry(name: string, value: number, integer = false): void {
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`${name} must be a ${integer ? "non-negative integer" : "finite non-negative number"}`);
  }
}
