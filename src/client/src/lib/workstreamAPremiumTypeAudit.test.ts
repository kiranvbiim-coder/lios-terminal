import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** Check actual Home/Pulse source classes; system-wide font redesign is not claimed. */
test("A01 primary Home and Pulse controls use readable 12px+ labels", () => {
  const paths = [
    "../components/terminal/WaveCExperienceShell.tsx",
    "../components/terminal/FusionPulseBoard.tsx",
  ];
  for (const path of paths) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /text-\[(?:[1-9]|10|11)px\]/);
    assert.match(source, /text-xs/);
  }
});
test("A02 Home removes redundant helper chrome without deleting source actions", () => {
  const shell = readFileSync(new URL("../components/terminal/WaveCExperienceShell.tsx", import.meta.url), "utf8");
  const board = readFileSync(new URL("../components/terminal/FusionPulseBoard.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(shell, /Pulse, Explore, Workbench, Signals and Library — Ask LiOS stays available/);
  assert.doesNotMatch(board, /Markets, macro, monitoring and your active research context in one live surface/);
  assert.match(board, /MarketStateHero/);
  assert.match(board, /pulse-reviewed-continuity/);
  assert.match(shell, /<FusionPulseBoard/);
  assert.match(shell, /setPulseReview\(normalizePulseReviewPresentation/);
});

test("A05/A06 foreground sources abort abandoned HTTP reads and never reuse browser-cached identity", () => {
  const shell = readFileSync(new URL("../components/terminal/WaveCExperienceShell.tsx", import.meta.url), "utf8");
  for (const exact of [
    'const controller = new AbortController()',
    'signal: controller.signal',
    'cache: "no-store"',
    'credentials: "same-origin"',
    'controller.abort()',
    'window.addEventListener("focus", revalidatePulse)',
    'document.addEventListener("visibilitychange", revalidatePulse)',
    'window.removeEventListener("focus", revalidatePulse)',
    'document.removeEventListener("visibilitychange", revalidatePulse)',
    'setPulseRevision(value => value + 1)',
  ]) assert.ok(shell.includes(exact), "missing authorized Pulse revalidation: " + exact);
  assert.doesNotMatch(shell, /setInterval\(/);
});
