import assert from "node:assert/strict";
import { filterPulseCards } from "./waveDAdvancedContracts";
import { rankPulseCards } from "./waveDContracts";
import test from "node:test";
import {
  effectivePulseFollowingSubjects, normalizePulseSubjectKey, normalizePulseSubjectPreferences,
  suppressMutedPulseCards, updatePulseSubjectPreferences,
} from "./pulseSubjectPreferences";

test("Follow/Mute key identity is bounded and canonical without guessing aliases", () => {
  assert.equal(normalizePulseSubjectKey("  btc:spot "), "BTC:SPOT");
  assert.equal(normalizePulseSubjectKey("solar energy"), "SOLAR ENERGY");
  assert.equal(normalizePulseSubjectKey("https://example.org/?token=secret"), null);
  assert.equal(normalizePulseSubjectKey("line\nnew"), null);
  assert.equal(normalizePulseSubjectKey("a".repeat(161)), null);
  assert.equal(normalizePulseSubjectKey(null), null);
  assert.equal(normalizePulseSubjectKey(" "), null);
});

test("Mute takes precedence over Follow; Clear removes exactly one subject", () => {
  const start = { followed: [], muted: [] };
  const followed = updatePulseSubjectPreferences(start, "solar", "follow");
  assert.deepEqual(followed, { followed: ["SOLAR"], muted: [] });
  const muted = updatePulseSubjectPreferences(followed, "solar", "mute");
  assert.deepEqual(muted, { followed: [], muted: ["SOLAR"] });
  const restored = updatePulseSubjectPreferences(muted, "solar", "clear");
  assert.deepEqual(restored, start);
  assert.deepEqual(start, { followed: [], muted: [] }, "a caller-owned object is never mutated");
  assert.deepEqual(updatePulseSubjectPreferences(followed, "SOLAR", "follow"), followed);
  assert.throws(() => updatePulseSubjectPreferences(start, "unknown", "hack" as never), /Unsupported/);
});

test("Corrupt legacy preferences, duplicate keys and mutually contradictory saved state normalize", () => {
  assert.deepEqual(normalizePulseSubjectPreferences(null), { followed: [], muted: [] });
  assert.deepEqual(normalizePulseSubjectPreferences({ followed: ["ABC", "abc", 11, null, "water"], muted: ["Abc", ""] }), {
    followed: ["WATER"], muted: ["ABC"],
  });
  assert.deepEqual(normalizePulseSubjectPreferences({ followed: "wrong", muted: {} }), { followed: [], muted: [] });
});

test("Following uses existing watchlist plus explicit subjects, but cannot resurrect muted keys", () => {
  const prefs = { followed: ["COPPER", "AAPL"], muted: ["AAPL", "GOLD"] };
  assert.deepEqual(effectivePulseFollowingSubjects(prefs, ["aapl", "silver", "silver", "gold"]), ["SILVER", "COPPER"]);
  const source = [
    { subjectKey: "AAPL", symbol: "AAPL", title: "Muted" },
    { subjectKey: "COPPER", symbol: "COPPER", title: "Followed" },
    { subjectKey: undefined, symbol: "AAPL", title: "Fallback identity still muted" },
    { subjectKey: undefined, symbol: undefined, title: "Unclassified" },
  ] as Array<{subjectKey?: string; symbol?: string; title: string}>;
  assert.deepEqual(suppressMutedPulseCards(source, prefs).map(item => item.title), ["Followed", "Unclassified"]);
  assert.equal(source.length, 4, "the source list and canonical inbox remain unaffected");
});

test("Maximum 60 subjects per preference list; no unbounded saved personalization document", () => {
  let prefs = { followed: [] as string[], muted: [] as string[] };
  for (let i = 0; i < 60; i++) prefs = updatePulseSubjectPreferences(prefs, "SUBJECT" + i, "follow");
  assert.equal(prefs.followed.length, 60);
  assert.throws(() => updatePulseSubjectPreferences(prefs, "ANOTHER", "follow"), /limit/);
  assert.equal(updatePulseSubjectPreferences(prefs, "SUBJECT0", "follow").followed.length, 60);
  assert.equal(updatePulseSubjectPreferences(prefs, "SUBJECT0", "clear").followed.length, 59);
  assert.equal(normalizePulseSubjectPreferences({followed: Array.from({length:100},(_,i)=>"TOPIC"+i), muted:[]}).followed.length,60);
});

test("Following displays a backed symbol-only card that was explicitly selected, not only subjectKey cards", () => {
  const cards = rankPulseCards([{
    id: "source-only-solar", kind: "news", title: "Sourced solar filing",
    whatHappened: "Original observation", whyItMatters: "Investigation pending",
    whyItMattersToUser: "Review the recorded source", nextActions: ["analyse"],
    createdAt: "2026-10-27T09:00:00Z", symbol: "SOLAR",
    evidence: [{ id: "solar:source", source: "Original retained source" }],
  }], new Date("2026-10-27T10:00:00Z"));
  assert.deepEqual(filterPulseCards(cards, { channel: "following", subjectKeys: ["SOLAR"] }).map(card => card.id), ["source-only-solar"]);
  assert.deepEqual(filterPulseCards(cards, { channel: "following", subjectKeys: ["WIND"] }), []);
  const muted = suppressMutedPulseCards(cards, { followed: [], muted: ["SOLAR"] });
  assert.deepEqual(filterPulseCards(muted, { channel: "following", subjectKeys: ["SOLAR"] }), []);
});
