import { useEffect, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";
import { isDashboardLoading } from "./dashboard-state";
import { buildTraceForest, type TraceBranchView, type TraceNodeView } from "./trace-tree";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
});

function TraceBranch({ branch }: { branch: TraceBranchView }) {
  const { node, children } = branch;
  return (
    <li className={`trace-node ${node.kind}`}>
      <div className="trace-card">
        <div className="trace-card-heading">
          <strong>{node.kind}</strong>
          {node.verifyPass !== undefined && (
            <span className={node.verifyPass ? "pass" : "fail"}>
              {node.verifyPass ? "verified" : "failed"}
            </span>
          )}
        </div>
        <span className="muted">{node.model}</span>
        <span className="trace-stats">
          {node.latencyMs}ms · {money.format(node.costUsd)} · {node.promptTok + node.complTok} tokens
        </span>
      </div>
      {children.length > 0 && (
        <ul>{children.map((child) => <TraceBranch key={child.node.id} branch={child} />)}</ul>
      )}
    </li>
  );
}

function TraceTree({ nodes, loading }: { nodes: TraceNodeView[]; loading: boolean }) {
  const forest = useMemo(() => buildTraceForest(nodes), [nodes]);
  if (loading) return <p className="muted">Loading live trace…</p>;
  if (forest.length === 0) return <p className="muted">No trace nodes yet.</p>;
  return <ul className="trace-tree">{forest.map((branch) => <TraceBranch key={branch.node.id} branch={branch} />)}</ul>;
}

function App() {
  const runsResult = useQuery(api.dashboard.listRuns);
  const runs = runsResult ?? [];
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  useEffect(() => {
    const selectionStillExists = runs.some((run) => run.runId === selectedRunId);
    if (!selectionStillExists) setSelectedRunId(runs[0]?.runId ?? null);
  }, [runs, selectedRunId]);

  const selectedRun = runs.find((run) => run.runId === selectedRunId);
  const runData = useQuery(
    api.dashboard.getRunData,
    selectedRunId === null ? "skip" : { runId: selectedRunId },
  );
  const nodes = runData?.nodes ?? [];
  const actualCost = runData?.actualCostUsd ?? selectedRun?.totalCostUsd ?? 0;
  const frontierCost = runData?.frontierOnlyEstimateUsd ?? 0;
  const savings = Math.max(0, frontierCost - actualCost);
  const dashboardLoading = isDashboardLoading(runsResult, selectedRun, runData);

  return (
    <main>
      <header className="hero">
        <div>
          <span className="eyebrow">SWITCHBOARD / LIVE PROOF</span>
          <h1>Execution, not explanation.</h1>
          <p>Every request becomes a run. Every run leaves a verifiable trail.</p>
        </div>
        <div className="live-pill"><i /> Convex live</div>
      </header>

      <section className="metric-grid" aria-label="Selected run summary">
        <article className="panel cost-panel">
          <span className="eyebrow">ACTUAL ROUTED COST</span>
          <h2>{dashboardLoading ? "…" : money.format(actualCost)}</h2>
          <p>Recorded model spend for this run</p>
          <div className="comparison">
            <span>Frontier-only estimate</span>
            <strong>{dashboardLoading ? "…" : money.format(frontierCost)}</strong>
          </div>
          <div className="comparison savings">
            <span>Estimated savings</span>
            <strong>{dashboardLoading ? "…" : money.format(savings)}</strong>
          </div>
        </article>
        <article className="panel">
          <span className="eyebrow">RUN STATUS</span>
          <h2>{selectedRun?.status ?? "—"}</h2>
          <p>{selectedRun === undefined ? "Select a completed run" : `${selectedRun.successCount} successful · ${selectedRun.escalationCount} escalated`}</p>
          <div className="bar"><span style={{ width: selectedRun?.status === "success" ? "100%" : "35%" }} /></div>
        </article>
        <article className="panel">
          <span className="eyebrow">TRACE NODES</span>
          <h2>{dashboardLoading ? "…" : nodes.length}</h2>
          <p>Manager → specialist → verify</p>
        </article>
      </section>

      <section className="content-grid">
        <article className="panel history">
          <div className="section-heading">
            <div><span className="eyebrow">RUN HISTORY</span><h2>Recent runs</h2></div>
            <span className="count">{runs.length}</span>
          </div>
          {runsResult === undefined ? (
            <p className="muted">Loading live run history…</p>
          ) : runs.length === 0 ? (
            <p className="muted">Waiting for the first request.</p>
          ) : (
            <div className="run-list">
              {runs.map((run, index) => (
                <button
                  aria-pressed={run.runId === selectedRunId}
                  className={run.runId === selectedRunId ? "run-row selected" : "run-row"}
                  key={run.runId}
                  onClick={() => setSelectedRunId(run.runId)}
                >
                  <span className={`status-dot ${run.status}`} />
                  <span>
                    <strong>{index === 0 ? "Latest run" : `Prior run ${index}`}</strong>
                    <small>{new Date(run.startedAt).toLocaleString()} · {run.status}</small>
                    <small className="outcome-counts">{run.successCount} successful · {run.escalationCount} escalated</small>
                  </span>
                  <span className="run-cost">{money.format(run.totalCostUsd)}</span>
                </button>
              ))}
            </div>
          )}
        </article>

        <article className="panel trace-panel">
          <div className="section-heading">
            <div><span className="eyebrow">LIVE TRACE TREE</span><h2>Decision trail</h2></div>
            <span className="badge">{dashboardLoading ? "…" : nodes.length} nodes</span>
          </div>
          <TraceTree nodes={nodes} loading={dashboardLoading} />
        </article>
      </section>
    </main>
  );
}

export default App;
