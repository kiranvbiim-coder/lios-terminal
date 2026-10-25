/**
 * Source-level Node CPU/heap probe, not a Chrome/Electron FPS or shipped-device certification.
 * Run from src/: node --import tsx script/ws62_render_probe.bench.mjs
 * Record JSON beside an installed browser trace; do not compare unlike machines.
 */
import { performance } from "node:perf_hooks";
import { selectConversationMessageWindow, appendConversationPresentationEvent } from "../client/src/lib/conversationRenderBudget.ts";
import { prepareArtifactChart, selectArtifactChartViewport } from "../client/src/lib/artifactChartProjection.ts";

const largeHistory = Array.from({ length: 10_000 }, (_, i) => ({
  id: i, role: i % 2 ? "user" : "assistant", content: `Message ${i}: ${"full fidelity ".repeat(12)}`,
}));
const chart = { kind: "chart", chartType: "line", rendererPreference: "recharts", options: {},
  series: [{ id: "recorded", label: "Recorded", points: Array.from({ length: 100_000 }, (_, x) => ({ x, y: x % 7 - 3 })) }] };
const recentTable = Array.from({ length: 100_000 }, (_, id) => ({ id, value: id }));

function measure(name, task) {
  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  const result = task();
  return { name, elapsedMs: Number((performance.now() - start).toFixed(3)), heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore, ...result };
}
const output = [];
output.push(measure("chat_open_recent_10k", () => {
  const selected = selectConversationMessageWindow(largeHistory);
  if (selected.messages.length !== 80 || selected.hiddenCount !== 9_920) throw new Error("Unbounded initial Chat history");
  return { total: largeHistory.length, rendered: selected.messages.length };
}));
output.push(measure("chat_1000_refreshes_10k", () => {
  for (let i = 0; i < 1_000; i++) {
    if (selectConversationMessageWindow(largeHistory).messages.length !== 80) throw new Error("Unbounded Chat render");
  }
  return { iterations: 1_000, renderedPerRefresh: 80 };
}));
output.push(measure("cumulative_1000_stream_updates", () => {
  let events = [];
  const at = "2026-10-25T00:00:00Z";
  for (let i = 1; i <= 1_000; i++) {
    events = appendConversationPresentationEvent(events, { type: "text", requestId: "ws62", at, text: "x".repeat(i), label: "deterministic" });
  }
  if (events.length !== 1) throw new Error("Unbounded cumulative stream trace");
  return { updates: 1_000, retainedTextSnapshots: events.length };
}));
output.push(measure("chart_prepare_100k_exact_points", () => {
  const prepared = prepareArtifactChart(chart);
  if (prepared.status !== "ready") throw new Error("Unable to prepare chart");
  return { totalPoints: prepared.totalSourcePoints, plotted: selectArtifactChartViewport(prepared, { limit: 250 }).rows.length };
}));
output.push(measure("table_page_100k", () => {
  const rows = recentTable.slice(50_000, 50_100);
  if (rows.length !== 100 || rows[0].id !== 50_000) throw new Error("Invalid exact table paging");
  return { totalRows: recentTable.length, rendered: rows.length };
}));
process.stdout.write(JSON.stringify({ version: "WS-62-source-probe-v1", platform: process.platform, node: process.version, timestamp: new Date().toISOString(), results: output }, null, 2) + "\n");
