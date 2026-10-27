import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { IntelligenceCard } from "@shared/waveDContracts";
import VisualIntelligenceSearch, { VisualIntelligenceResultCard } from "./VisualIntelligenceSearch";

const card: IntelligenceCard = {
  id: "evidence-case", kind: "research", priority: "important", title: "Water source publication",
  whatHappened: "A sourced observation was recorded", whyItMatters: "Potential impact",
  whyItMattersToUser: "Relevant to user's investigation", nextActions: ["ask"],
  createdAt: "2026-10-27T06:00:00Z", score: 62, status: "unread", unread: true,
  evidence: [
    { id: "public", source: "Public document", url: "https://example.org/public-report" },
    { id: "bad", source: "<unsafe>", url: "javascript:alert(1)" },
    { id: "secret", source: "Private URL", url: "https://example.org/doc?api_key=PRIVATE" },
  ],
};

test("visual results expose recorded evidence and source-safe links, not images or preview fetches", () => {
  const html = renderToStaticMarkup(createElement(VisualIntelligenceResultCard, {
    card, disabled: false, onAsk: () => undefined,
  }));
  assert.match(html, /Water source publication/);
  assert.match(html, /Recorded sources \(3\)/);
  assert.match(html, /Ask LiOS/);
  assert.equal((html.match(/href="https:\/\/example.org\/public-report"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /href="javascript:|href="https:\/\/example.org\/doc|PRIVATE|<img\b/);
  assert.match(html, /&lt;unsafe&gt;/);
});

test("unavailable or short queries do not render a synthetic intelligence gallery", () => {
  const html = renderToStaticMarkup(createElement(VisualIntelligenceSearch, {
    query: "x", onAsk: () => true,
  }));
  assert.match(html, /Enter at least 2 characters/);
  assert.doesNotMatch(html, /lios-visual-intelligence-result|href=|fetching/);
});

test("Ask LiOS is a user-triggered action and respects parent denial", () => {
  const html = renderToStaticMarkup(createElement(VisualIntelligenceResultCard, {
    card, disabled: true, onAsk: () => undefined,
  }));
  assert.match(html, /disabled/);
});


test("Search uses existing approved local images without fetching publisher pixels", () => {
  const image = {
    kind: "image" as const,
    assetPath: "/editorial-media/" + "b".repeat(64) + ".webp",
    sha256: "b".repeat(64),
    alt: "Original evidence image cleared for the recorded source",
    attribution: "Original publisher",
    owner: "Rights-granting publisher",
    licenseName: "Licensed reuse",
    licenseEvidenceRef: "license:source:reviewed",
    sourceEvidenceId: "public",
    verifiedBy: "authorized-editor",
    verifiedAt: "2026-10-26T00:00:00Z",
    permission: "commercial_redistribution_and_display" as const,
    offlineBundlingPermitted: true as const,
    state: "approved" as const,
  };
  const permitted = renderToStaticMarkup(createElement(VisualIntelligenceResultCard, {
    card: { ...card, media: image }, disabled: false, onAsk: () => undefined,
  }));
  assert.match(permitted, /licensed-editorial-image/);
  assert.match(permitted, /src="\/editorial-media\/b{64}\.webp"/);
  assert.match(permitted, /Ask LiOS/);
  const unlinked = renderToStaticMarkup(createElement(VisualIntelligenceResultCard, {
    card: { ...card, media: { ...image, sourceEvidenceId: "unrelated" } }, disabled: false, onAsk: () => undefined,
  }));
  assert.doesNotMatch(unlinked, /<img\b/);
  assert.match(unlinked, /Water source publication/);
});


test("Visual Search refreshes exact authorized Pulse on foreground return without keystroke fetches", () => {
  const source = readFileSync(new URL("./VisualIntelligenceSearch.tsx", import.meta.url), "utf8");
  for (const exact of [
    'window.addEventListener("focus", onForegroundChange)',
    'document.addEventListener("visibilitychange", onForegroundChange)',
    'window.removeEventListener("focus", onForegroundChange)',
    'document.removeEventListener("visibilitychange", onForegroundChange)',
    'document.visibilityState === "hidden"',
    'setSnapshot(null)',
    'setForegroundRevision(value => value + 1)',
    '}, [searchReady, foregroundRevision]);',
    'credentials: "same-origin", cache: "no-store"',
    'controller.abort()',
  ]) assert.ok(source.includes(exact), "Missing scoped foreground freshness safeguard: " + exact);
  assert.ok(!source.includes('[searchReady, activeQuery]'), "Do not refetch provider for each keystroke");
  assert.ok(!source.includes('localStorage.setItem('), "No duplicate browser-side intelligence cache");
});

test("A07 search can present exact source results as cards, tabular rows and recorded chronology", () => {
  const source = readFileSync(new URL("./VisualIntelligenceSearch.tsx", import.meta.url), "utf8");
  assert.match(source, /"cards" \| "table" \| "timeline"/);
  assert.match(source, /aria-label="Intelligence results presentation"/);
  assert.match(source, /aria-label="Recorded intelligence table"/);
  assert.match(source, /aria-label="Recorded intelligence chronology"/);
  assert.match(source, /datedResults\.length < found\.results\.length/);
  assert.match(source, /Ordered by the source card's recorded timestamp/);
  assert.ok(source.includes("<time dateTime={at}"), "timeline uses the source recorded time");
  assert.doesNotMatch(source, /syntheticChart|inferredCoordinates|fetch\("https?:/);
});
