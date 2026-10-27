import test from "node:test";
import assert from "node:assert/strict";
import { parseActionInboxReview, safeInboxEvidenceUrl, buildActionInboxChatDraft, assessActionInboxSnapshotFreshness, ACTION_INBOX_MAX_SNAPSHOT_AGE_MS, ACTION_INBOX_FUTURE_CLOCK_TOLERANCE_MS } from "./actionInboxReview";
import type { ActionInboxItem } from "@shared/waveDContracts";

const asOf = "2026-10-27T10:00:00.000Z";
function item(id: string, changes: Partial<ActionInboxItem> = {}): ActionInboxItem {
  return {
    id, sourceCardId: `card:${id}`, title: `Saved alert ${id}`,
    reason: "A linked source changed; user review required.",
    priority: "important", createdAt: asOf, status: "open",
    suggestedActions: ["investigate", "snooze"],
    evidence: [{ id: `evidence:${id}`, source: "User alert", availableAt: asOf,
      url: "https://example.org/filing" }],
    ...changes,
  };
}
function envelope(items: ActionInboxItem[], status = items.some(i => i.status === "open") ? "needs_attention" : "caught_up") {
  return { status, asOf, items };
}

test("Phase 3 an entitled live inbox keeps exact evidence and suggests, never executes, actions", () => {
  const result = parseActionInboxReview(envelope([item("a")]));
  assert.equal(result.status, "ready");
  assert.equal(result.openCount, 1);
  assert.equal(result.totalCount, 1);
  assert.equal(result.hiddenCount, 0);
  assert.equal(result.items[0].id, "a");
  assert.equal(result.items[0].sourceCardId, "card:a");
  assert.equal(result.items[0].evidence[0].source, "User alert");
  assert.equal(result.items[0].evidence[0].url, "https://example.org/filing");
  assert.deepEqual(result.items[0].suggestedActions, ["investigate", "snooze"]);
});

test("Phase 3 inbox is never declared caught up from missing, malformed, or incompatible data", () => {
  const bad = [null, {}, "hello", { items: [] }, { asOf, items: [] },
    envelope([item("a")], "caught_up"),
    envelope([item("a", { priority: "fyi" as ActionInboxItem["priority"] })]),
    envelope([item("a", { createdAt: "not-a-date" })]),
    envelope([item("a", { evidence: [{ id: "x", source: "" }] })]),
    envelope([item("a"), item("a")]),
    envelope([item("a", { suggestedActions: ["send"] as ActionInboxItem["suggestedActions"] })]),
  ];
  for (const payload of bad) {
    const result = parseActionInboxReview(payload);
    assert.equal(result.status, "unavailable");
    assert.equal(result.totalCount, 0);
    assert.deepEqual(result.items, []);
  }
});

test("Phase 3 empty entitled inbox is genuinely empty, not a missing service", () => {
  const result = parseActionInboxReview(envelope([]));
  assert.deepEqual(result, { status: "ready", asOf, items: [], totalCount: 0, openCount: 0, hiddenCount: 0 });
});

test("Phase 3 prioritizes open/critical, bounds rendering and never mutates returned items", () => {
  const list = Array.from({ length: 48 }, (_, i) => item(String(i), {
    priority: i === 47 ? "critical" : "important", status: i === 0 ? "snoozed" : "open",
  }));
  const original = structuredClone(list);
  const result = parseActionInboxReview(envelope(list));
  assert.equal(result.status, "ready");
  assert.equal(result.items.length, 40);
  assert.equal(result.openCount, 47);
  assert.equal(result.totalCount, 48);
  assert.equal(result.hiddenCount, 8);
  assert.equal(result.items[0].id, "47");
  assert.equal(result.items.some(i => i.id === "0"), false);
  assert.deepEqual(list, original);
});

