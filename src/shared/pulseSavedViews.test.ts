import test from "node:test";
import assert from "node:assert/strict";
import { MAX_PULSE_SAVED_VIEWS, normalizePulseSavedViews, removePulseDiscoveryView, savePulseDiscoveryView } from "./pulseSavedViews";
const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
const at = new Date("2026-10-27T10:00:00.000Z");
test("A05 saves only bounded, source-free, user-scoped discovery filters", () => {
  const view = savePulseDiscoveryView([], { name: " Energy monitoring ", channel: "following", subjectKey: "power:sector" },
    ["POWER:SECTOR"], a, at);
  assert.deepEqual(view, [{ id: a, name: "Energy monitoring", channel: "following",
    subjectKey: "POWER:SECTOR", createdAt: at.toISOString() }]);
  assert.deepEqual(normalizePulseSavedViews(view), view);
  assert.deepEqual(removePulseDiscoveryView(view, a), []);
  assert.doesNotMatch(JSON.stringify(view), /https?:|article|api_key|token|headline/);
});
test("A05 refuses forged followed subjects, untrusted records and over-limit writes", () => {
  assert.throws(() => savePulseDiscoveryView([], { name: "X", channel: "research", subjectKey: "PRIVATE" }, [], a, at));
  assert.throws(() => savePulseDiscoveryView([], { name: "X", channel: "untrusted" as never, subjectKey: null }, [], a, at));
  assert.throws(() => savePulseDiscoveryView([], { name: "X", channel: "markets", subjectKey: null }, [], "bad", at));
  assert.deepEqual(normalizePulseSavedViews([{ id: a, name: "X", channel: "research", subjectKey: null,
    createdAt: "2026-10-27T10:00:00Z", secret: "must-not-survive" }, { id: a, name: "duplicate", channel: "research",
    subjectKey: null, createdAt: "2026-10-27T10:00:00Z" }]).length, 1);
  const many = Array.from({length: MAX_PULSE_SAVED_VIEWS}, (_, i) => ({
    id: String(i+1).padStart(8,"0")+"-1111-4111-8111-111111111111",
    name: "View "+i, channel: "research" as const, subjectKey: null, createdAt: at.toISOString(),
  }));
  assert.throws(() => savePulseDiscoveryView(many, { name: "Excess", channel: "markets", subjectKey: null }, [], b, at), /limit/);
  assert.throws(() => removePulseDiscoveryView([], a), /not found/);
});
