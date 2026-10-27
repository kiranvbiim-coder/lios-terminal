import test from "node:test";
import assert from "node:assert/strict";
import type { ActionInboxItem, IntelligenceCard } from "@shared/waveDContracts";
import {
  ATTENTION_FILTERS, filterHomeAttention, homeAttentionCounts,
  homeAttentionEntries, homeAttentionReasons,
} from "./homeIntelligenceDiscovery";

function card(id: string, kind: IntelligenceCard["kind"], priority: IntelligenceCard["priority"] = "important"): IntelligenceCard {
  return {
    id, kind, priority, title: `Headline for ${id}`, whatHappened: "Observed update",
    whyItMatters: "Source provided rationale", whyItMattersToUser: "Project relevance recorded",
    nextActions: ["ask"], createdAt: "2026-10-27T02:00:00Z",
    evidence: [{ id: `source-${id}`, source: "Independent report", url: "https://example.org/doc" }],
    status: "unread", score: 67, unread: true,
  };
}
function inbox(sourceCardId: string, status: ActionInboxItem["status"] = "open"): ActionInboxItem {
  return {
    id: `inbox:${sourceCardId}`, sourceCardId, status, priority: "important",
    title: "Review a material event", reason: "Observed change",
    suggestedActions: ["investigate"], createdAt: "2026-10-27T02:00:00Z",
    evidence: [],
  };
}

test("no synthetic action inbox is created from merely relevant source cards", () => {
  const entries = homeAttentionEntries([
    card("market", "market_move"), card("research", "research"),
    card("routine", "news", "fyi"),
  ], [inbox("market"), inbox("research", "resolved")]);
  assert.deepEqual(entries.map(entry => entry.card.id), ["market", "research"]);
  assert.deepEqual(entries.map(entry => entry.reviewStatus), ["open", "resolved"]);
  const withoutInbox = homeAttentionEntries([card("no-action", "macro")], []);
  assert.equal(withoutInbox[0].inbox, null);
  assert.equal(withoutInbox[0].reviewStatus, null);
});

test("filters are source-grounded, cross-domain and mutually predictable", () => {
  const data = homeAttentionEntries([
    card("energy", "research"),
    card("market", "market_move"),
    card("health", "news"),
    card("alarm", "alert"),
    card("draft", "report"),
    card("routine", "market_move", "fyi"),
  ], [inbox("energy"), inbox("market", "snoozed"), inbox("alarm")]);
  const counts = homeAttentionCounts(data);
  assert.deepEqual(counts, { all: 5, needs_review: 2, research: 3, markets: 1, signals: 1 });
  assert.equal(ATTENTION_FILTERS.length, 5);
  assert.deepEqual(filterHomeAttention(data, "needs_review", "").map(entry => entry.card.id), ["energy", "alarm"]);
  assert.deepEqual(filterHomeAttention(data, "markets", "").map(entry => entry.card.id), ["market"]);
  assert.deepEqual(filterHomeAttention(data, "research", "independent").map(entry => entry.card.id), ["energy", "health", "draft"]);
  assert.deepEqual(filterHomeAttention(data, "research", "absent-subject"), []);
  assert.deepEqual(filterHomeAttention(data, "all", "HEALTH").map(entry => entry.card.id), ["health"]);
});

test("ranking explanations distinguish available inputs from absent data, not inferred preferences", () => {
  const observed = card("known", "alert");
  observed.portfolioExposure = 0.5;
  observed.thesisRelevance = 0.8;
  observed.upcomingEvent = 0.3;
  observed.magnitude = 4;
  const reasons = homeAttentionReasons(observed);
  assert.ok(reasons.some(item => /priority/.test(item)));
  assert.ok(reasons.some(item => /portfolio-exposure/.test(item)));
  assert.ok(reasons.some(item => /thesis-relevance/.test(item)));
  assert.ok(reasons.some(item => /upcoming-event/.test(item)));
  assert.ok(reasons.some(item => /event-magnitude/.test(item)));
  assert.ok(reasons.some(item => /1 source reference attached/.test(item)));

  const unknown = card("unverified", "news");
  unknown.evidence = [];
  const fallback = homeAttentionReasons(unknown).join(" ");
  assert.match(fallback, /No attributable source evidence/);
  assert.doesNotMatch(fallback, /portfolio-exposure|thesis-relevance|upcoming-event|event-magnitude/);
});

test("a source-only FYI card is excluded unless the server explicitly returns a review item", () => {
  const fyi = card("fyi", "news", "fyi");
  assert.equal(homeAttentionEntries([fyi], []).length, 0);
  const entries = homeAttentionEntries([fyi], [inbox("fyi", "resolved")]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].reviewStatus, "resolved");
});
