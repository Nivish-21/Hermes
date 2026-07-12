export type Channel = "text" | "voice" | "dictation";
export type SpecialistId = "research" | "messaging" | "booking" | "publish";

// runId groups every node of ONE request together. The dashboard groups by it — do not omit it.
export type Request = {
  id: string; runId: string; channel: Channel; requester: string; transcript: string; ts: number;
};
export type Task = {
  id: string; runId: string; requestId: string; template: SpecialistId; params: Record<string, unknown>;
};
export type TaskResult = {
  taskId: string; runId: string; status: "success" | "failed" | "escalated";
  evidence: unknown; attempts: number; modelPath: string[]; costUsd: number; latencyMs: number;
};
export type TraceNode = {
  id: string; runId: string; requestId: string; taskId?: string;
  kind: "manager" | "specialist" | "verify" | "escalation";
  model: string; promptTok: number; complTok: number; costUsd: number; latencyMs: number;
  verifyPass?: boolean; parentId?: string; ts: number;
};
