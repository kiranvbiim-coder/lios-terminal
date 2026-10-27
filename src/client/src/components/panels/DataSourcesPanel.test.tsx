import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SourceRegistry, SourceRegistryItem } from "@shared/sourceRegistry";
import DataSourcesPanel from "./DataSourcesPanel";

const source = readFileSync(new URL("./DataSourcesPanel.tsx", import.meta.url), "utf8");
function item(id: string, adapterImplemented: boolean): SourceRegistryItem {
  return {
    id, connectorId: id, name: "Source " + id, kind: "catalog",
    group: "custom", sourceType: "private_api", category: "private_data",
    state: adapterImplemented ? "adapter_available" : "catalog_only",
    detail: "Provider catalogue entry", connected: false, operational: false,
    adapterImplemented, capabilities: [], connectionId: null,
    lastCheckedAt: null, lastHealthyAt: null, licenseCaveat: null,
  };
}
function renderSources(): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const registry: SourceRegistry = {
    generatedAt: "2026-10-27T12:00:00Z",
    summary: { catalogCount: 2, connectionCount: 0, operationalCount: 0, attentionCount: 0 },
    groups: [{ id: "custom", title: "Custom", description: "Recorded source catalogue",
      items: [item("unimplemented", false), item("supported", true)] }],
  };
  client.setQueryData(["/api/setup/source-registry"], registry);
  return renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(DataSourcesPanel, {
      onConnectProvider: () => undefined, onImportFile: () => undefined,
      onAddDatabase: () => undefined, onAddApi: () => undefined,
      onAddStorage: () => undefined,
    })));
}

test("A10 source catalogue does not offer a dead Configure CTA for an unimplemented adapter", () => {
  const html = renderSources();
  assert.match(html, /Source unimplemented/);
  assert.match(html, /no working connector adapter is available in this build/);
  assert.match(html, /Source supported/);
  assert.equal((html.match(/>Configure<\/button>/g) ?? []).length, 1);
  assert.match(html, /Connection Center/);
});

test("A10 failed registry refresh keeps cached read-only records visibly unverified", () => {
  assert.match(source, /if \(!query\.data\)/);
  assert.match(source, /const readOnly = query\.isError/);
  assert.match(source, /Unable to refresh connections/);
  assert.match(source, /Last loaded record only/);
  assert.match(source, /!readOnly && <div/);
  assert.match(source, /item\.kind === "catalog" && item\.adapterImplemented/);
  assert.match(source, /readOnly=\{readOnly\}/);
  assert.match(source, /Operational status unverified/);
  assert.match(source, /Retry connection status/);
  assert.match(source, /disabled=\{readOnly\}/);
  assert.doesNotMatch(source, /if \(query\.isError \|\| !query\.data\)/);
});
