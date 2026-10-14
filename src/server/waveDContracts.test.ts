import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCommunicationPlan,
  buildWhatChanged,
  computeReportRefreshState,
  deriveActionInbox,
  evaluateSignalRule,
  evaluateThesisPillars,
  getWaveDReadiness,
  normalizeEventRoom,
  proposeNaturalLanguageMonitor,
  rankPulseCards,
  type PulseCardDraft,
} from "@shared/waveDContracts";

const NOW = new Date("2026-09-18T00:00:00.000Z");

function card(overrides: Partial<PulseCardDraft> = {}): PulseCardDraft {
  return {
    id: "card-1",
    kind: "alert",
    title: "AAPL monitor breached",
    whatHappened: "Price crossed the explicit threshold.",
    whyItMatters: "A monitor fired.",
    whyItMattersToUser: "Review the evidence.",
    nextActions: ["analyse", "monitor"],
    createdAt: "2026-09-17T23:00:00.000Z",
    unread: true,
    magnitude: 8,
    portfolioExposure: 0.8,
    thesisRelevance: 0.8,
    upcomingEvent: 0,
    evidence: [{ id: "e1", source: "test" }],
    ...overrides,
  };
}

test("Wave D readiness exposes the six continuous-intelligence workstreams", () => {
  const readiness = getWaveDReadiness();
  assert.equal(readiness.contractVersion, "1.0.0");
  assert.equal(readiness.workstreams.length, 6);
  assert.ok(readiness.guarantees.some((item) => item.includes("confirmation")));
});

test("Pulse ranking is deterministic and produces a decision-relevant inbox", () => {
  const ranked = rankPulseCards([card(), card({ id: "card-2", createdAt: "2026-09-01T00:00:00.000Z", magnitude: 0, portfolioExposure: 0 })], NOW);
  assert.equal(ranked[0].id, "card-1");
  assert.ok(["critical", "important"].includes(ranked[0].priority));
  const inbox = deriveActionInbox(ranked);
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].sourceCardId, "card-1");
});

test("Signal evaluation fails closed without an observation and breaches explicit thresholds", () => {
  const rule = { id: "r1", title: "AAPL price", subjectKey: "AAPL", metric: "price", operator: "above" as const, threshold: 100, unit: "currency", enabled: true, createdAt: NOW.toISOString() };
  assert.equal(evaluateSignalRule(rule, null, NOW).status, "unavailable");
  assert.equal(evaluateSignalRule(rule, { metric: "price", value: 101, observedAt: NOW.toISOString(), source: "quote" }, NOW).status, "breached");
  assert.equal(evaluateSignalRule({ ...rule, enabled: false }, { metric: "price", value: 101, observedAt: NOW.toISOString(), source: "quote" }, NOW).status, "disabled");
});

test("Natural-language monitors are proposals and never auto-enabled", () => {
  const proposal = proposeNaturalLanguageMonitor("Alert me if price goes above 125", "AAPL");
  assert.equal(proposal.status, "proposed");
  assert.equal(proposal.operator, "above");
  assert.equal(proposal.threshold, 125);
  assert.equal(proposal.requiresReview, true);
  assert.equal(proposeNaturalLanguageMonitor("Tell me anything material", "AAPL").status, "unsupported");
});

test("Thesis pillars and What Changed preserve unavailable state", () => {
  const result = evaluateThesisPillars([
    { id: "growth", title: "Growth", metric: "revenueGrowth", operator: "above", threshold: 10, unit: "%", evidenceIds: ["e0"] },
    { id: "margin", title: "Margin", metric: "margin", operator: "above", threshold: 20, unit: "%", evidenceIds: [] },
  ], [{ metric: "revenueGrowth", value: 12, observedAt: NOW.toISOString(), evidenceId: "e1" }]);
  assert.equal(result[0].status, "intact");
  assert.equal(result[0].evidenceIds.includes("e1"), true);
  assert.equal(result[1].status, "unavailable");
  const changed = buildWhatChanged({ subjectType: "thesis", subjectKey: "AAPL", before: { confidence: 0.8, note: "old" }, after: { confidence: 0.6, note: "old" } });
  assert.deepEqual(changed.changes, [{ field: "confidence", before: 0.8, after: 0.6 }]);
});

test("Event rooms and living reports expose explicit refresh state", () => {
  const room = normalizeEventRoom({ id: "earnings:AAPL:2026Q3", type: "earnings", title: "AAPL earnings", scheduledAt: "2026-09-17T23:00:00.000Z", evidenceIds: [], expectations: { eps: 1 }, reported: { eps: 1.1 } }, NOW);
  assert.equal(room.phase, "live");
  assert.ok(room.missing.includes("event-evidence"));
  const state = computeReportRefreshState([{ kind: "snapshot", id: "s1", revision: "1" }, { kind: "chart", id: "c1", revision: "1" }], [{ kind: "snapshot", id: "s1", revision: "2" }, { kind: "chart", id: "c1", revision: "1" }]);
  assert.equal(state.status, "refresh_required");
  assert.deepEqual(state.stale, ["snapshot:s1"]);
});

test("Communication plans enforce least privilege and explicit send confirmation", () => {
  assert.equal(buildCommunicationPlan("notifications_only", "read").status, "blocked");
  assert.equal(buildCommunicationPlan("read_analyse", "analyse").status, "ready");
  assert.equal(buildCommunicationPlan("draft_send", "send").status, "confirmation_required");
});
