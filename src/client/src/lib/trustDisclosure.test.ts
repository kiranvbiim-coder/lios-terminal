import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TrustManifest } from "@shared/trustContracts";
import ConversationTrustPanel from "@/components/terminal/ConversationTrustPanel";
import BoundedAgentComposerControl from "@/components/terminal/BoundedAgentComposerControl";
import { projectTrustDisclosure } from "./trustDisclosure";

function manifest(overrides: Partial<TrustManifest> = {}): TrustManifest {
  return {
    summary: {
      sourceCount: 2, freshness: "current", quality: "high", confidence: "high",
      conflictState: "none", evidenceCoveragePct: 80, receiptCount: 1, missingCount: 0,
    },
    warnings: [],
    evidence: [],
    missing: [],
    methodology: [],
    claims: [],
    conflicts: [],
    assumptions: [],
    ...overrides,
  } as TrustManifest;
}

test("WS-60 ordinary source summary remains short with details closed", () => {
  const value = manifest();
  const projected = projectTrustDisclosure(value);
  assert.equal(projected.summary, "2 recorded sources · current evidence");
  assert.deepEqual(projected.visibleLimitations, []);
  const html = renderToStaticMarkup(React.createElement(ConversationTrustPanel, { manifest: value }));
  assert.match(html, /data-testid="trust-quiet-summary"/);
  assert.match(html, /2 recorded sources/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /Show work/);
  assert.doesNotMatch(html, /Recorded quality:/);
  assert.doesNotMatch(html, /Quality high/);
});

test("WS-60 missing sources, conflicts, unsupported claims and restrictions are never only in Show work", () => {
  const value = manifest({
    summary: {
      sourceCount: 0, freshness: "unknown", quality: "low", confidence: "unknown",
      conflictState: "material", evidenceCoveragePct: 0, receiptCount: 0, missingCount: 1,
    },
    claims: [{ status: "unsupported" }],
    evidence: [{ access: { entitlementRequired: true } }],
  } as Partial<TrustManifest>);
  const projected = projectTrustDisclosure(value);
  assert.match(projected.visibleLimitations.join(" "), /require additional access or entitlement/);
  assert.match(projected.visibleLimitations.join(" "), /lack support/);
  assert.ok(projected.additionalLimitationCount > 0);
  const html = renderToStaticMarkup(React.createElement(ConversationTrustPanel, { manifest: value }));
  assert.match(html, /trust-visible-limitations/);
  assert.match(html, /require additional access or entitlement/);
  assert.match(html, /more source limitations in Show work/);
});

test("WS-60 explicit provider warning and AI-generated provenance remain visible", () => {
  const value = manifest({
    summary: {
      sourceCount: 1, freshness: "ai_generated", quality: "medium", confidence: "medium",
      conflictState: "not_evaluated_single_source", evidenceCoveragePct: 40, receiptCount: 0, missingCount: 0,
    },
    warnings: ["AI source is not an independently verified filing."],
  });
  const projected = projectTrustDisclosure(value);
  assert.match(projected.summary, /AI-generated evidence/);
  assert.equal(projected.visibleLimitations[0], "AI source is not an independently verified filing.");
  assert.match(projected.visibleLimitations.join(" "), /not independently observed source data/);
  assert.match(projected.visibleLimitations.join(" "), /agreement has not been checked/);
});

test("WS-60 warning lists are bounded but cannot silently disappear", () => {
  const warnings = Array.from({ length: 30 }, (_, n) => `Recorded warning ${n + 1}`);
  const projection = projectTrustDisclosure(manifest({ warnings }));
  assert.equal(projection.visibleLimitations.length, 5);
  assert.equal(projection.additionalLimitationCount, 25);
  assert.equal(projection.visibleLimitations[0], warnings[0]);
  assert.equal(projection.visibleLimitations[4], warnings[4]);
});

test("WS-60 composer stays quiet until the multi-step agent is selected", () => {
  const agent = {
    supported: true, enabled: false, selected: false, ready: true,
    checking: false, guidance: "Plans and executes bounded steps. Consequential tools still require your review.",
    setSelected: (_selected: boolean) => undefined,
  };
  const props = { agent, busy: false, onConfigureAI: () => undefined };
  const quiet = renderToStaticMarkup(React.createElement(BoundedAgentComposerControl, props));
  assert.match(quiet, /Multi-step agent/);
  assert.doesNotMatch(quiet, /Plans and executes bounded steps/);
  assert.doesNotMatch(quiet, /Configure AI/);
  const selected = renderToStaticMarkup(React.createElement(BoundedAgentComposerControl, {
    ...props, agent: { ...agent, selected: true, enabled: true, ready: false, guidance: "Configure a connected AI provider and model." },
  }));
  assert.match(selected, /Configure AI/);
  assert.match(selected, /Configure a connected AI provider and model/);
  const unsupported = renderToStaticMarkup(React.createElement(BoundedAgentComposerControl, {
    ...props, agent: { ...agent, supported: false, guidance: "Multi-step agents require a saved chat." },
  }));
  assert.match(unsupported, /Multi-step agents require a saved chat/);
});
