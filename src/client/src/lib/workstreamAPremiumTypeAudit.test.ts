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

test("A05 server-scoped saved view journey uses existing Wave D state, not browser cache", () => {
  const shell = readFileSync(new URL("../components/terminal/WaveCExperienceShell.tsx", import.meta.url), "utf8");
  const board = readFileSync(new URL("../components/terminal/FusionPulseBoard.tsx", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../../../server/waveDRoutes.ts", import.meta.url), "utf8");
  for(const part of [
    'normalizePulseSavedViews(pulse.savedViews)',
    '/api/wave-d/pulse/views',
    'encodeURIComponent(activeSavedSubject)',
    'onActivatePulseView={activateSavedView}',
    'onPulseChannelChange={(next) => { setPulseChannel(next); setActiveSavedSubject(null); }}',
  ]) assert.ok(shell.includes(part), "missing save/restore source boundary: " + part);
  assert.match(board, /pulse-saved-discovery-views/);
  assert.match(board, /Save view/);
  assert.match(board, /onActivatePulseView\(view\)/);
  assert.match(routes, /savePulseDiscoveryView/);
  assert.match(routes, /removePulseDiscoveryView/);
  assert.doesNotMatch(shell, /localStorage\.setItem\([^\n]*pulseSavedViews/);
});

test("A05 failed saved-view writes retain draft names and confirmed writes avoid redundant provider reads", () => {
  const shell = readFileSync(new URL("../components/terminal/WaveCExperienceShell.tsx", import.meta.url), "utf8");
  const board = readFileSync(new URL("../components/terminal/FusionPulseBoard.tsx", import.meta.url), "utf8");
  assert.ok(shell.includes('setPulseSavedViews(normalizePulseSavedViews(payload.savedViews))'));
  assert.ok(shell.includes('return false;'));
  assert.match(shell, /do not call market\/news providers again/);
  assert.ok(board.includes('if (saved) setViewName("")'));
  // The name can clear only after the server-confirmed success branch.
  assert.ok(board.includes('void onSavePulseView(label.slice(0, 60)).then(saved => {'));
  assert.ok(board.includes('if (saved) setViewName("")'));
  assert.ok(!board.includes('onSavePulseView(label.slice(0, 60)); setViewName("")'));
});

test("A05 saved view names remain available through user-scoped reads when upstream Pulse fails", () => {
  const shell = readFileSync(new URL("../components/terminal/WaveCExperienceShell.tsx", import.meta.url), "utf8");
  const board = readFileSync(new URL("../components/terminal/FusionPulseBoard.tsx", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../../../server/waveDRoutes.ts", import.meta.url), "utf8");
  assert.ok(routes.includes('app.get("/api/wave-d/pulse/views", requireWaveDRetailRead'));
  assert.ok(routes.includes('await getWaveDState(waveUser(req))'));
  assert.ok(routes.includes('res.setHeader("Cache-Control", "no-store")'));
  assert.ok(shell.includes('void loadOwnedSavedViews()'));
  assert.ok(shell.includes('A previously selected subject is no longer followed.'));
  assert.ok(shell.includes('setPulsePreferences(EMPTY_PULSE_SUBJECT_PREFERENCES)'));
  assert.ok(board.includes('onDeletePulseView(view.id)} disabled={savedViewPending}'));
});
