import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import { invalidateAllTopics, invalidateTopics } from "./dataInvalidation";

function seeded() {
  const client = new QueryClient();
  for (const key of [["/api/alerts"], ["/api/client/dashboard/alerts"], ["/api/backup"], ["/api/license/status"], ["/api/devices"], ["/api/unrelated"]]) client.setQueryData(key, { fresh: true });
  return client;
}
const stale = (client: QueryClient, key: string) => client.getQueryState([key])?.isInvalidated === true;

test("a topic invalidates exactly the queries that hold its data", () => {
  const client = seeded();
  invalidateTopics(client, ["backup"]);
  assert.equal(stale(client, "/api/backup"), true);
  for (const key of ["/api/alerts", "/api/client/dashboard/alerts", "/api/license/status", "/api/devices", "/api/unrelated"]) assert.equal(stale(client, key), false, key);
});

test("alerts covers both audiences, quantlab is left to its panel, and a reconnect refreshes every mapped topic but nothing else", () => {
  const client = seeded();
  invalidateTopics(client, ["alerts", "quantlab"]);
  assert.equal(stale(client, "/api/alerts"), true);
  assert.equal(stale(client, "/api/client/dashboard/alerts"), true);
  assert.equal(stale(client, "/api/backup"), false);

  const resync = seeded();
  invalidateAllTopics(resync);
  for (const key of ["/api/alerts", "/api/client/dashboard/alerts", "/api/backup", "/api/license/status", "/api/devices"]) assert.equal(stale(resync, key), true, key);
  assert.equal(stale(resync, "/api/unrelated"), false);
});


test("P9 notification hint invalidates every cached Project notification view, but no unrelated P9 queries", () => {
  const client = seeded();
  const ownerProject = ["/api/projects", 17, "automation", "notifications"];
  const otherProject = ["/api/projects", 91, "automation", "notifications"];
  const workflow = ["/api/projects", 17, "automation", "workflows"];
  const runs = ["/api/projects", 17, "automation", "runs"];
  const continuity = ["/api/projects", 17, "continuity"];
  for (const key of [ownerProject, otherProject, workflow, runs, continuity]) {
    client.setQueryData(key, { fresh: true });
  }
  invalidateTopics(client, ["notifications"]);
  assert.equal(client.getQueryState(ownerProject)?.isInvalidated, true);
  assert.equal(client.getQueryState(otherProject)?.isInvalidated, true);
  for (const key of [workflow, runs, continuity]) {
    assert.equal(client.getQueryState(key)?.isInvalidated, false, JSON.stringify(key));
  }
  assert.equal(stale(client, "/api/unrelated"), false);
  assert.equal(stale(client, "/api/devices"), false);
  const reconnected = new QueryClient();
  reconnected.setQueryData(ownerProject, { fresh: true });
  invalidateAllTopics(reconnected);
  assert.equal(reconnected.getQueryState(ownerProject)?.isInvalidated, true,
    "a reconnect must reconcile notifications that arrived while disconnected");
});
