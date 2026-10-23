import test from "node:test";
import assert from "node:assert/strict";
import type { WorkSearchResult } from "@shared/workSearch";
import { matchesSavedSearchChat, shouldCloseSearchAfterNavigation } from "./workSearchNavigationPolicy";

const result = (kind: "chat" | "artifact" = "chat", projectId: number | null = null): WorkSearchResult => ({
  kind,
  id: kind === "chat" ? "chat:42" : "artifact:abc",
  title: "Saved work",
  snippet: null,
  projectId,
  chatId: 42,
  artifactId: kind === "artifact" ? "abc" : null,
  resourceId: null,
  updatedAt: "2026-10-22T11:00:00Z",
});
const chat = (projectId: number | null = null) => ({
  id: 42,
  projectId,
  scope: projectId === null ? "quick" as const : "project" as const,
  status: "active",
  trashedAt: null,
});

test("WS-17 saved Quick Chat matches only exact active owner", () => {
  assert.equal(matchesSavedSearchChat(result(), chat()), true);
  assert.equal(matchesSavedSearchChat(result(), { ...chat(), id: 43 }), false);
});

test("WS-17 saved Project Chat must remain in exact Project", () => {
  assert.equal(matchesSavedSearchChat(result("chat", 6), chat(6)), true);
  assert.equal(matchesSavedSearchChat(result("chat", 6), chat(7)), false);
  assert.equal(matchesSavedSearchChat(result("chat", 6), chat()), false);
});

test("WS-17 stale/trashed/archived Chat cannot be silently opened", () => {
  assert.equal(matchesSavedSearchChat(result(), { ...chat(), status: "archived" }), false);
  assert.equal(matchesSavedSearchChat(result(), { ...chat(), trashedAt: "2026-10-23T09:00:00Z" }), false);
});

test("WS-17 mismatched Quick vs Project mode is rejected", () => {
  assert.equal(matchesSavedSearchChat(result(), { ...chat(), scope: "project" }), false);
  assert.equal(matchesSavedSearchChat(result("chat", 6), { ...chat(6), scope: "quick" }), false);
});

test("WS-17 Artifact result can follow owning Quick Chat but not another record", () => {
  assert.equal(matchesSavedSearchChat(result("artifact"), chat()), true);
  assert.equal(matchesSavedSearchChat(result("artifact"), { ...chat(), id: 9 }), false);
  assert.equal(matchesSavedSearchChat(result("artifact", 10), chat()), false);
});

test("WS-17 Project or File result cannot masquerade as Chat and cause navigation", () => {
  const project = { ...result(), kind: "project" as const };
  const file = { ...result(), kind: "file" as const };
  assert.equal(matchesSavedSearchChat(project, chat()), false);
  assert.equal(matchesSavedSearchChat(file, chat()), false);
});

test("WS-17 only actual successfully opened result closes dialog", () => {
  assert.equal(shouldCloseSearchAfterNavigation(true), true);
  assert.equal(shouldCloseSearchAfterNavigation(false), false);
});

test("WS-17 a refused switch does not create a new search result or guess object identity", () => {
  assert.deepEqual(result("chat", 19).projectId, 19);
  assert.equal(matchesSavedSearchChat(result("chat", 19), chat(19)), true);
  assert.equal(matchesSavedSearchChat(result("chat", 19), chat(20)), false);
});
