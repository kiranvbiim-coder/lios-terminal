import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ArtifactContent } from "@shared/artifactContracts";
import ArtifactViewerFallback from "./ArtifactViewerFallback";
import BacktestArtifactView from "./BacktestArtifactView";
import PortfolioArtifactView from "./PortfolioArtifactView";
import ValuationArtifactView from "./ValuationArtifactView";
import { dcfSensitivityValuation } from "./dcfSensitivityArtifact.fixture";
import { ReadableRowsTable } from "./ReadableValueTable";

const save = async () => undefined;
const facts = { savedAt: "2026-10-20T10:30:00.000Z", sourceCount: 0, receiptCount: 1 };
// Raw JSON in normal view would show up as an opening brace/bracket-of-objects or an encoded quoted key.
const RAW_JSON = /\{&quot;|\[\{|\{"|&quot;[A-Za-z]+&quot;\s*:/;

function valuation(extra: { initialShowExact?: boolean; expertDefaultOpen?: boolean } = {}) {
  return renderToStaticMarkup(createElement(ValuationArtifactView, { content: dcfSensitivityValuation, facts, onSave: save, ...extra }));
}

test("DCF sensitivity valuation reads as labelled tables, not JSON", () => {
  const markup = valuation();
  assert.match(markup, /aria-label="Valuation Artifact"/);
  assert.match(markup, />DCF sensitivity</);
  assert.match(markup, />ACME</);
  // Labels, not raw keys.
  for (const label of ["Net debt", "Shares outstanding", "Free cash flows", "WACC grid", "Terminal growth grid", "Bear case › WACC", "Value per share", "Enterprise value", "Equity value", "PV of terminal value"]) {
    assert.ok(markup.includes(label), `missing readable label ${label}`);
  }
  for (const rawKey of ["netDebt", "waccPct", "sharesOutstanding", "valuePerShareMatrix", "freeCashFlows", "pvTerminalValue"]) {
    assert.ok(!markup.includes(rawKey), `raw key ${rawKey} leaked into the normal view`);
  }
  assert.doesNotMatch(markup, RAW_JSON);
  assert.doesNotMatch(markup, /aria-label="Artifact JSON"/);
  assert.doesNotMatch(markup, /ECharts|Recharts/);
});

test("valuation headline and scenario table keep exact stored values behind readable formatting", () => {
  const markup = valuation();
  assert.match(markup, /data-testid="valuation-headline"/);
  assert.match(markup, /<span title="71\.370824940136" data-exact="71\.370824940136"[^>]*>71\.37 per share<\/span>/);
  for (const column of [">Bear<", ">Base<", ">Bull<"]) assert.ok(markup.includes(column), `missing scenario column ${column}`);
  assert.match(markup, />46\.55 per share</);
  assert.match(markup, /data-exact="46\.54814097597518"/);
  assert.match(markup, />115\.81 per share</);
  assert.match(markup, /data-exact="115\.81092105792106"/);
  // Enterprise value is stored with full precision and only displayed with grouping.
  assert.match(markup, /data-exact="1598\.583234946871"[^>]*>1,598\.58</);
});

test("sensitivity grid is a 3x3 table with every value printed, heat shading and the base case marked", () => {
  const markup = valuation();
  const grid = markup.slice(markup.indexOf('aria-label="Sensitivity"'), markup.indexOf('aria-label="Sensitivity chart"') >= 0 ? markup.indexOf('aria-label="Sensitivity chart"') : undefined);
  assert.equal((grid.match(/data-heat="/g) ?? []).length, 9);
  assert.equal((grid.match(/background-color:rgba\(/g) ?? []).length, 9);
  assert.equal((grid.match(/<th scope="row"/g) ?? []).length, 3);
  assert.equal((grid.match(/<th scope="col"/g) ?? []).length, 4);
  assert.match(grid, /WACC ↓ \/ Terminal growth →/);
  // Axis labels carry units; cells carry readable values with the exact stored value attached.
  for (const axis of [">9%<", ">10%<", ">11%<", ">2%<", ">3%<", ">4%<"]) assert.ok(grid.includes(axis), `missing axis ${axis}`);
  assert.match(grid, /data-exact="63\.20887339740708"[^>]*>63\.21</);
  assert.match(grid, /data-exact="99\.28975077340591"[^>]*>99\.29</);
  // Only the base-case cell (WACC 10%, growth 3%) is marked, and it is the exact base value.
  assert.equal((grid.match(/data-base-case="true"/g) ?? []).length, 1);
  assert.match(grid, /data-base-case="true"[^>]*>.*?<span title="71\.370824940136" data-exact="71\.370824940136"[^>]*>71\.37<\/span>/);
  // The hottest and coolest cells differ in shading.
  assert.match(grid, /data-heat="1\.000"/);
  assert.match(grid, /data-heat="0\.000"/);
  // The existing chart renderer is mounted for the same grid (placeholder until the client-only renderer loads).
  assert.match(markup, /aria-label="Sensitivity chart"/);
});


test("full precision mode shows every stored digit", () => {
  const markup = valuation({ initialShowExact: true });
  assert.match(markup, />71\.370824940136 per share</);
  assert.match(markup, /aria-pressed="true"/);
  assert.match(markup, />Show formatted numbers</);
});

test("recorded valuation data is reachable only as read-only exact evidence, never raw JSON", () => {
  const closed = valuation();
  assert.match(closed, /<button[^>]*aria-expanded="false"[^>]*>.*?Expert view/);
  assert.doesNotMatch(closed, /<textarea/);
  const open = valuation({ expertDefaultOpen: true });
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /<div[^>]*aria-label="Recorded valuation data"/);
  assert.match(open, />71\.370824940136 per share</);
  assert.doesNotMatch(open, RAW_JSON);
  assert.match(open, /This is recorded calculation evidence, not an input editor/);
  assert.doesNotMatch(open, /<textarea|Save revision/);
});


test("Expert view panel mounts read-only valuation data only on explicit disclosure", () => {
  const closed = valuation();
  assert.match(closed, /<div id="[^"]+" hidden=""[^>]*><\/div>/);
  const open = valuation({ expertDefaultOpen: true });
  assert.doesNotMatch(open, /<div id="[^"]+" hidden=""/);
  assert.match(open, /aria-label="Recorded valuation data"/);
});

test("WACC control stages a proposal without changing stored calculations", () => {
  const markup = renderToStaticMarkup(createElement(ValuationArtifactView, {
    content: dcfSensitivityValuation, facts, onSave: save,
    onRequestRecalculation: () => undefined,
  }));
  assert.match(markup, /aria-label="Propose valuation assumption change"/);
  assert.match(markup, /Recorded value: 10% WACC/);
  assert.match(markup, /value="10"/);
  assert.match(markup, /Prepare recalculation in Chat/);
  assert.match(markup, /disabled=""/);
  assert.match(markup, /does not update the saved model/);
  assert.match(markup, /data-exact="71\.370824940136"/);
  assert.doesNotMatch(valuation(), /aria-label="Propose valuation assumption change"/);
});

test("unknown Artifact kinds get an honest fallback with export and no JSON", () => {
  const screen: ArtifactContent = { kind: "screen", view: "Equity screener", symbol: "ACME", state: { filters: [{ field: "marketCap", op: ">" }] } };
  const markup = renderToStaticMarkup(createElement(ArtifactViewerFallback, {
    kind: screen.kind, content: screen, onSave: save, onOpenExport: () => undefined,
    facts: [{ label: "Screen", value: "Equity screener" }, { label: "Symbol", value: "ACME" }],
  }));
  assert.match(markup, /No built-in viewer for this screen Artifact yet/);
  assert.match(markup, /saved and unchanged/);
  assert.match(markup, />Export this Artifact</);
  assert.match(markup, />Equity screener</);
  assert.doesNotMatch(markup, RAW_JSON);
  assert.doesNotMatch(markup, /marketCap|<textarea|<pre/);
  const withoutExport = renderToStaticMarkup(createElement(ArtifactViewerFallback, { kind: "screen", content: screen, onSave: save }));
  assert.doesNotMatch(withoutExport, />Export this Artifact</);
  const expert = renderToStaticMarkup(createElement(ArtifactViewerFallback, { kind: "screen", content: screen, onSave: save, expertDefaultOpen: true }));
  assert.match(expert, /&quot;marketCap&quot;/);
});

test("backtest shows status, warnings, labelled metrics and trades without JSON", () => {
  const content: Extract<ArtifactContent, { kind: "backtest" }> = {
    kind: "backtest", strategyRef: "Momentum 12-1", status: "completed",
    metrics: { sharpe: 1.23456789012345, maxDrawdownPct: -12.5, totalReturnPct: 34.2, cagr: 0.0812 },
    equityCurve: [{ at: "2025-01-02", value: 100000 }, { at: "2025-01-03", value: 100500.25 }],
    drawdown: [{ at: "2025-01-02", value: 0 }, { at: "2025-01-03", value: -1.5 }],
    trades: [{ symbol: "AAPL", side: "buy", quantity: 10, pnl: 1200.5, openedAt: "2025-01-02" }],
    benchmark: { name: "S&P 500", totalReturnPct: 20 },
    assumptions: { commissionBps: 1, slippageBps: 2 },
    reproducibilityHash: "d".repeat(64), pointInTimeVerified: false, warnings: ["Survivorship bias is not corrected."],
  };
  const markup = renderToStaticMarkup(createElement(BacktestArtifactView, { content, facts, onSave: save }));
  assert.match(markup, /Backtest · Momentum 12-1/);
  assert.match(markup, />Completed</);
  assert.match(markup, /role="alert"[^>]*aria-label="Backtest warnings"|aria-label="Backtest warnings"[^>]*role="alert"/);
  assert.match(markup, /Survivorship bias is not corrected\./);
  assert.match(markup, /Not point-in-time verified/);
  for (const label of ["Sharpe ratio", "Max drawdown", "Total return", "CAGR", "Commission", "Slippage"]) assert.ok(markup.includes(label), `missing ${label}`);
  assert.match(markup, />-12\.5%</);
  assert.match(markup, /data-exact="1\.23456789012345"[^>]*>1\.2346</);
  assert.match(markup, /aria-label="Equity curve"/);
  assert.match(markup, /aria-label="Drawdown"/);
  assert.match(markup, /aria-label="Trades table"/);
  assert.match(markup, />Symbol</);
  assert.doesNotMatch(markup, RAW_JSON);
  assert.doesNotMatch(markup, /maxDrawdownPct|totalReturnPct|<textarea/);
});

test("portfolio shows readable holdings and model results without JSON", () => {
  const content: Extract<ArtifactContent, { kind: "portfolio" }> = {
    kind: "portfolio", portfolioRef: "Core book",
    holdings: [{ symbol: "AAPL", weightPct: 12.5, marketValue: 2_500_000_000 }, { symbol: "MSFT", weightPct: 7.25, marketValue: 1_450_000_000 }],
    summary: { grossExposurePct: 98.4, positions: 2 },
    risk: { var95Pct: 2.1, nested: { betaToBenchmark: 1.05 } },
  };
  const markup = renderToStaticMarkup(createElement(PortfolioArtifactView, { content, facts, onSave: save }));
  assert.match(markup, /Holdings \(2\)/);
  assert.match(markup, />Market value</);
  assert.match(markup, />2\.5 billion</);
  assert.match(markup, />12\.5%</);
  assert.match(markup, />Gross exposure</);
  assert.match(markup, />Var95</);
  assert.match(markup, /Risk/);
  assert.match(markup, />Nested › Beta to benchmark</);
  assert.doesNotMatch(markup, RAW_JSON);
  assert.doesNotMatch(markup, /weightPct|marketValue|<textarea/);

  const modelRun: Extract<ArtifactContent, { kind: "portfolio" }> = {
    kind: "portfolio", portfolioRef: null, holdings: [],
    summary: { modelPath: "portfolio/hrp", modelId: "python.advanced.portfolio.hrp", validationLevel: "regression_tested", parameters: { assets: ["A", "B"] }, result: { weights: [0.55, 0.45] } },
    risk: { modelPath: "portfolio/hrp", parameters: { assets: ["A", "B"] }, result: { weights: [0.55, 0.45] } },
  };
  const run = renderToStaticMarkup(createElement(PortfolioArtifactView, { content: modelRun, facts, onSave: save }));
  assert.match(run, />HRP</);
  assert.match(run, /Regression tested/);
  assert.match(run, />Weights</);
  assert.match(run, />0\.55, 0\.45</);
  assert.equal((run.match(/aria-label="Results"/g) ?? []).length, 1);
  assert.doesNotMatch(run, /aria-label="Risk"/);
  assert.doesNotMatch(run, RAW_JSON);
});

test("columns recorded after the visible row page remain discoverable without widening that page", () => {
  const rows: Array<Record<string, unknown>> = Array.from({ length: 101 }, (_, index) => ({ index }));
  rows[100].lateRecordedMetric = 7;
  const markup = renderToStaticMarkup(createElement(ReadableRowsTable, { title: "Trades", rows, limit: 100 }));
  assert.match(markup, /Late recorded metric/i);
  assert.equal((markup.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0].match(/<tr/g) ?? []).length, 100);
});
