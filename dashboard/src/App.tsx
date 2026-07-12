import { useEffect, useMemo, useState, type ReactElement } from "react";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";

type TraceNodeView = {
  id: string;
  runId: string;
  requestId: string;
  taskId?: string;
  kind: "manager" | "specialist" | "verify" | "escalation";
  model: string;
  promptTok: number;
  complTok: number;
  costUsd: number;
  latencyMs: number;
  verifyPass?: boolean;
  parentId?: string;
  ts: number;
};

type RunView = {
  runId: string;
  startedAt: number;
  endedAt?: number;
  successCount: number;
  escalationCount: number;
  totalCostUsd: number;
  status: "running" | "success" | "failed";
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 4 });

function TraceBranch({ node, children, childrenByParent }: { node: TraceNodeView; children: TraceNodeView[]; childrenByParent: Map<string, TraceNodeView[]> }) {
  return (
    <li className={`trace-node ${node.kind}`}>
      <div className="trace-card">
        <div className="trace-card-heading">
          <strong>{node.kind}</strong>
          {node.verifyPass !== undefined && <span className={node.verifyPass ? "pass" : "fail"}>{node.verifyPass ? "verified" : "failed"}</span>}
        </div>
        <span className="muted">{node.model}</span>
        <span className="trace-stats">{node.latencyMs}ms · {money.format(node.costUsd)} · {node.promptTok + node.complTok} tokens</span>
      </div>
      {children.length > 0 && <ul>{children.map((child) => <TraceBranch key={child.id} node={child} children={childrenByParent.get(child.id) ?? []} childrenByParent={childrenByParent} />)}</ul>}
    </li>
  );
}

function TraceTree({ nodes }: { nodes: TraceNodeView[] }) {
  const ordered = [...nodes].sort((a, b) => a.ts - b.ts);
  const roots = ordered.filter((node) => node.parentId === undefined);
  const childrenByParent = useMemo(() => {
    const groups = new Map<string, TraceNodeView[]>();
    for (const node of ordered) {
      if (node.parentId === undefined) continue;
      const children = groups.get(node.parentId) ?? [];
      children.push(node);
      groups.set(node.parentId, children);
    }
    return groups;
  }, [nodes]);

  const render = (node: TraceNodeView): ReactElement => (
    <TraceBranch key={node.id} node={node} children={childrenByParent.get(node.id) ?? []} childrenByParent={childrenByParent} />
  );

  return roots.length === 0 ? <p className="muted">No trace nodes yet.</p> : <ul className="trace-tree">{roots.map(render)}</ul>;
}

function App() {
  const runs = (useQuery(api.dashboard.listRuns) ?? []) as RunView[];
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  useEffect(() => {
    if (selectedRunId === null && runs[0] !== undefined) setSelectedRunId(runs[0].runId);
  }, [runs, selectedRunId]);
  const selectedRun = runs.find((run) => run.runId === selectedRunId);
  const runData = useQuery(api.dashboard.getRunData, selectedRunId === null ? "skip" : { runId: selectedRunId });
  const nodes = (runData?.nodes ?? []) as TraceNodeView[];

  return (
    <main>
      <header className="hero">
        <div><span className="eyebrow">SWITCHBOARD / LIVE PROOF</span><h1>Execution, not explanation.</h1><p>Every request becomes a run. Every run leaves a verifiable trail.</p></div>
        <div className="live-pill"><i /> Convex live</div>
      </header>
      <section className="metric-grid">
        <article className="panel cost-panel"><span className="eyebrow">COST METER</span><h2>{money.format(runData?.actualCostUsd ?? selectedRun?.totalCostUsd ?? 0)}</h2><p>Actual routed cost</p><div className="comparison"><span>Frontier-only estimate</span><strong>{money.format(runData?.frontierOnlyEstimateUsd ?? 0)}</strong></div></article>
        <article className="panel"><span className="eyebrow">RUN STATUS</span><h2>{selectedRun?.status ?? "—"}</h2><p>{selectedRun === undefined ? "Select a run" : `${selectedRun.successCount} verified · ${selectedRun.escalationCount} escalated`}</p><div className="bar"><span style={{ width: selectedRun?.status === "success" ? "100%" : "35%" }} /></div></article>
        <article className="panel"><span className="eyebrow">TRACE NODES</span><h2>{nodes.length}</h2><p>Manager → specialist → verify</p></article>
      </section>
      <section className="content-grid">
        <article className="panel history"><div className="section-heading"><div><span className="eyebrow">RUN HISTORY</span><h2>Recent requests</h2></div><span className="count">{runs.length}</span></div>{runs.length === 0 ? <p className="muted">Waiting for the first request.</p> : <div className="run-list">{runs.map((run) => <button className={run.runId === selectedRunId ? "run-row selected" : "run-row"} key={run.runId} onClick={() => setSelectedRunId(run.runId)}><span className={`status-dot ${run.status}`} /><span><strong>{run.runId.slice(0, 8)}</strong><small>{new Date(run.startedAt).toLocaleString()}</small></span><span className="run-cost">{money.format(run.totalCostUsd)}</span></button>)}</div>}</article>
        <article className="panel trace-panel"><div className="section-heading"><div><span className="eyebrow">TRACE TREE / {selectedRunId?.slice(0, 8) ?? "—"}</span><h2>Decision trail</h2></div><span className="badge">{nodes.length} nodes</span></div><TraceTree nodes={nodes} /></article>
      </section>
    </main>
  );
}

export default App;
