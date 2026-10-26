import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LifecycleCenter } from "./LifecycleCenter";

const projectTrash = ["/api/projects", "trash"];

function fixture() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  for (const status of ["active", "archived", "trash"]) client.setQueryData(["/api/projects", status], []);
  for (const status of ["archived", "trash"]) {
    client.setQueryData(["/api/project-chats", status], []);
    client.setQueryData(["/api/quick-chats", status], []);
    client.setQueryData(["/api/artifacts", status], []);
  }
  return client;
}

function renderGroup(client: QueryClient, title: string) {
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(LifecycleCenter, {
    onClose: () => {}, onNotice: () => {}, onInvalidate: () => {},
  })));
  const start = html.indexOf(`>${title}</h2>`);
  assert.notEqual(start, -1);
  return html.slice(start, html.indexOf("</section>", start));
}

test("failed recovery reads never claim empty Trash or expose cached destructive actions", () => {
  const client = fixture();
  try {
    client.setQueryData(projectTrash, [{ id: 1, name: "Previously readable Project", status: "archived", trashedAt: "2026-10-26T00:00:00Z" }]);
    client.getQueryCache().find({ queryKey: projectTrash, exact: true })!.setState({ status: "error", error: new Error("403: PRIVATE_DETAIL") });
    const html = renderGroup(client, "Projects");
    assert.match(html, /role="alert"/);
    assert.doesNotMatch(html, /Trash is empty|Previously readable Project|PRIVATE_DETAIL/);
    assert.doesNotMatch(html, /aria-label="Actions for/);
  } finally { client.clear(); }
});

test("an in-flight initial recovery read is busy, not empty", () => {
  const client = fixture();
  try {
    client.getQueryCache().find({ queryKey: projectTrash, exact: true })!.setState({ data: undefined, status: "pending", fetchStatus: "fetching" });
    const html = renderGroup(client, "Projects");
    assert.match(html, /role="status"/);
    assert.match(html, /aria-busy="true"/);
    assert.doesNotMatch(html, /Trash is empty/);
  } finally { client.clear(); }
});

test("unavailable resource reads do not claim a Project has no trashed resources", () => {
  const client = fixture();
  try {
    client.setQueryData(["/api/projects", "active"], [{ id: 1, name: "Recovery Project" }, { id: 2, name: "Healthy Project" }]);
    const key = ["/api/projects", 1, "resources", "trash"];
    client.setQueryData(key, []);
    client.setQueryData(["/api/projects", 1, "sessions", "trash"], []);
    client.getQueryCache().find({ queryKey: key, exact: true })!.setState({ status: "error", error: new Error("503: PRIVATE_DETAIL") });
    const html = renderGroup(client, "Project resources &amp; Sessions");
    assert.match(html, /role="alert"/);
    assert.doesNotMatch(html, /No trashed resources|PRIVATE_DETAIL/);
    assert.match(html, /<select/);
    assert.match(html, /<option value="2">Healthy Project<\/option>/);
  } finally { client.clear(); }
});

test("disabled item reads cannot make an account with no active Projects look broken", () => {
  const client = fixture();
  try {
    for (const kind of ["resources", "sessions"]) {
      const key = ["/api/projects", null, kind, "trash"];
      client.setQueryData(key, []);
      client.getQueryCache().find({ queryKey: key, exact: true })!.setState({ status: "error", error: new Error("Invalid Project") });
    }
    const html = renderGroup(client, "Project resources &amp; Sessions");
    assert.doesNotMatch(html, /role="alert"/);
    assert.match(html, /No active Project to inspect/);
  } finally { client.clear(); }
});
