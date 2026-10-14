import assert from "node:assert/strict";
import test from "node:test";
import { buildContextualAsk, buildEventNote, buildPulseBrief, classifySignalMetric, compareEventExpectations, dueScheduledMonitors, filterPulseCards, normalizeScheduledMonitor, reconcileExportReferences, WAVE_D_REPORT_TEMPLATES } from "@shared/waveDAdvancedContracts";
import type { ActionInboxItem, IntelligenceCard } from "@shared/waveDContracts";

const evidence = [{ id: "e1", source: "fixture", availableAt: "2026-09-18T00:00:00.000Z" }];
const cards: IntelligenceCard[] = [
  { id: "market:1", kind: "market_move", title: "AAPL moved", whatHappened: "AAPL moved 5%.", whyItMatters: "Review exposure.", whyItMattersToUser: "AAPL is followed.", nextActions: ["analyse"], createdAt: "2026-09-18T00:00:00.000Z", subjectKey: "AAPL", unread: true, magnitude: 5, evidence, score: 70, priority: "important", status: "unread" },
  { id: "research:1", kind: "research", title: "Research note", whatHappened: "New evidence.", whyItMatters: "It may affect the thesis.", whyItMattersToUser: "Review the evidence.", nextActions: ["ask"], createdAt: "2026-09-18T00:00:00.000Z", subjectKey: "MSFT", unread: false, evidence, score: 20, priority: "fyi", status: "read" },
];
const inbox: ActionInboxItem[] = [{ id: "inbox:market:1", sourceCardId: "market:1", title: "AAPL moved", reason: "Review", priority: "important", suggestedActions: ["investigate"], createdAt: "2026-09-18T00:00:00.000Z", status: "open", evidence }];

test("Pulse filters and briefs remain deterministic across channels", () => {
  assert.equal(filterPulseCards(cards, { channel: "markets" }).length, 1);
  assert.equal(filterPulseCards(cards, { channel: "following", subjectKeys: ["AAPL"] }).length, 1);
  const brief = buildPulseBrief("morning", cards, inbox, new Date("2026-09-18T12:00:00.000Z"));
  assert.equal(brief.status, "ready");
  assert.match(brief.headline, /1 actions/);
  assert.equal(brief.evidence.length, 1);
});

test("contextual asks fail closed without attributed evidence", () => {
  assert.equal(buildContextualAsk(cards[0], "Why?").status, "ready");
  assert.equal(buildContextualAsk(undefined, "Why?").status, "unavailable");
});

test("signal families and schedules preserve explicit cadence and unavailable event timing", () => {
  assert.equal(classifySignalMetric("revenue"), "fundamental");
  assert.equal(classifySignalMetric("CPI"), "macro");
  const event = normalizeScheduledMonitor({ id: "s1", ruleId: "macro:cpi", family: "macro", cadence: "event", timezone: "UTC", enabled: true }, new Date("2026-09-18T00:00:00.000Z"));
  assert.equal(event.nextRunAt, null);
  const due = normalizeScheduledMonitor({ id: "s2", ruleId: "price:AAPL", family: "price", cadence: "daily", timezone: "UTC", enabled: true, nextRunAt: "2026-09-17T00:00:00.000Z" }, new Date("2026-09-18T00:00:00.000Z"));
  assert.deepEqual(dueScheduledMonitors([due], new Date("2026-09-18T00:00:00.000Z")).map((item) => item.id), ["s2"]);
});

test("Event Room comparison and export reconciliation never infer missing values", () => {
  const comparison = compareEventExpectations({ revenue: 100, margin: null }, { revenue: 110, margin: 0.2 });
  assert.equal(comparison.status, "changed");
  assert.equal(comparison.fields.find((field) => field.field === "revenue")?.delta, 10);
  assert.equal(compareEventExpectations(undefined, { revenue: 100 }).status, "unavailable");
  const note = buildEventNote({ id: "room:1", type: "earnings", title: "Earnings", scheduledAt: "2026-09-18T00:00:00.000Z", evidenceIds: ["e1"] }, comparison);
  assert.equal(note.status, "ready");
  assert.equal(reconcileExportReferences([{ kind: "snapshot", id: "s1", revision: "1" }], [{ kind: "snapshot", id: "s1", revision: "2" }], "pdf").status, "blocked");
});

test("Wave D exposes the five governed output templates", () => {
  assert.deepEqual(WAVE_D_REPORT_TEMPLATES.map((item) => item.id), ["investment_memo", "valuation_report", "executive_board_brief", "portfolio_report", "research_note"]);
});
