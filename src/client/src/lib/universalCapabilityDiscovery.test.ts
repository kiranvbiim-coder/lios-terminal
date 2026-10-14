import assert from "node:assert/strict";
import test from "node:test";
import type { CapabilityDiscoveryResult } from "@shared/capabilityDiscovery";
import {
  capabilityDiscoveryView,
  fetchUniversalCapabilityDiscovery,
} from "./universalCapabilityDiscovery";

function result(overrides: Partial<CapabilityDiscoveryResult> = {}): CapabilityDiscoveryResult {
  return {
    capabilityId: "python.advanced.valuation.reverse-dcf",
    name: "Reverse DCF Expectations",
    description: "Reverse DCF capability",
    category: "valuation",
    availability: { state: "available" },
    executionTarget: "python_sidecar",
    sourceKind: "internal",
    invocable: true,
    preferredView: "valuation",
    existingSurfaces: ["Valuation", "Quant Lab"],
    score: 100,
    matchedOn: ["name"],
    ...overrides,
  };
}

test("discovered capabilities navigate only to explicitly supported terminal destinations", () => {
  assert.equal(capabilityDiscoveryView(result()), "valuation");
  assert.equal(capabilityDiscoveryView(result({ preferredView: "connectors" })), "connectors");
  assert.equal(capabilityDiscoveryView(result({ preferredView: "not-a-real-view" })), null);
  assert.equal(capabilityDiscoveryView(result({ preferredView: null })), null);
});

test("client discovery validates the server response contract", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    assert.match(url, /\/api\/capabilities\/discover\?/);
    assert.match(url, /surface=command_palette/);
    return new Response(JSON.stringify({
      query: "reverse dcf",
      surface: "command_palette",
      count: 1,
      results: [result()],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const results = await fetchUniversalCapabilityDiscovery("reverse dcf", { limit: 8 });
    assert.equal(results.length, 1);
    assert.equal(results[0].capabilityId, "python.advanced.valuation.reverse-dcf");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("client discovery rejects malformed responses instead of trusting remote metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ results: [{ surprise: true }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

  try {
    await assert.rejects(
      () => fetchUniversalCapabilityDiscovery("bad"),
      /invalid response/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
