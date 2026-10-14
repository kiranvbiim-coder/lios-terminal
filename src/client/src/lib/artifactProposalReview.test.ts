import test from "node:test";
import assert from "node:assert/strict";
import { artifactContentSchema, type ArtifactContent } from "@shared/artifactContracts";
import { proposalValuePreview, reviewArtifactProposal } from "./artifactProposalReview";
import type { ProjectArtifactProposalRecord, ProjectArtifactVersionRecord } from "./useArtifacts";

function saved(content: ArtifactContent): ProjectArtifactVersionRecord {
  return { id: "immutable-version", artifactId: "owned-artifact", version: 3, parentVersionId: "previous", adapterId: "lios.native", content, contentHash: "a".repeat(64), sourceRefs: ["source:immutable"], dependencyRefs: ["capture:original"], executionReceiptIds: [], assumptionRefs: [], trustManifest: null, refreshSpec: null, note: null, createdByUserId: 1, createdAt: "2026-10-08T00:00:00Z" };
}
function proposal(patch: Record<string, unknown>, changes: Partial<ProjectArtifactProposalRecord> = {}): ProjectArtifactProposalRecord {
  return { id: "proposal", artifactId: "owned-artifact", baseVersion: 3, proposalType: "artifact_patch", status: "pending", summary: "Requested maintenance", diffs: [], patch, proposedContentHash: "b".repeat(64), createdAt: "2026-10-08T00:00:00Z", decidedAt: null, ...changes };
}

test("review shows actual document paths and exact literal strings while keeping immutable source/capture content", () => {
  const base = saved(artifactContentSchema.parse({ kind: "report", blocks: [{ id: "text", type: "paragraph", text: "Original text", attrs: { sourceRef: "source:immutable", capturedAt: "2026-10-07T12:00:00Z", exact: "9007199254740993.1234567890123456789" } }] }));
  const original = structuredClone(base);
  if (base.content.kind !== "report") throw new Error("Wrong fixture kind");
  const text = '<script>alert("literal only")</script> & **not markdown**';
  const review = reviewArtifactProposal(proposal({ blocks: [{ ...base.content.blocks[0], text }] }), base, 3);
  assert.equal(review.canAccept, true);
  assert.deepEqual(review.topLevelKeys, ["blocks"]);
  assert.deepEqual(review.changes.map(change => [change.path, change.before, change.after]), [["/blocks/0/text", "Original text", text]]);
  assert.equal(review.content?.kind, "report");
  if (review.content?.kind !== "report") throw new Error("Missing complete document preview");
  assert.deepEqual(review.content.blocks[0].attrs, base.content.blocks[0].attrs);
  assert.equal(review.content.blocks[0].text, text);
  assert.equal(proposalValuePreview(text).text, JSON.stringify(text));
  assert.deepEqual(base, original);
});

test("bounded path/value excerpts never discard complete canonical content or hidden provenance changes", () => {
  const base = saved(artifactContentSchema.parse({ kind: "research", blocks: [], claims: [{ id: "claim", text: "Claim", provenance: "unknown" }] }));
  const largeText = "Literal long text <b>".repeat(150);
  const review = reviewArtifactProposal(proposal({
    blocks: Array.from({ length: 60 }, (_, index) => ({ id: `block-${index}`, type: "paragraph", text: index === 59 ? largeText : `Text ${index}`, attrs: {} })),
    claims: [{ id: "claim", text: "Claim", provenance: "explicit_inference", sourceRefs: ["source:immutable"] }],
  }), base, 3);
  assert.ok(review.changeCount > review.changes.length);
  assert.equal(review.changes.length, 50);
  assert.deepEqual(review.provenanceChanges.map(change => [change.path, change.before, change.after]), [["/claims/0/provenance", "unknown", "explicit_inference"]]);
  assert.equal(review.provenanceChangeCount, 1);
  assert.equal(proposalValuePreview(largeText).truncated, true);
  assert.ok(proposalValuePreview(largeText).text.length < largeText.length);
  if (review.content?.kind !== "research") throw new Error("Missing complete research preview");
  assert.equal(review.content.blocks.length, 60);
  assert.equal(review.content.blocks[59].text, largeText);
  assert.equal(review.content.claims[0].provenance, "explicit_inference");
});

