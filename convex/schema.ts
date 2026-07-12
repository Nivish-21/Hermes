import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const channel = v.union(v.literal("text"), v.literal("voice"), v.literal("dictation"));
const specialist = v.union(v.literal("research"), v.literal("messaging"));
const taskStatus = v.union(v.literal("pending"), v.literal("running"), v.literal("success"), v.literal("failed"), v.literal("escalated"));
const traceKind = v.union(v.literal("manager"), v.literal("specialist"), v.literal("verify"), v.literal("escalation"));
const params = v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.null()));

export default defineSchema({
  requests: defineTable({
    id: v.string(),
    runId: v.string(),
    channel,
    requester: v.string(),
    transcript: v.string(),
    ts: v.number(),
    status: v.string(),
  }).index("by_runId", ["runId"]),

  tasks: defineTable({
    id: v.string(),
    runId: v.string(),
    requestId: v.string(),
    template: specialist,
    params,
    status: taskStatus,
    attempts: v.number(),
    modelPath: v.array(v.string()),
    costUsd: v.number(),
    latencyMs: v.number(),
  }).index("by_runId", ["runId"]),

  traceNodes: defineTable({
    id: v.string(),
    runId: v.string(),
    requestId: v.string(),
    taskId: v.optional(v.string()),
    kind: traceKind,
    model: v.string(),
    promptTok: v.number(),
    complTok: v.number(),
    costUsd: v.number(),
    latencyMs: v.number(),
    verifyPass: v.optional(v.boolean()),
    parentId: v.optional(v.string()),
    ts: v.number(),
  }).index("by_runId", ["runId"]),

  runs: defineTable({
    runId: v.string(),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    requestCount: v.number(),
    successCount: v.number(),
    escalationCount: v.number(),
    totalCostUsd: v.number(),
    status: v.union(v.literal("running"), v.literal("success"), v.literal("failed")),
  }).index("by_runId", ["runId"]),

  costLog: defineTable({
    runId: v.string(),
    ts: v.number(),
    model: v.string(),
    promptTok: v.number(),
    complTok: v.number(),
    costUsd: v.number(),
    role: v.string(),
  }).index("by_runId", ["runId"]),
});
