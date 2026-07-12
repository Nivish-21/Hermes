import { useEffect, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";
import { isDashboardLoading } from "./dashboard-state";
import { buildTraceForest, type TraceBranchView, type TraceNodeView } from "./trace-tree";
import LandingPage from "./LandingPage";

type SortKey = "startedAt" | "status" | "cost";
type SortDirection = "ascending" | "descending";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
});

const timestamp = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function statusLabel(node: TraceNodeView): string {
  if (node.kind === "escalation") return "escalated";
  if (node.verifyPass === true) return "verified";
  if (node.verifyPass === false) return "failed";
  return "recorded";
}

function TraceBranch({
  branch,
  depth,
  expandedNodeIds,
  onToggle,
}: {
  branch: TraceBranchView;
  depth: number;
  expandedNodeIds: Set<string>;
  onToggle: (nodeId: string) => void;
}) {
  const { node, children } = branch;
  const isExpanded = expandedNodeIds.has(node.id);
  const hasDetails = children.length > 0 || isExpanded;
  const tokens = node.promptTok + node.complTok;

  return (
    <li className="trace-branch">
      <div className="trace-row" style={{ "--depth": depth } as React.CSSProperties}>
        <button
          aria-expanded={hasDetails}
          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${node.kind} trace node`}
          className={`tree-toggle ${hasDetails ? "open" : ""}`}
          onClick={() => onToggle(node.id)}
          type="button"
        >
          <span aria-hidden="true">›</span>
        </button>
        <span className={`node-dot ${statusLabel(node)}`} aria-label={statusLabel(node)} />
        <span className="node-kind">{node.kind}</span>
        <span className="node-model">{node.model}</span>
        <span className="node-latency">{node.latencyMs} ms</span>
        <span className="node-cost">{money.format(node.costUsd)}</span>
      </div>
      {isExpanded && (
        <div className="node-detail" style={{ "--depth": depth } as React.CSSProperties}>
          <span>node {node.id.slice(0, 12)}</span>
          <span>{tokens} tokens</span>
          <span>{timestamp.format(node.ts)}</span>
        </div>
      )}
      {children.length > 0 && (
        <ul className="trace-children">
          {children.map((child) => (
            <TraceBranch
              branch={child}
              depth={depth + 1}
              expandedNodeIds={expandedNodeIds}
              key={child.node.id}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function TraceTree({ nodes, loading }: { nodes: TraceNodeView[]; loading: boolean }) {
  const forest = useMemo(() => buildTraceForest(nodes), [nodes]);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setExpandedNodeIds(new Set());
  }, [nodes]);

  const toggle = (nodeId: string) => {
    setExpandedNodeIds((previous) => {
      const next = new Set(previous);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  if (loading) return <p className="empty-state">Loading trace data</p>;
  if (forest.length === 0) return <p className="empty-state">No trace nodes recorded for this run.</p>;

  return (
    <div className="trace-tree-wrap">
      <div className="trace-columns" aria-hidden="true"><span>step</span><span>model</span><span>latency</span><span>cost</span></div>
      <ul className="trace-tree">
        {forest.map((branch) => (
          <TraceBranch
            branch={branch}
            depth={0}
            expandedNodeIds={expandedNodeIds}
            key={branch.node.id}
            onToggle={toggle}
          />
        ))}
      </ul>
    </div>
  );
}

export function DashboardPage() {
  const runsResult = useQuery(api.dashboard.listRuns);
  const runs = runsResult ?? [];
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("startedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("descending");

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
  const savings = frontierCost - actualCost;
  const dashboardLoading = isDashboardLoading(runsResult, selectedRun, runData);
  const sortedRuns = useMemo(() => [...runs].sort((a, b) => {
    const left = sortKey === "cost" ? a.totalCostUsd : sortKey === "status" ? a.status : a.startedAt;
    const right = sortKey === "cost" ? b.totalCostUsd : sortKey === "status" ? b.status : b.startedAt;
    const result = typeof left === "string" && typeof right === "string" ? left.localeCompare(right) : Number(left) - Number(right);
    return sortDirection === "ascending" ? result : -result;
  }), [runs, sortDirection, sortKey]);

  const selectSort = (nextKey: SortKey) => {
    if (sortKey === nextKey) setSortDirection((direction) => direction === "ascending" ? "descending" : "ascending");
    else {
      setSortKey(nextKey);
      setSortDirection(nextKey === "startedAt" ? "descending" : "ascending");
    }
  };

  const sortMarker = (key: SortKey) => sortKey === key ? (sortDirection === "ascending" ? "↑" : "↓") : "";
  const deltaLabel = savings >= 0 ? "saved vs frontier" : "above frontier";

  return (
    <main className="dashboard-shell">
      <header className="workspace-header">
        <div>
          <p className="section-label">switchboard / execution monitor</p>
          <h1>Live runs</h1>
        </div>
        <div className="connection-state"><span className="status-dot running" /> live Convex projection</div>
      </header>

      <section className="intake-region" aria-labelledby="intake-heading">
        <div className="intake-copy"><h2 id="intake-heading">New request</h2><p>Runs begin from the allowlisted Telegram intake.</p></div>
        <form className="intake-form" onSubmit={(event) => event.preventDefault()}>
          <label className="sr-only" htmlFor="request-text">Request text</label>
          <input id="request-text" placeholder="Send text or a voice note in Telegram to start a run" readOnly />
          <button aria-label="Voice intake is available through Telegram" className="voice-control" disabled type="button">voice</button>
          <button className="intake-submit" disabled type="submit">Telegram only</button>
        </form>
      </section>

      <section className="cost-meter" aria-label="Selected run cost comparison">
        <div className="cost-context"><span className="section-label">selected run</span><strong>{selectedRunId ? selectedRunId.slice(0, 12) : "no run selected"}</strong></div>
        <div className="cost-value"><span>routed</span><strong>{dashboardLoading ? "…" : money.format(actualCost)}</strong></div>
        <div className="cost-value"><span>frontier-only</span><strong>{dashboardLoading ? "…" : money.format(frontierCost)}</strong></div>
        <div className={`cost-delta ${savings < 0 ? "negative" : ""}`}><span>{deltaLabel}</span><strong>{dashboardLoading ? "…" : money.format(Math.abs(savings))}</strong></div>
      </section>

      <div className="workspace-grid">
        <section className="run-history" aria-labelledby="run-history-heading">
          <div className="region-heading"><div><p className="section-label">run history</p><h2 id="run-history-heading">Recent runs</h2></div><span className="data-count">{runs.length}</span></div>
          <div className="run-table" role="table" aria-label="Recent runs">
            <div className="run-table-head" role="row">
              <button onClick={() => selectSort("startedAt")} type="button">run / started {sortMarker("startedAt")}</button>
              <button onClick={() => selectSort("status")} type="button">status {sortMarker("status")}</button>
              <button onClick={() => selectSort("cost")} type="button">cost {sortMarker("cost")}</button>
            </div>
            {runsResult === undefined ? <p className="empty-state">Loading run history</p> : sortedRuns.length === 0 ? <p className="empty-state">No runs yet. Send an allowlisted Telegram request to begin.</p> : sortedRuns.map((run) => (
              <button
                aria-pressed={run.runId === selectedRunId}
                className={`run-table-row ${run.runId === selectedRunId ? "selected" : ""}`}
                key={run.runId}
                onClick={() => setSelectedRunId(run.runId)}
                type="button"
              >
                <span><b>{run.runId.slice(0, 12)}</b><small>{timestamp.format(run.startedAt)}</small></span>
                <span className="run-status"><i className={`status-dot ${run.status}`} />{run.status}</span>
                <span>{money.format(run.totalCostUsd)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="trace-region" aria-labelledby="trace-heading">
          <div className="region-heading"><div><p className="section-label">execution trace</p><h2 id="trace-heading">Decision tree</h2></div><span className="trace-count">{dashboardLoading ? "…" : nodes.length} steps</span></div>
          <p className="trace-note">Expand a step to inspect its recorded cost, token count, and timestamp.</p>
          <TraceTree loading={dashboardLoading} nodes={nodes} />
        </section>
      </div>
    </main>
  );
}

function App() {
  const dashboardRequested = window.location.pathname.replace(/\/$/, "") === "/dashboard"
    || new URLSearchParams(window.location.search).get("view") === "dashboard";
  return dashboardRequested ? <DashboardPage /> : <LandingPage />;
}

export default App;
