import assert from "node:assert/strict";
import test from "node:test";
import type { SourceConnection } from "@shared/schema";
import {
  captureMcpAgentEvidence, isMcpEvidenceCurrent,
  renderMcpAgentReviewEvidence, mcpEvidencePolicyFingerprint, mcpEvidenceMatchesSelectedRefs,
} from "./mcpAgentEvidence";

function connection(
  overrides: Partial<SourceConnection> = {},
  config: Record<string, string | number | boolean | null> = {},
): SourceConnection {
  return {
    id: 41, userId: 7, organizationId: 9, connectorId: "mcp",
    sourceType: "mcp", name: "test", status: "configured", statusDetail: null,
    credentialRef: null, lastTestedAt: null, lastHealthyAt: null,
    createdAt: new Date("2026-10-23T00:00:00Z"),
    updatedAt: new Date("2026-10-23T00:00:00Z"),
    config: { endpoint: "https://8.8.8.8/mcp", projectId: 77, aiTransmission: "allow", aiUsageRights: "cleared", ...config },
    ...overrides,
  } as SourceConnection;
}
const output = { isError: false, content: [{ type: "text", text: "AAPL price 127 (source supplied, unverified)" }] };

test("MCP evidence is never released on tool approval alone or missing source-rights declaration", () => {
  for (const field of ["aiTransmission", "aiUsageRights"]) {
    const config = { [field]: null };
    assert.equal(captureMcpAgentEvidence(connection({}, config), 77, "quotes.read", output), null);
  }
  assert.equal(captureMcpAgentEvidence(connection({}, { aiTransmission: "deny" }), 77, "quotes.read", output), null);
  assert.equal(captureMcpAgentEvidence(connection(), 88, "quotes.read", output), null);
  assert.equal(captureMcpAgentEvidence(connection({ status: "invalid" }), 77, "quotes.read", output), null);
});

test("MCP evidence accepts only one bounded plain-text observation, dropping secrets and instruction payloads as untrusted data", () => {
  assert.equal(captureMcpAgentEvidence(connection(), 77, "quotes.read", { ...output, isError: true }), null);
  assert.equal(captureMcpAgentEvidence(connection(), 77, "quotes.read", { content: [{ type: "image", data: "..." }] }), null);
  assert.equal(captureMcpAgentEvidence(connection(), 77, "quotes.read", { content: [] }), null);
  assert.equal(captureMcpAgentEvidence(connection(), 77, "quotes.read", { content: [{ type: "text", text: "a".repeat(4100) }] }), null);
  assert.equal(captureMcpAgentEvidence(connection(), 77, "quotes.read", { content: [{ type: "text", text: "api_key=ABCDEF12345" }] }), null);

  const capture = captureMcpAgentEvidence(connection(), 77, "quotes.read", output);
  assert.ok(capture);
  assert.equal(capture.connectionId, 41);
  assert.match(capture.contentHash, /^[a-f0-9]{64}$/);
  const admission = renderMcpAgentReviewEvidence([capture]);
  assert.ok(admission);
  assert.match(admission.text, /BEGIN_UNTRUSTED_MCP_EVIDENCE/);
  assert.match(admission.text, /owner_declared_ai_usage_rights/);
  assert.match(admission.text, /AAPL price 127/);
  assert.deepEqual(admission.sourceRefs, ["mcp-server:source:41", "mcp-tool:quotes.read"]);
  assert.equal(admission.text.includes("https://8.8.8.8"), false, "source endpoint/credential refs never reach model");
});

test("MCP evidence snapshots fail closed after a change of source owner, Project, rights, endpoint, generation or credentialRef", () => {
  const original = connection();
  const capture = captureMcpAgentEvidence(original, 77, "quotes.read", output);
  assert.ok(capture);
  assert.match(mcpEvidencePolicyFingerprint(original), /^[a-f0-9]{64}$/);
  assert.equal(isMcpEvidenceCurrent(capture, original, 7, 9, 77), true);
  assert.equal(isMcpEvidenceCurrent(capture, undefined, 7, 9, 77), false);
  assert.equal(isMcpEvidenceCurrent(capture, original, 7, 9, 88), false);
  assert.equal(isMcpEvidenceCurrent(capture, original, 7, 10, 77), false);
  assert.equal(isMcpEvidenceCurrent(capture, connection({ userId: 88 }), 7, 9, 77), false);
  assert.equal(isMcpEvidenceCurrent(capture, connection({ status: "invalid" }), 7, 9, 77), false);
  assert.equal(isMcpEvidenceCurrent(capture, connection({ updatedAt: new Date("2026-10-23T00:00:01Z") }), 7, 9, 77), false);
  assert.equal(isMcpEvidenceCurrent(capture, connection({}, { aiTransmission: "deny" }), 7, 9, 77), false);
  assert.equal(isMcpEvidenceCurrent(capture, connection({}, { endpoint: "https://9.9.9.9/mcp" }), 7, 9, 77), false);
  assert.equal(isMcpEvidenceCurrent(capture, connection({ credentialRef: "vault:rotated" }), 7, 9, 77), false);
});

test("MCP evidence review deduplicates captures and cannot exceed cumulative source-reference budget", () => {
  const base = captureMcpAgentEvidence(connection(), 77, "quotes.read", output);
  assert.ok(base);
  const accepted = renderMcpAgentReviewEvidence([base, base, base, base]);
  assert.ok(accepted);
  assert.equal(accepted.included.length, 1);
  assert.equal(accepted.sourceRefs.length, 2);
  assert.ok(accepted.text.includes(base.contentHash));
  assert.equal(renderMcpAgentReviewEvidence([base], new Set(Array.from({ length: 100 }, (_, i) => `prior:${i}`))), null);
  assert.equal(renderMcpAgentReviewEvidence([]), null);
});

test("MCP evidence obeys active Research Artifact only_refs and remains unavailable by default", () => {
  const capture = captureMcpAgentEvidence(connection(), 77, "quotes.read", output);
  assert.ok(capture);
  assert.equal(mcpEvidenceMatchesSelectedRefs(capture, null), true);
  assert.equal(mcpEvidenceMatchesSelectedRefs(capture, new Set()), false);
  assert.equal(mcpEvidenceMatchesSelectedRefs(capture, new Set(["unrelated-source"])), false);
  assert.equal(mcpEvidenceMatchesSelectedRefs(capture, new Set(["mcp-server:source:41"])), true);
});
