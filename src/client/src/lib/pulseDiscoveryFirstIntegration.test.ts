import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const board = readFileSync(new URL("../components/terminal/FusionPulseBoard.tsx", import.meta.url), "utf8");
const story = readFileSync(new URL("../components/terminal/LiosPulseStoryCard.tsx", import.meta.url), "utf8");

test("A01/A02 real Pulse shows source-backed discovery BEFORE the optional finance analytics", () => {
  const discovery = board.indexOf('data-testid="lios-pulse-discovery-stories"');
  const cards = board.indexOf("<LiosPulseStoryCard");
  const market = board.indexOf("<MarketStateHero");
  assert.ok(discovery > 0 && cards > discovery && market > cards, "source stories lead the market-first layout");
  assert.match(board, /clusterRecordedPulseStories\(pulseCards, 24\)/);
  assert.match(board, /channel=\{pulseChannel\}/);
  assert.match(board, /showMarketDesk = marketDeskOverride\?\.channel === pulseChannel/);
  assert.match(board, /pulseChannel === "markets"/);
  assert.match(board, /aria-expanded=\{showMarketDesk\} aria-controls=\{marketDeskId\}/);
  assert.match(board, /\{showMarketDesk && <div id=\{marketDeskId\}/);
  assert.equal((board.match(/<MarketStateHero/g) ?? []).length, 1, "never duplicate the market renderer");
  assert.equal((board.match(/<FusionSection title="Your recorded intelligence"/g) ?? []).length, 1);
});

test("A01 leading disclosure is readable and real actions remain wired", () => {
  assert.match(board, /INTELLIGENCE DISCOVERY/);
  assert.match(board, /font-ui text-sm font-semibold tracking-wide/);
  assert.doesNotMatch(board, /text-\[(?:[5-9])px\]/);
  assert.match(board, /onPulseRetry/);
  assert.match(board, /onPulsePreferenceClear\(subject\)/);
  assert.match(board, /onPulsePreferenceChange\}/);
  assert.match(board, /<PulseDiscoveryTabs channel=\{pulseChannel\}/);
  assert.match(story, /aria-label="Why this story appears"/);
  assert.match(story, /explainPulsePlacement\(card, channel, followed\)/);
  assert.match(story, /pulseStoryQuestion\(card\)/);
  assert.match(story, /eligibleEditorialMedia/);
  assert.match(story, /safePulseSourceUrl/);
});
