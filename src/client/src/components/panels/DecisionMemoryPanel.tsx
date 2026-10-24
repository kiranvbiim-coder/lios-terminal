import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState, useEffect } from "react";
import { Plus, Circle, CheckCircle2, Calendar, User, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";

/**
 * Decision Memory (Major Bet, Roadmap Rev.3 §10) -- "start early, compounds
 * in value the longer it's been running... nobody switches once years of
 * predicted vs. actual exists for their own organization." A client logs a
 * real decision with its assumptions and forecast; later, someone comes
 * back and records what actually happened. Zero AI anywhere in this panel
 * or its routes (server/clientRoutes.ts) -- pure record-keeping. The value
 * here is accumulation over time, not any cleverness on day one.
 *
 * metric/forecastValue/actualValue are optional structured fields, additive
 * to the free-text forecast/actualOutcome above. Logging both a metric and
 * a forecast value, then resolving with an actual value, makes the decision
 * eligible for the Accuracy Scorecard below (server's
 * computeForecastAccountability, a deterministic pure function over exactly
 * these logged numbers -- nothing here is AI-estimated or invented).
 */

interface DecisionRecord {
  id: number;
  question: string;
  assumptions: string;
  forecast: string;
  metric: string | null;
  forecastValue: number | null;
  targetDate: string;
  status: "open" | "resolved";
  actualOutcome: string | null;
  actualValue: number | null;
  resolvedAt: string | null;
  createdAt: string;
  createdByName: string;
}

interface AccuracyScorecard {
  forecasts: Array<{ id: string; metric: string; forecastValue: number; actualValue: number; absoluteError: number; percentageError: number; direction: "over" | "under" | "exact"; daysBetween: number }>;
  meanAbsoluteError: number;
  meanPercentageError: number;
  overPredictionBias: number;
  totalForecasts: number;
  resolvedForecasts: number;
  accuracyScore: number;
  mostAccurateMetric: string | null;
  leastAccurateMetric: string | null;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function DecisionMemoryPanel() {
  const [records, setRecords] = useState<DecisionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLogModal, setShowLogModal] = useState(false);
  const [resolveTargetId, setResolveTargetId] = useTerminalArtifactState<number | null>("DecisionMemoryPanel.resolveTargetId", null);
  const resolveTarget = records.find(record => record.id === resolveTargetId && record.status === "open") ?? null;
  const setResolveTarget = (record: DecisionRecord | null) => setResolveTargetId(record?.id ?? null);
  const [submitting, setSubmitting] = useState(false);

  const [question, setQuestion] = useTerminalArtifactState("DecisionMemoryPanel.question", "");
  const [assumptions, setAssumptions] = useTerminalArtifactState("DecisionMemoryPanel.assumptions", "");
  const [forecast, setForecast] = useTerminalArtifactState("DecisionMemoryPanel.forecast", "");
  const [targetDate, setTargetDate] = useTerminalArtifactState("DecisionMemoryPanel.targetDate", "");
  const [metric, setMetric] = useTerminalArtifactState("DecisionMemoryPanel.metric", "");
  const [forecastValue, setForecastValue] = useTerminalArtifactState("DecisionMemoryPanel.forecastValue", "");
  const [actualOutcome, setActualOutcome] = useTerminalArtifactState("DecisionMemoryPanel.actualOutcome", "");
  const [actualValue, setActualValue] = useTerminalArtifactState("DecisionMemoryPanel.actualValue", "");
  const [scorecard, setScorecard] = useState<AccuracyScorecard | null>(null);

  const load = () => {
    fetch("/api/client/decisions")
      .then((r) => (r.ok ? r.json() : []))
      .then(setRecords)
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
    fetch("/api/client/decisions/accuracy")
      .then((r) => (r.ok ? r.json() : null))
      .then(setScorecard)
      .catch(() => setScorecard(null));
  };

  useEffect(() => { load(); }, []);

  const handleLog = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/client/decisions", {
        question, assumptions, forecast, targetDate,
        metric: metric.trim() || undefined,
        forecastValue: forecastValue.trim() ? Number(forecastValue) : undefined,
      });
      setShowLogModal(false);
      setQuestion(""); setAssumptions(""); setForecast(""); setTargetDate(""); setMetric(""); setForecastValue("");
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolveTarget) return;
    setSubmitting(true);
    try {
      await apiRequest("PATCH", `/api/client/decisions/${resolveTarget.id}/resolve`, {
        actualOutcome,
        actualValue: actualValue.trim() ? Number(actualValue) : undefined,
      });
      setResolveTarget(null);
      setActualOutcome(""); setActualValue("");
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const open = records.filter((r) => r.status === "open");
  const resolved = records.filter((r) => r.status === "resolved");

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="panel-label">DECISION MEMORY</div>
          <div className="font-terminal text-[9px] text-muted-foreground mt-1">Log a decision and its forecast now — come back later and record what actually happened. No AI, no interpretation — just your own history.</div>
        </div>
        <Button size="sm" onClick={() => setShowLogModal(true)} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Log Decision
        </Button>
      </div>

      {scorecard && scorecard.resolvedForecasts > 0 && (
        <div className="bg-[#080808] border border-border p-4">
          <div className="flex items-center gap-2 mb-3"><Target className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" /><div className="panel-label">ACCURACY SCORECARD — {scorecard.resolvedForecasts} RESOLVED FORECAST{scorecard.resolvedForecasts === 1 ? "" : "S"} WITH LOGGED NUMBERS</div></div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div><div className="font-terminal text-[8px] text-muted-foreground uppercase tracking-wider">Accuracy score</div><div className="text-lg font-semibold text-foreground mt-1">{scorecard.accuracyScore.toFixed(0)}</div></div>
            <div><div className="font-terminal text-[8px] text-muted-foreground uppercase tracking-wider">Mean absolute error</div><div className="text-lg font-semibold text-foreground mt-1">{scorecard.meanAbsoluteError.toFixed(2)}</div></div>
            <div><div className="font-terminal text-[8px] text-muted-foreground uppercase tracking-wider">Mean percentage error</div><div className="text-lg font-semibold text-foreground mt-1">{(scorecard.meanPercentageError * 100).toFixed(1)}%</div></div>
            <div><div className="font-terminal text-[8px] text-muted-foreground uppercase tracking-wider">Over-prediction bias</div><div className="text-lg font-semibold text-foreground mt-1">{(scorecard.overPredictionBias * 100).toFixed(0)}%</div></div>
          </div>
          <div className="mt-3 font-terminal text-[9px] text-muted-foreground">
            {scorecard.mostAccurateMetric && <span>Most accurate metric tracked: <span className="text-foreground">{scorecard.mostAccurateMetric}</span>. </span>}
            {scorecard.leastAccurateMetric && scorecard.leastAccurateMetric !== scorecard.mostAccurateMetric && <span>Least accurate: <span className="text-foreground">{scorecard.leastAccurateMetric}</span>.</span>}
          </div>
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center font-terminal text-sm text-muted-foreground animate-pulse">Loading decision log...</div>
      ) : records.length === 0 ? (
        <div className="p-8 text-center font-terminal text-sm text-muted-foreground border border-dashed border-border">
          Nothing logged yet. Log your first decision — what you're deciding, what you're assuming, and what you expect to happen.
        </div>
      ) : (
        <>
          <div className="bg-[#080808] border border-border p-4">
            <div className="panel-label mb-3">OPEN — AWAITING OUTCOME ({open.length})</div>
            {open.length === 0 ? (
              <p className="font-terminal text-[9px] text-muted-foreground">No open decisions.</p>
            ) : (
              <div className="space-y-3">
                {open.map((r) => (
                  <div key={r.id} className="p-3 border border-border/60 bg-black/20">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2 min-w-0">
                        <Circle className="w-3.5 h-3.5 text-[hsl(38,95%,55%)] shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <div className="text-sm text-foreground font-semibold">{r.question}</div>
                          <div className="font-terminal text-[9px] text-muted-foreground mt-1"><span className="text-foreground">Assumptions:</span> {r.assumptions}</div>
                          <div className="font-terminal text-[9px] text-muted-foreground mt-0.5"><span className="text-foreground">Forecast:</span> {r.forecast}</div>
                          <div className="flex items-center gap-3 mt-2 font-terminal text-[8px] text-muted-foreground uppercase tracking-wider">
                            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Target {fmtDate(r.targetDate)}</span>
                            <span className="flex items-center gap-1"><User className="w-3 h-3" /> {r.createdByName}</span>
                          </div>
                        </div>
                      </div>
                      <Button size="sm" variant="outline" className="shrink-0" onClick={() => setResolveTarget(r)}>Record Outcome</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {resolved.length > 0 && (
            <div className="bg-[#080808] border border-border p-4">
              <div className="panel-label mb-3">RESOLVED — FORECAST VS. REALITY ({resolved.length})</div>
              <div className="space-y-3">
                {resolved.map((r) => (
                  <div key={r.id} className="p-3 border border-border/60 bg-black/20">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-up shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-foreground font-semibold">{r.question}</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-2">
                          <div className="font-terminal text-[9px] text-muted-foreground"><span className="text-foreground">Forecast:</span> {r.forecast}</div>
                          <div className="font-terminal text-[9px] text-muted-foreground"><span className="text-foreground">Actual:</span> {r.actualOutcome}</div>
                        </div>
                        {r.metric && r.forecastValue != null && r.actualValue != null && (
                          <div className="font-terminal text-[9px] text-muted-foreground mt-1"><span className="text-foreground">{r.metric}:</span> forecast {r.forecastValue} vs. actual {r.actualValue}</div>
                        )}
                        <div className="flex items-center gap-3 mt-2 font-terminal text-[8px] text-muted-foreground uppercase tracking-wider">
                          <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Targeted {fmtDate(r.targetDate)}</span>
                          {r.resolvedAt && <span>Resolved {fmtDate(r.resolvedAt)}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {showLogModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => setShowLogModal(false)}>
          <div className="w-full max-w-lg p-6 bg-[#0d0d0d] border border-border shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-foreground">Log a Decision</h3>
            <form onSubmit={handleLog} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">What are you deciding?</label>
                <Input type="text" required value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Enter the Brazilian market in Q1 2027" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">What are you assuming?</label>
                <textarea required rows={2} value={assumptions} onChange={(e) => setAssumptions(e.target.value)}
                  placeholder="e.g. BRL stays within 5% of current rate, tariffs unchanged"
                  className="w-full px-3 py-2 border border-input bg-background focus:outline-none focus:ring-1 focus:ring-[hsl(38,95%,50%)] text-foreground" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">What do you expect to happen?</label>
                <textarea required rows={2} value={forecast} onChange={(e) => setForecast(e.target.value)}
                  placeholder="e.g. Break-even within 18 months, 12% margin by year 2"
                  className="w-full px-3 py-2 border border-input bg-background focus:outline-none focus:ring-1 focus:ring-[hsl(38,95%,50%)] text-foreground" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">Metric (optional)</label>
                  <Input type="text" value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="e.g. Break-even month" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">Forecast value (optional)</label>
                  <Input type="number" step="any" value={forecastValue} onChange={(e) => setForecastValue(e.target.value)} placeholder="e.g. 18" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground -mt-2">Logging both a metric and a number here (then a matching actual value when you resolve it) feeds the Accuracy Scorecard above — purely arithmetic, no AI involved.</p>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">When will you know?</label>
                <Input type="date" required value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground">This is stored exactly as written — nothing here is scored or interpreted by AI. Come back on or after the target date to record what actually happened.</p>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowLogModal(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Log Decision"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {resolveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => setResolveTarget(null)}>
          <div className="w-full max-w-lg p-6 bg-[#0d0d0d] border border-border shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-foreground">Record What Actually Happened</h3>
            <div className="p-3 bg-muted/30 border border-border/40 font-terminal text-[9px] text-muted-foreground space-y-1">
              <div><span className="text-foreground">Question:</span> {resolveTarget.question}</div>
              <div><span className="text-foreground">Forecast was:</span> {resolveTarget.forecast}</div>
            </div>
            <form onSubmit={handleResolve} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">What actually happened?</label>
                <textarea required rows={3} value={actualOutcome} onChange={(e) => setActualOutcome(e.target.value)}
                  placeholder="Be honest, even if the forecast was wrong — that's the whole point of tracking this."
                  className="w-full px-3 py-2 border border-input bg-background focus:outline-none focus:ring-1 focus:ring-[hsl(38,95%,50%)] text-foreground" />
              </div>
              {resolveTarget.metric && resolveTarget.forecastValue != null && (
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">Actual value for "{resolveTarget.metric}" (forecast was {resolveTarget.forecastValue})</label>
                  <Input type="number" step="any" value={actualValue} onChange={(e) => setActualValue(e.target.value)} placeholder={`e.g. ${resolveTarget.forecastValue}`} />
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setResolveTarget(null)}>Cancel</Button>
                <Button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Record Outcome"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