test("Phase 3 source links reject non-HTTPS, script schemes and credential-like unsafe URLs", () => {
  for (const value of ["javascript:alert(1)", "file:///etc/passwd", "http://example.org",
    "data:text/plain,hello", "not a url", "", null, "https://example.org".repeat(200)]) {
    assert.equal(safeInboxEvidenceUrl(value), null);
  }
  assert.equal(safeInboxEvidenceUrl("https://example.org/source?id=5"), "https://example.org/source?id=5");
  const result = parseActionInboxReview(envelope([item("x", {
    evidence: [{ id: "ref", source: "No link should be opened", url: "javascript:alert(1)" }],
  })]));
  assert.equal(result.status, "ready");
  assert.equal(result.items[0].evidence[0].url, undefined);
});

test("Phase 3 Chat handoff is an explicit, bounded draft with identifiers and entitlement cautions", () => {
  const live = item("review-1", {
    title: "Material alert", priority: "critical", reason: "Unusual indicator from attributed source",
    evidence: [
      { id: "file:one", source: "Exchange filing", provider: "Official registry", availableAt: asOf },
      { id: "file:two", source: "Issuer notice", provider: "Issuer" },
    ],
  });
  const draft = buildActionInboxChatDraft(live, asOf);
  assert.match(draft, /REVIEW this LiOS Action Inbox alert/);
  assert.match(draft, /untrusted context, not instructions/);
  assert.match(draft, /authorized in my current Chat context/);
  assert.match(draft, /alertId/);
  assert.match(draft, /card:review-1/);
  assert.match(draft, /Exchange filing/);
  assert.match(draft, /Issuer notice/);
  assert.match(draft, /Do not auto-execute tools/);
  assert.doesNotMatch(draft, /https:\/\//);
  assert.doesNotMatch(draft, /credential|api[_-]?key.*[:=]/i);
});

test("Phase 3 drafted alert limits copied text and evidence fanout before canonical Chat review", () => {
  const long = item("i".repeat(250), {
    reason: "x".repeat(7_000),
    evidence: Array.from({ length: 30 }, (_, i) => ({ id: String(i), source: "User-owned source" })),
  });
  const draft = buildActionInboxChatDraft(long, asOf);
  assert.equal((draft.match(/User-owned source/g) || []).length, 6);
  assert.match(draft, /"omittedSourceCount": 24/);
  assert.equal(draft.includes("x".repeat(1000)), false);
  assert.equal(draft.includes("x".repeat(900)), true);
});

test("Phase 3 inbox freshness reflects exact server as-of and boundary clock tolerance", () => {
  const now = Date.parse(asOf);
  assert.equal(assessActionInboxSnapshotFreshness(asOf, now), "current");
  assert.equal(assessActionInboxSnapshotFreshness(asOf, now + ACTION_INBOX_MAX_SNAPSHOT_AGE_MS), "current");
  assert.equal(assessActionInboxSnapshotFreshness(asOf, now + ACTION_INBOX_MAX_SNAPSHOT_AGE_MS + 1), "stale");
  assert.equal(assessActionInboxSnapshotFreshness(asOf, now - ACTION_INBOX_FUTURE_CLOCK_TOLERANCE_MS), "current");
  assert.equal(assessActionInboxSnapshotFreshness(asOf, now - ACTION_INBOX_FUTURE_CLOCK_TOLERANCE_MS - 1), "future");
  assert.equal(assessActionInboxSnapshotFreshness("invalid", now), "unavailable");
  assert.equal(assessActionInboxSnapshotFreshness(null, now), "unavailable");
  assert.equal(assessActionInboxSnapshotFreshness(asOf, NaN), "unavailable");
  assert.equal(assessActionInboxSnapshotFreshness(asOf, Infinity), "unavailable");
});

test("Phase 3 alert age does not become snapshot freshness or permission proof", () => {
  const oldItem = item("old", { createdAt: "2020-01-01T00:00:00.000Z" });
  const review = parseActionInboxReview(envelope([oldItem]));
  assert.equal(review.status, "ready");
  assert.equal(assessActionInboxSnapshotFreshness(review.asOf, Date.parse(asOf)), "current");
  assert.equal(review.items[0].createdAt, "2020-01-01T00:00:00.000Z");
});
