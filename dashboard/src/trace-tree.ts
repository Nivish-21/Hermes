export type TraceNodeView = {
  id: string;
  runId: string;
  kind: "manager" | "specialist" | "verify" | "escalation";
  model: string;
  promptTok: number;
  complTok: number;
  costUsd: number;
  latencyMs: number;
  verifyPass: boolean | undefined;
  parentId: string | undefined;
  ts: number;
};

export type TraceBranchView = {
  node: TraceNodeView;
  children: TraceBranchView[];
};

export function buildTraceForest(nodes: TraceNodeView[]): TraceBranchView[] {
  const ordered = [...nodes].sort((a, b) => a.ts - b.ts);
  const byId = new Map(ordered.map((node) => [node.id, node]));
  const childrenByParent = new Map<string, TraceNodeView[]>();

  for (const node of ordered) {
    if (node.parentId === undefined || node.parentId === node.id || !byId.has(node.parentId)) continue;
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  }

  const visited = new Set<string>();
  const buildBranch = (node: TraceNodeView, ancestors: Set<string>): TraceBranchView => {
    visited.add(node.id);
    const nextAncestors = new Set(ancestors).add(node.id);
    const children = (childrenByParent.get(node.id) ?? [])
      .filter((child) => !nextAncestors.has(child.id))
      .map((child) => buildBranch(child, nextAncestors));
    return { node, children };
  };

  const roots = ordered.filter(
    (node) => node.parentId === undefined || node.parentId === node.id || !byId.has(node.parentId),
  );
  const forest = roots.map((root) => buildBranch(root, new Set()));

  // Malformed cyclic telemetry should remain inspectable rather than blanking the tree.
  for (const node of ordered) {
    if (!visited.has(node.id)) forest.push(buildBranch(node, new Set()));
  }

  return forest;
}
