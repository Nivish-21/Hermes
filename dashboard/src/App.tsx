import { useEffect, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";
import { filterRunsByStatus, isDashboardLoading, type RunStatusFilter } from "./dashboard-state";
import { buildTraceForest, type TraceBranchView, type TraceNodeView } from "./trace-tree";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
});

function TraceBranch({ branch }: { branch: TraceBranchView }) {
  const { node, children } = branch;
  const [expanded, setExpanded] = useState(true);
  const content = (
    <>
      <div className="trace-card-heading">
        <strong>{node.kind}</strong>
        <span className="trace-card-meta">
          {node.verifyPass !== undefined && (
            <span className={node.verifyPass ? "pass" : "fail"}>
              {node.verifyPass ? "verified" : "failed"}
            </span>
          )}
          {children.length > 0 && <span className="chevron" aria-hidden="true">{expanded ? "−" : "+"}</span>}
        </span>
      </div>
      <span className="muted">{node.model}</span>
      <span className="trace-stats">
        {node.latencyMs}ms · {money.format(node.costUsd)} · {node.promptTok + node.complTok} tokens
      </span>
    </>
  );
  return (
    <li className={`trace-node ${node.kind}`}>
      {children.length > 0 ? (
        <button
          aria-expanded={expanded}
          className="trace-card trace-toggle"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          {content}
        </button>
      ) : <div className="trace-card">{content}</div>}
      {expanded && children.length > 0 && (
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
  const requestedRunId = new URLSearchParams(window.location.search).get("run");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(requestedRunId);
  const [followLatest, setFollowLatest] = useState(requestedRunId === null);
  const [statusFilter, setStatusFilter] = useState<RunStatusFilter>("all");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    const selectionStillExists = runs.some((run) => run.runId === selectedRunId);
    if (followLatest || !selectionStillExists) setSelectedRunId(runs[0]?.runId ?? null);
  }, [followLatest, runs, selectedRunId]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedRunId === null) url.searchParams.delete("run");
    else url.searchParams.set("run", selectedRunId);
    window.history.replaceState(null, "", url);
  }, [selectedRunId]);

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
  const filteredRuns = filterRunsByStatus(runs, statusFilter);

  const selectRun = (runId: string) => {
    setFollowLatest(false);
    setSelectedRunId(runId);
  };

  const copyRunLink = () => {
    const input = document.createElement("textarea");
    input.value = window.location.href;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    input.remove();
    setCopyState(copied ? "copied" : "failed");
    window.setTimeout(() => setCopyState("idle"), 3_000);
  };

  return (
    <main>
      <header className="hero">
        <div>
          <span className="eyebrow">SWITCHBOARD / LIVE PROOF</span>
          <h1>Execution, not explanation.</h1>
          <p>Every request becomes a run. Every run leaves a verifiable trail.</p>
        </div>
        <div className="hero-actions">
          <button
            aria-pressed={followLatest}
            className={followLatest ? "control-button active" : "control-button"}
            onClick={() => setFollowLatest((value) => !value)}
            type="button"
          >
            {followLatest ? "Following latest" : "Follow latest"}
          </button>
          <div className="live-pill"><i /> Convex live</div>
        </div>
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
          <div className="filter-row" aria-label="Filter runs by status">
            {(["all", "success", "failed", "running"] as const).map((filter) => (
              <button
                aria-pressed={statusFilter === filter}
                className={statusFilter === filter ? "filter-button active" : "filter-button"}
                key={filter}
                onClick={() => setStatusFilter(filter)}
                type="button"
              >
                {filter}
              </button>
            ))}
          </div>
          {runsResult === undefined ? (
            <p className="muted">Loading live run history…</p>
          ) : runs.length === 0 ? (
            <p className="muted">Waiting for the first request.</p>
          ) : (
            <div className="run-list">
              {filteredRuns.length === 0 && <p className="muted filter-empty">No {statusFilter} runs.</p>}
              {filteredRuns.map((run) => {
                const index = runs.findIndex((candidate) => candidate.runId === run.runId);
                return (
                <button
                  aria-pressed={run.runId === selectedRunId}
                  className={run.runId === selectedRunId ? "run-row selected" : "run-row"}
                  key={run.runId}
                  onClick={() => selectRun(run.runId)}
                >
                  <span className={`status-dot ${run.status}`} />
                  <span>
                    <strong>{index === 0 ? "Latest run" : `Prior run ${index}`}</strong>
                    <small>{new Date(run.startedAt).toLocaleString()} · {run.status}</small>
                    <small className="outcome-counts">{run.successCount} successful · {run.escalationCount} escalated</small>
                  </span>
                  <span className="run-cost">{money.format(run.totalCostUsd)}</span>
                </button>
                );
              })}
            </div>
          )}
        </article>

        <article className="panel trace-panel">
          <div className="section-heading">
            <div><span className="eyebrow">LIVE TRACE TREE</span><h2>Decision trail</h2></div>
            <div className="trace-actions">
              <button
                className="control-button"
                disabled={selectedRunId === null}
                onClick={copyRunLink}
                type="button"
              >
                {copyState === "copied" ? "Link copied" : copyState === "failed" ? "Copy failed" : "Copy run link"}
              </button>
              <span className="badge">{dashboardLoading ? "…" : nodes.length} nodes</span>
            </div>
          </div>
          <TraceTree nodes={nodes} loading={dashboardLoading} />
        </article>
      </section>
    </main>
  );
}

export default App;
