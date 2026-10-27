import test from "node:test";
import assert from "node:assert/strict";
import { pulseStoryQuestion, pulseStoryTimestamp, safePulseSourceUrl, type PulseStoryView } from "./pulseStoryPresentation";

test("only ordinary external web schemes are navigable as citations", () => {
  assert.equal(safePulseSourceUrl("javascript:alert(1)"), null);
  assert.equal(safePulseSourceUrl("data:text/html,evil"), null);
  assert.equal(safePulseSourceUrl("file:///etc/passwd"), null);
  assert.equal(safePulseSourceUrl("https://user:secret@example.com/report"), null);
  assert.equal(safePulseSourceUrl("not a url"), null);
  assert.equal(safePulseSourceUrl(undefined), null);
  assert.equal(safePulseSourceUrl("https://example.com/report?id=2"), "https://example.com/report?id=2");
});

test("dates are preserved only when valid; source-free market cards are supported", () => {
  assert.equal(pulseStoryTimestamp("2026-10-27T02:00:00Z"), "2026-10-27T02:00:00.000Z");
  assert.equal(pulseStoryTimestamp("bad-date"), null);
  assert.equal(pulseStoryTimestamp(undefined), null);
  const derived: PulseStoryView = {
    id: "market-move-ABC", title: "ABC moved", whatHappened: "Market basket change",
    priority: "important", score: 68, symbol: "ABC",
  };
  assert.match(pulseStoryQuestion(derived), /ABC moved/);
  assert.match(pulseStoryQuestion(derived), /Verify its claims/);
  assert.equal(derived.evidence, undefined);
});

test("very long untrusted headlines cannot create unbounded generated prompts", () => {
  const card: PulseStoryView = {
    id: "news-1", title: "A".repeat(5000), whatHappened: "Brief",
    priority: "fyi", score: 7,
  };
  assert.ok(pulseStoryQuestion(card).length < 500);
});


test("Pulse presentation keeps Wave D evidence, source inspection and Chat handoff connected", async () => {
  const { readFileSync } = await import("node:fs");
  const shell = readFileSync(new URL("../components/terminal/WaveCExperienceShell.tsx", import.meta.url), "utf8");
  const board = readFileSync(new URL("../components/terminal/FusionPulseBoard.tsx", import.meta.url), "utf8");
  const story = readFileSync(new URL("../components/terminal/LiosPulseStoryCard.tsx", import.meta.url), "utf8");

  assert.match(shell, /useState<IntelligenceCard\[\]>/);
  assert.match(shell, /cards\?: IntelligenceCard\[\]/);
  assert.match(board, /LiosPulseStoryCard/);
  assert.match(board, /onAskLios\(question\)/);
  assert.match(story, /aria-expanded=\{expanded\}/);
  assert.match(story, /safePulseSourceUrl\(source.url\)/);
  assert.match(story, /role="region"/);
  assert.match(story, /reducedMotion|reduceMotion/);
  assert.doesNotMatch(story, /assets\.watermelon\.sh|Neon Nights Festival/);
});