test("generic patches replace fields shallowly, preserve kind, and fail closed on invalid canonical content", () => {
  const base = saved(artifactContentSchema.parse({ kind: "screen", view: "Original", state: { removed: true, exact: "0.000000000000000000000001" } }));
  const review = reviewArtifactProposal(proposal({ kind: "chart", state: { kept: "=SUM(A1:A2)" } }), base, 3);
  assert.deepEqual(review.content, { ...base.content, state: { kept: "=SUM(A1:A2)" } });
  assert.ok(review.changes.some(change => change.path === "/state/removed" && change.after === undefined));
  assert.ok(review.changes.some(change => change.path === "/state/kept" && change.after === "=SUM(A1:A2)"));
  const invalid = reviewArtifactProposal(proposal({ unsupported: true }), base, 3);
  assert.equal(invalid.content, null);
  assert.equal(invalid.canAccept, false);
  assert.ok(invalid.error);
});

test("spreadsheet preview reads real immutable before values, applies ordered diffs, and retains exact protected cells", () => {
  const base = saved(artifactContentSchema.parse({ kind: "spreadsheet", activeSheetId: "sheet", sheets: [{ id: "sheet", name: "Inputs", cells: { A1: { raw: "9007199254740993.123456789", format: "0.000000000" }, B1: { raw: "=A1*1.00000000000000001", format: "0.000000000" }, C1: { raw: "remove me" } } }] }));
  const original = structuredClone(base);
  const review = reviewArtifactProposal(proposal({ ignoredPatch: true }, { proposalType: "spreadsheet_ai_diff", diffs: [
    { sheetId: "sheet", ref: "A1", before: { raw: "Incorrect supplied before", format: null }, after: { raw: "9007199254740993.987654321", format: "0.000000000" } },
    { sheetId: "sheet", ref: "C1", before: null, after: null },
  ] }), base, 3);
  assert.equal(review.canAccept, true);
  const numeric = review.changes.find(change => change.path === "/sheets/0/cells/A1/raw");
  assert.equal(numeric?.before, "9007199254740993.123456789");
  assert.equal(numeric?.after, "9007199254740993.987654321");
  if (review.content?.kind !== "spreadsheet" || base.content.kind !== "spreadsheet") throw new Error("Missing spreadsheet preview");
  assert.deepEqual(review.content.sheets[0].cells.B1, base.content.sheets[0].cells.B1);
  assert.equal(review.content.sheets[0].cells.C1, undefined);
  assert.deepEqual(base, original);
});

test("stale proposals remain inspectable against their original base but cannot be accepted; missing/wrong bases fail closed", () => {
  const base = saved(artifactContentSchema.parse({ kind: "screen", view: "Original", state: {} }));
  const pending = proposal({ view: "Proposed" });
  const stale = reviewArtifactProposal(pending, base, 4);
  assert.equal(stale.stale, true);
  assert.equal(stale.canAccept, false);
  assert.equal(stale.changes[0].before, "Original");
  assert.equal(stale.changes[0].after, "Proposed");
  assert.equal(stale.content?.kind, "screen");
  for (const unavailable of [undefined, { ...base, version: 2 }, { ...base, artifactId: "foreign" }]) {
    const review = reviewArtifactProposal(pending, unavailable, 3);
    assert.equal(review.canAccept, false);
    assert.equal(review.content, null);
    assert.ok(review.error);
  }
  assert.equal(reviewArtifactProposal({ ...pending, status: "rejected" }, base, 3).canAccept, false);
});
