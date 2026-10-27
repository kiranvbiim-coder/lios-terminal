import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AnalyticalContextChange } from "@/lib/terminalChangeIntelligence";
import { AnalyticalChangeStories, RecordedAnalyticalDifference } from "./AnalyticalChangeStories";

const capture: AnalyticalContextChange = {
  contextKey: "valuation:ABC",
  view: "valuation",
  symbol: "ABC",
  label: "Saved ABC valuation",
  capturedAt: 1_761_000_000_000,
  previousCapturedAt: 1_760_900_000_000,
  criticalCount: 1,
  materialCount: 1,
  changes: [
    { key: "Revenue", before: 100, after: 115, direction: "up", severity: "material", absoluteDelta: 15, percentDelta: 15 },
    { key: "Status", before: "review", after: "approved", direction: "changed", severity: "material" },
    { key: "New field", before: undefined, after: false, direction: "added", severity: "material" },
  ],
};

function page(entries: AnalyticalContextChange[]) {
  return renderToStaticMarkup(React.createElement(AnalyticalChangeStories, {
    entries, onOpen: () => {},
  }));
}

test("What Changed shows exact saved captures, two first fields and a working entry point", () => {
  const html = page([capture]);
  assert.match(html, /analytical-what-changed-stories/);
  assert.match(html, /Saved ABC valuation/);
  assert.match(html, /Revenue/);
  assert.match(html, />100</);
  assert.match(html, />115</);
  assert.match(html, /\+15 \(\+15\.0%\)/);
  assert.match(html, /Status/);
  assert.match(html, /Show all 3 fields/);
  assert.match(html, /Open analytical pane/);
  assert.match(html, /local snapshot differences/);
  assert.match(html, /not live market alerts/);
  assert.match(html, /No publisher citation is attached/);
  assert.doesNotMatch(html, /<img\b|https:\/\/example\.com/);
});

test("collapsed card doesn't leak hidden field values before user expansion", () => {
  const html = page([capture]);
  assert.doesNotMatch(html, /data-recorded-change="New field"/);
  assert.match(html, /3 changed fields/);
  assert.match(html, /1 more recorded fields available/);
  assert.match(html, /aria-expanded="false"/);
});

test("no snapshots never invent historical claims or inaccessible sources", () => {
  const html = page([]);
  assert.match(html, /No comparable snapshots yet/);
  assert.match(html, /two distinct saved captures/);
  assert.doesNotMatch(html, /data-changed-context/);
  assert.doesNotMatch(html, /href="https?:/);
});

test("markup from retained snapshots remains escaped", () => {
  const unsafe = { ...capture, label: "<script>bad</script>",
    changes: [{ key: '<img src="x">', before: "<script>x</script>", after: "clean", direction: "changed" as const, severity: "info" as const }] };
  const html = page([unsafe]);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=&quot;x&quot;&gt;/);
  assert.doesNotMatch(html, /<script\b|<img\b|<iframe\b/);
});

test("added field explicitly says not recorded, rather than treating missing as zero", () => {
  const html = renderToStaticMarkup(React.createElement(RecordedAnalyticalDifference, { change: capture.changes[2] }));
  assert.match(html, /Field added/);
  assert.match(html, /Not recorded/);
  assert.match(html, /False/);
  assert.doesNotMatch(html, /Recorded numeric difference/);
});
