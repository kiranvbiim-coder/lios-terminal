import * as React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { filterSourceCatalogue } from "./filterSourceCatalogue";
import { SourceCatalogueSearch } from "../components/terminal/SourceCatalogueSearch";
import type { SourceRegistryGroup, SourceRegistryItem } from "@shared/sourceRegistry";

function entry(id: string, name: string, connected: boolean, state: SourceRegistryItem["state"]): SourceRegistryItem {
  return {
    id, connectorId: id, name, kind: "catalog", group: "finance_market", sourceType: "market_data",
    category: "market_data", state, detail: name + " market observations",
    connected, operational: connected, adapterImplemented: true, capabilities: [],
    licenseCaveat: null, connectionId: connected ? 1 : null, lastCheckedAt: null, lastHealthyAt: null,
  } as SourceRegistryItem;
}
const groups = [{
  id: "finance_market", title: "Market data", description: "Finance",
  items: [entry("a", "Alpha quotes", true, "healthy"), entry("b", "Beta statements", false, "unreachable")],
}] as SourceRegistryGroup[];

test("catalog filtering matches name, source detail, state and group title without altering source records", () => {
  assert.deepEqual(filterSourceCatalogue(groups, "  ALPHA  ", false).map(x => x.id), ["a"]);
  assert.deepEqual(filterSourceCatalogue(groups, "statements", false).map(x => x.id), ["b"]);
  assert.deepEqual(filterSourceCatalogue(groups, "unreachable", false).map(x => x.id), ["b"]);
  assert.deepEqual(filterSourceCatalogue(groups, "market DATA", false).map(x => x.id), ["a", "b"]);
  assert.deepEqual(filterSourceCatalogue(groups, "nonsense", false), []);
  assert.equal(groups[0].items.length, 2);
});
test("connected filter does not treat listed sources as authorization", () => {
  assert.deepEqual(filterSourceCatalogue(groups, "", true).map(x => x.id), ["a"]);
  assert.deepEqual(filterSourceCatalogue(groups, "beta", true), []);
});
test("upstream-derived LIOS search retains an accessible label, status and clearing affordance", () => {
  const html = renderToStaticMarkup(React.createElement(SourceCatalogueSearch, { value: "GDP", onClear: () => {} }));
  assert.match(html, /data-slot="source-catalogue-search"/);
  assert.match(html, /role="searchbox"/);
  assert.match(html, /Search sources/);
  assert.match(html, /value="GDP"/);
  assert.match(html, /Clear source search/);
  assert.match(html, /bg-background/);
  assert.doesNotMatch(html, /bg-white|text-neutral-900/);
});