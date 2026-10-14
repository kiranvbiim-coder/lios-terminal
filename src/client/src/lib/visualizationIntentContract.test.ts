import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  MONITOR_CONTEXT_MAX_HEIGHT_PX,
  MONITOR_VISUALIZATION_SURFACES,
  VISUALIZATION_INTENT_POLICIES,
  canUseVisualizationIntentOnMonitor,
} from "./visualizationIntent";

const srcRoot = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(srcRoot, relativePath), "utf8");
}

function numericResponsiveHeights(source: string): number[] {
  return Array.from(source.matchAll(/<ResponsiveContainer\b[^>]*\bheight=\{(\d+)\}/g), (match) => Number(match[1]));
}

test("visualization intent keeps monitors context-only", () => {
  assert.equal(canUseVisualizationIntentOnMonitor("context"), true);
  assert.equal(canUseVisualizationIntentOnMonitor("diagnostic"), false);
  assert.equal(canUseVisualizationIntentOnMonitor("primary"), false);
  assert.equal(VISUALIZATION_INTENT_POLICIES.context.maxInlineHeightPx, 96);
});

test("monitor surfaces do not reintroduce large generic chart canvases", () => {
  for (const relativePath of MONITOR_VISUALIZATION_SURFACES) {
    const source = read(relativePath);
    const heights = numericResponsiveHeights(source);
    const oversized = heights.filter((height) => height > MONITOR_CONTEXT_MAX_HEIGHT_PX);
    assert.deepEqual(
      oversized,
      [],
      `${relativePath} contains ${oversized.join(", ")}px overview chart(s). Monitoring surfaces may use micro-context visuals only; route diagnostic or primary visualization to a workstation/chart surface.`,
    );
  }
});

test("market overview uses only micro visual context", () => {
  const source = read("client/src/components/panels/MarketOverview.tsx");
  const heights = numericResponsiveHeights(source);
  assert.ok(heights.length > 0, "Market Overview should retain useful micro market context.");
  assert.ok(heights.every((height) => height <= MONITOR_CONTEXT_MAX_HEIGHT_PX), "Market Overview sparklines must remain context-sized.");
});

test("economics overview remains a monitor, not a duplicate calendar workstation", () => {
  const source = read("client/src/components/panels/EconomicsOverviewPanel.tsx");
  assert.equal(source.includes("useEconomicEventDetail"), false, "Economics overview must not fetch event-detail payloads.");
  assert.equal(source.includes("min-h-[420px]"), false, "Economics overview must not embed the legacy full-height event browser.");
  assert.equal(source.includes("onOpenCalendar"), true, "Economics overview should drill into the dedicated calendar workstation.");
});

test("quote overview keeps a dedicated chart escape hatch", () => {
  const source = read("client/src/components/panels/QuotePanel.tsx");
  assert.equal(source.includes('onNav("chart")'), true, "Quote overview should route deep time-series analysis to Chart.");
  assert.equal(source.includes("data-quote-sparkline"), true, "Quote overview should retain only micro trend context.");
  assert.equal(source.includes("ResponsiveContainer"), false, "Quote micro-context should not pull a chart canvas dependency back into the overview.");
});
