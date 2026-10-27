import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { nextPulseChannel, PulseDiscoveryTabs, PULSE_DISCOVERY_CHANNELS } from "./PulseDiscoveryTabs";

test("beUI-adapted Pulse discovery control renders all real channels as readable reachable buttons", () => {
  const html = renderToStaticMarkup(React.createElement(PulseDiscoveryTabs, {
    channel: "research", onChange: () => {},
  }));
  assert.match(html, /role="group" aria-label="Pulse discovery channels"/);
  assert.equal((html.match(/data-pulse-channel=/g) ?? []).length, 4);
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.equal((html.match(/aria-pressed="false"/g) ?? []).length, 3);
  assert.match(html, /data-pulse-channel="research"[^>]*aria-pressed="true"/);
  assert.match(html, /For You/);
  assert.match(html, /Following/);
  assert.match(html, /Markets/);
  assert.match(html, /Research/);
  assert.match(html, /min-h-11/);
  assert.doesNotMatch(html, /<img|remote|sample-data/i);
});

test("four channels use logical arrow/Home/End keys with wraparound and RTL reversal", () => {
  assert.deepEqual(PULSE_DISCOVERY_CHANNELS.map(item => item.id), ["for_you", "following", "markets", "research"]);
  assert.equal(nextPulseChannel("for_you", "ArrowLeft"), "research");
  assert.equal(nextPulseChannel("research", "ArrowRight"), "for_you");
  assert.equal(nextPulseChannel("for_you", "ArrowRight"), "following");
  assert.equal(nextPulseChannel("for_you", "ArrowLeft", true), "following");
  assert.equal(nextPulseChannel("following", "Home"), "for_you");
  assert.equal(nextPulseChannel("following", "End"), "research");
  assert.equal(nextPulseChannel("markets", "Enter"), null);
});
