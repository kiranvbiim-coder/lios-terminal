import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GraphExplorerCompactList } from "./GraphExplorerCompactList";
import type { CrossDomainNode } from "@/lib/terminalCrossDomainGraph";

const nodes: CrossDomainNode[] = [
  { objectId: "recorded:1", label: "Observed earnings", domain: "finance", symbol: "LIOS", strength: 0.9 },
  { objectId: "recorded:2", label: "Demand thesis", domain: "research", strength: 0.5 },
];

test("narrow Graph Explorer is a real, selectable semantic list of the same recorded nodes", () => {
  const html = renderToStaticMarkup(React.createElement(GraphExplorerCompactList, {
    nodes, selectedId: "recorded:1", onSelect: () => {},
    emptyMessage: "No recorded nodes",
  }));
  assert.match(html, /aria-label="Compact Intelligence Graph"/);
  assert.match(html, /class="[^"]*md:hidden/);
  assert.match(html, /<ol[^>]*aria-label="Recorded graph objects"/);
  assert.match(html, /<button[^>]*aria-pressed="true"[^>]*aria-label="Inspect Observed earnings in Finance"/);
  assert.match(html, /<button[^>]*aria-pressed="false"[^>]*aria-label="Inspect Demand thesis in Research"/);
  assert.match(html, /Observed earnings/);
  assert.match(html, /LIOS/);
  assert.doesNotMatch(html, /<svg|<canvas|invented/i);
});

test("compact Graph Explorer gives an explicit empty or filtered state, not fake graph nodes", () => {
  const html = renderToStaticMarkup(React.createElement(GraphExplorerCompactList, {
    nodes: [], selectedId: null, onSelect: () => {},
    emptyMessage: "No matching recorded objects. Reset the filters.",
  }));
  assert.match(html, /role="status"/);
  assert.match(html, /No matching recorded objects/);
  assert.doesNotMatch(html, /<button/);
});
