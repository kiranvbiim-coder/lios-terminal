import assert from "node:assert/strict";
import test from "node:test";
import type { ArtifactContent } from "@shared/artifactContracts";
import { recordedArtifactPreview } from "./recordedArtifactPreview";

const preview = (content: unknown) => recordedArtifactPreview(content as ArtifactContent);

test("WS-34 chart preview counts only saved series and data points; never invents performance", () => {
  const content = {
    kind: "chart", chartType: "line",
    series: [
      { id: "a", label: "Revenue", points: [{ x: "2025", y: 100 }, { x: "2026", y: 109 }] },
      { id: "b", label: "Margin", points: [] },
    ], rendererPreference: "recharts", options: { privateKey: "NEVER_EXPOSE" },
  };
  assert.equal(preview(content), "line chart · 2 recorded series · 2 recorded points");
  assert.ok(!preview(content)!.includes("NEVER_EXPOSE"));
  assert.equal(preview({ ...content, series: [] }), "line chart · 0 recorded series · 0 recorded points");
});

test("WS-34 table, data, spreadsheet and portfolio previews use only actual recorded counts", () => {
  assert.equal(preview({ kind: "table", rows: [{ x: 1 }, { x: null }], columns: [{ key: "x", label: "X", type: "number" }] }),
    "Table · 2 recorded rows · 1 columns");
  assert.equal(preview({ kind: "data", rowCount: 14000, previewRows: [{ x: 1 }], columns: [
    { name: "x", type: "number" }, { name: "y", type: "number" },
  ] }), "Data · 14000 declared rows · 2 columns", "preview row count must not be misrepresented as total data");
  assert.equal(preview({ kind: "spreadsheet", sheets: [
    { id: "s1", name: "Budget", cells: { A1: { raw: "=1+2" } } },
    { id: "s2", name: "Forecast", cells: {} },
  ], activeSheetId: "s1" }), "Spreadsheet · 2 saved sheets");
  assert.equal(preview({ kind: "portfolio", holdings: [{ secret: "NOT_ALLOWED" }], summary: {} }),
    "Portfolio · 1 saved holdings");
  assert.ok(!preview({ kind: "portfolio", holdings: [{ secret: "NOT_ALLOWED" }] })!.includes("NOT_ALLOWED"));
});

test("WS-34 document, research and decision previews show only bounded task-shaped text", () => {
  const question = "What changed in the 10-K filings?";
  assert.equal(preview({ kind: "research", question, blocks: [], claims: [], evidence: [] }),
    "Research question · What changed in the 10-K filings?");
  assert.equal(preview({ kind: "research", question: "", blocks: [{ type: "paragraph" }],
    evidence: [{ sourceRef: "private:document" }] }), "Research · 1 saved blocks · 1 recorded evidence entries");
  assert.equal(preview({ kind: "report", blocks: [{ id: "b" }], sections: [{ id: "s" }] }),
    "Report · 1 sections · 1 saved blocks");
  const repeated = "analysis ".repeat(40);
  const bounded = preview({ kind: "decision", objective: repeated });
  assert.ok(bounded?.startsWith("Decision objective · analysis"));
  assert.ok(bounded && bounded.length < 150);
  assert.ok(bounded?.endsWith("…"));
});

test("WS-34 status and unsupported previews never imply a verification or live entitlement", () => {
  assert.equal(preview({ kind: "backtest", status: "stale", trades: [{ private: "x" }] }),
    "Backtest · recorded status: stale · 1 saved trades");
  assert.equal(preview({ kind: "strategy", validation: { status: "unvalidated" }, source: "API_KEY_DONT_RENDER" }),
    "Strategy · recorded validation: unvalidated");
  assert.equal(preview({ kind: "thesis", status: "invalidated", claims: [] }),
    "Thesis · recorded state: invalidated");
  assert.equal(preview({ kind: "valuation", modelId: "dcf_v1", symbol: "AAPL", outputs: { secret: "x" } }),
    "Valuation · model dcf_v1 · AAPL");
  assert.equal(preview({ kind: "screen", view: "Equity screener", symbol: "AAPL", state: { sourceToken: "NO" } }),
    "Saved screen · Equity screener");
  assert.equal(preview({ kind: "timeline" }), null, "unknown shape cannot get a fabricated visual result");
});
