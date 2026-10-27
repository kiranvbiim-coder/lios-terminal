import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("A3 has one tenant-owned Wave D preference owner and explicit mutation boundary", () => {
  const store = source("../../../server/waveDStateStore.ts");
  const routes = source("../../../server/waveDRoutes.ts");
  assert.match(store, /pulseSubjects: normalizePulseSubjectPreferences\(value\.pulseSubjects\)/);
  assert.match(store, /pulseSubjects: PulseSubjectPreferences/);
  assert.match(store, /withUserTransaction/);
  assert.match(routes, /app\.post\("\/api\/wave-d\/pulse\/preferences", requireWaveDRetailRead/);
  assert.match(routes, /card = currentPulse\.cards\.find\(item => item\.id === change\.cardId\)/);
  assert.match(routes, /pulseSubjects: updatePulseSubjectPreferences\(state\.pulseSubjects, subject, change\.action\)/);
  assert.match(routes, /app\.get\("\/api\/wave-d\/pulse\/preferences", requireWaveDRetailRead/);
  assert.doesNotMatch(routes, /localStorage|setTimeout\(/);
});

test("Following query restriction and Mute cannot be bypassed by raw query subjects", () => {
  const routes = source("../../../server/waveDRoutes.ts");
  const board = source("../components/terminal/FusionPulseBoard.tsx");
  assert.match(routes, /permittedFollowing = effectivePulseFollowingSubjects\(preferences/);
  assert.match(routes, /permittedFollowing\.filter\(key => requestedFilter\.subjectKeys/);
  assert.match(routes, /filterPulseCards\(suppressMutedPulseCards\(result\.cards, preferences\), filter\)/);
  assert.match(routes, /buildPulseBrief\(mode, suppressMutedPulseCards\(result\.cards/);
  assert.match(board, /const visiblePulseCards = groupedPulseCards;/);
  assert.doesNotMatch(board, /derivedPulseCards|visiblePulseCards = pulseCards\.length/);
});

test("Existing card retains same Chat/evidence owner and accessible Follow/Mute controls", () => {
  const card = source("../components/terminal/LiosPulseStoryCard.tsx");
  const board = source("../components/terminal/FusionPulseBoard.tsx");
  const shell = source("../components/terminal/WaveCExperienceShell.tsx");
  assert.match(card, /aria-label=\{\x60\$\{followed \? "Unfollow" : "Follow"\}/);
  assert.match(card, /onPreferenceChange\(card\.id, followed \? "clear" : "follow"\)/);
  assert.match(card, /onPreferenceChange\(card\.id, "mute"\)/);
  assert.match(card, /onAsk\(pulseStoryQuestion\(card\)\)/);
  assert.match(board, /aria-label=\{\x60Unmute \$\{subject\}\x60\}/);
  assert.match(board, /pulsePreferences\.muted\.map\(subject/);
  assert.match(shell, /fetch\("\/api\/wave-d\/pulse\/preferences"/);
  assert.match(shell, /saved\.persisted !== true/);
  assert.match(shell, /setPulseRevision\(value => value \+ 1\)/);
  assert.match(board, /role="alert"/);
  assert.doesNotMatch(shell, /localStorage\.setItem\([^\n]*pulsePreferences/);
});
