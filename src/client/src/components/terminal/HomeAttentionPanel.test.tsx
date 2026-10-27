import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { IntelligenceCard, ActionInboxItem } from "@shared/waveDContracts";
import { homeAttentionEntries } from "@/lib/homeIntelligenceDiscovery";
import { HomeAttentionPanel, HomeIntelligenceCard } from "./HomeAttentionPanel";

const card: IntelligenceCard = {
  id: "news-case", kind: "news", priority: "important",
  title: "Sourced water policy update",
  whatHappened: "The recorded changes relate to water infrastructure.",
  whyItMatters: "Impact assessment required",
  whyItMattersToUser: "Relevant to the recorded project scope",
  nextActions: ["ask"], createdAt: "2026-10-27T02:00:00Z",
  evidence: [
    { id: "safe", source: "Original document", provider: "Issuer", url: "https://example.org/report" },
    { id: "unsafe", source: "Unknown page", url: "javascript:alert(1)" },
    { id: "private", source: "Private query", url: "https://example.org/report?api_key=PRIVATE_SOURCE_TOKEN" },
  ],
  status: "unread", score: 75, unread: true,
};
const inbox: ActionInboxItem = {
  id: "inbox:news-case", sourceCardId: card.id, title: card.title,
  reason: "Recorded event", priority: "important",
  suggestedActions: ["investigate"], createdAt: "2026-10-27T02:00:00Z",
  status: "open", evidence: card.evidence,
};

test("collapsed Home intelligence does not fetch or render an unrelated dashboard on first SSR", () => {
  const html = renderToStaticMarkup(createElement(HomeAttentionPanel));
  assert.match(html, /data-testid="lios-home-attention"/);
  assert.match(html, /Home intelligence/);
  assert.doesNotMatch(html, /data-testid="home-intelligence-discovery"/);
});

test("Home cards show real sources and truthful review actions while excluding unsafe links", () => {
  const [entry] = homeAttentionEntries([card], [inbox]);
  const html = renderToStaticMarkup(createElement(HomeIntelligenceCard, {
    entry, disabled: false, saving: false, onUpdate: () => undefined,
  }));
  assert.match(html, /Sourced water policy update/);
  assert.match(html, /Why this appeared/);
  assert.match(html, /Inspect recorded sources \(3\)/);
  assert.match(html, /https:\/\/example.org\/report/);
  assert.match(html, /Mark reviewed/);
  assert.match(html, /Snooze/);
  assert.match(html, /Awaiting review/);
  assert.equal((html.match(/href="https:\/\/example.org\/report"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /href="javascript:|href="https:\/\/example.org\/report\?api_key/);
  assert.doesNotMatch(html, /PRIVATE_SOURCE_TOKEN|<img\b|favicon\.ico/);
});

test("non-Inbox cards cannot perform fabricated review writes", () => {
  const [entry] = homeAttentionEntries([card], []);
  const html = renderToStaticMarkup(createElement(HomeIntelligenceCard, {
    entry, disabled: false, saving: false, onUpdate: () => undefined,
  }));
  assert.match(html, /For reference/);
  assert.doesNotMatch(html, /Mark reviewed|Snooze|Reopen for review/);
});

test("read-only statuses are differentiated and actions respect the server state", () => {
  const [entry] = homeAttentionEntries([card], [{ ...inbox, status: "snoozed" }]);
  const html = renderToStaticMarkup(createElement(HomeIntelligenceCard, {
    entry, disabled: true, saving: false, onUpdate: () => undefined,
  }));
  assert.match(html, /Snoozed/);
  assert.match(html, /Reopen for review/);
  assert.doesNotMatch(html, /Mark reviewed/);
  assert.match(html, /disabled/);
});
