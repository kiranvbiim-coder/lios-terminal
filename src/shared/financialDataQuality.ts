import { resolveFinancialMetric, type FinancialMetricObservation } from "./financialMetricRegistry";

export type FinancialQualitySeverity = "info" | "warning" | "critical";

export interface FinancialQualityIssue {
  id: string;
  severity: FinancialQualitySeverity;
  title: string;
  detail: string;
  metricIds: string[];
  delta?: number;
  tolerance?: number;
}

export interface FinancialQualityReport {
  score: number;
  issues: FinancialQualityIssue[];
  checksRun: number;
  checksPassed: number;
  manualCount: number;
  conflictCount: number;
  staleCount: number;
}

function value(metricId: string, observations: readonly FinancialMetricObservation[]): number | null {
  return resolveFinancialMetric(metricId, observations)?.value ?? null;
}

function finite(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v); }
function relativeDelta(a: number, b: number): number { return Math.abs(a - b) / Math.max(1, Math.abs(a), Math.abs(b)); }

export function auditFinancialDataQuality(observations: readonly FinancialMetricObservation[]): FinancialQualityReport {
  const issues: FinancialQualityIssue[] = [];
  let checksRun = 0;
  let checksPassed = 0;

  const identity = (id: string, title: string, left: number | null, right: number | null, metricIds: string[], tolerance = 0.005) => {
    if (!finite(left) || !finite(right)) return;
    checksRun += 1;
    const delta = relativeDelta(left, right);
    if (delta <= tolerance) checksPassed += 1;
    else issues.push({ id, severity: delta > tolerance * 5 ? "critical" : "warning", title, detail: `Identity differs by ${(delta * 100).toFixed(2)}%. Verify provider mapping, period alignment, normalization, or manual overrides.`, metricIds, delta, tolerance });
  };

  const assets = value("totalAssets", observations);
  const liabilities = value("totalLiabilities", observations);
  const equity = value("totalEquity", observations);
  identity("balance-sheet", "Balance sheet does not balance", assets, finite(liabilities) && finite(equity) ? liabilities + equity : null, ["totalAssets", "totalLiabilities", "totalEquity"]);

  const ebit = value("ebit", observations);
  const da = value("depreciationAndAmortization", observations);
  const ebitda = value("ebitda", observations);
  identity("ebitda-bridge", "EBITDA bridge mismatch", ebitda, finite(ebit) && finite(da) ? ebit + da : null, ["ebitda", "ebit", "depreciationAndAmortization"], 0.03);

  const cfo = value("cfo", observations);
  const capex = value("capex", observations);
  const fcf = value("fcf", observations);
  identity("fcf-bridge", "FCF does not reconcile to CFO - Capex", fcf, finite(cfo) && finite(capex) ? cfo - Math.abs(capex) : null, ["fcf", "cfo", "capex"], 0.03);

  const marketCap = value("marketCap", observations);
  const enterpriseValue = value("enterpriseValue", observations);
  const derivedEv = value("enterpriseValueDerived", observations);
  identity("enterprise-value", "Reported and component-derived enterprise value differ", enterpriseValue, derivedEv, ["enterpriseValue", "marketCap", "grossDebt", "cash", "leaseLiabilities", "minorityInterest", "preferredStock"], 0.03);

  const currentAssets = value("currentAssets", observations);
  const currentLiabilities = value("currentLiabilities", observations);
  const workingCapital = value("workingCapital", observations);
  identity("working-capital", "Working capital mismatch", workingCapital, finite(currentAssets) && finite(currentLiabilities) ? currentAssets - currentLiabilities : null, ["workingCapital", "currentAssets", "currentLiabilities"], 0.02);

  const grossProfit = value("grossProfit", observations);
  const revenue = value("revenue", observations);
  const cost = value("costOfRevenue", observations);
  if (finite(revenue) && finite(cost)) identity("gross-profit", "Gross profit does not reconcile", grossProfit, revenue - Math.abs(cost), ["grossProfit", "revenue", "costOfRevenue"], 0.02);

  if (finite(marketCap) && marketCap < 0) issues.push({ id: "negative-market-cap", severity: "critical", title: "Negative market capitalization", detail: "Market capitalization cannot normally be negative; verify sign and units.", metricIds: ["marketCap"] });
  if (finite(enterpriseValue) && finite(marketCap) && enterpriseValue < marketCap * -0.5) issues.push({ id: "ev-sign", severity: "warning", title: "Enterprise value is unusually negative", detail: "Negative EV can be real for net-cash companies, but the magnitude warrants a component review.", metricIds: ["enterpriseValue", "marketCap", "cash", "grossDebt"] });

  const duplicateKeys = new Map<string, FinancialMetricObservation[]>();
  for (const observation of observations) {
    const key = `${observation.metricId}|${observation.period ?? "CURRENT"}|${observation.scenarioId ?? "BASE"}`;
    const list = duplicateKeys.get(key) ?? [];
    list.push(observation);
    duplicateKeys.set(key, list);
  }
  for (const [key, list] of duplicateKeys) {
    const finiteValues = list.filter(item => finite(item.value));
    if (finiteValues.length < 2) continue;
    const min = Math.min(...finiteValues.map(item => item.value as number));
    const max = Math.max(...finiteValues.map(item => item.value as number));
    const delta = relativeDelta(min, max);
    if (delta > 0.02 && new Set(finiteValues.map(item => item.source)).size > 1) issues.push({ id: `provider-conflict:${key}`, severity: delta > 0.1 ? "critical" : "warning", title: "Cross-source metric conflict", detail: `${finiteValues.length} sources disagree by ${(delta * 100).toFixed(2)}% for ${key.replaceAll("|", " / ")}.`, metricIds: [finiteValues[0].metricId], delta, tolerance: 0.02 });
  }

  const manualCount = observations.filter(item => item.status === "manual").length;
  const conflictCount = observations.filter(item => item.status === "conflict").length;
  const staleCount = observations.filter(item => item.status === "stale").length;
  if (manualCount) issues.push({ id: "manual-data", severity: "info", title: `${manualCount} manual financial observation(s) active`, detail: "Manual values are explicit analyst inputs and should be reviewed before external distribution.", metricIds: observations.filter(item => item.status === "manual").map(item => item.metricId) });
  if (conflictCount) issues.push({ id: "conflicted-data", severity: "critical", title: `${conflictCount} conflicted observation(s)`, detail: "Provider conflicts require resolution before high-trust downstream use.", metricIds: observations.filter(item => item.status === "conflict").map(item => item.metricId) });
  if (staleCount) issues.push({ id: "stale-data", severity: "warning", title: `${staleCount} stale observation(s)`, detail: "Refresh or explicitly accept stale data before making time-sensitive decisions.", metricIds: observations.filter(item => item.status === "stale").map(item => item.metricId) });

  const penalty = issues.reduce((sum, issue) => sum + (issue.severity === "critical" ? 15 : issue.severity === "warning" ? 6 : 1), 0);
  const base = checksRun ? (checksPassed / checksRun) * 100 : 100;
  return { score: Math.max(0, Math.min(100, Math.round(base - penalty))), issues, checksRun, checksPassed, manualCount, conflictCount, staleCount };
}
