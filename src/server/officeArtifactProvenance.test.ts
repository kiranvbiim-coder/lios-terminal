import assert from "node:assert/strict";
import test from "node:test";
import { artifactContentSchema } from "@shared/artifactContracts";
import { reconcileOfficeArtifactProvenance } from "./officeArtifactProvenance";

const report = artifactContentSchema.parse({
  kind: "report", templateId: null, sections: [{ id: "s", title: "Findings", blockIds: ["q"] }],
  blocks: [{ id: "q", type: "quote", text: "Original quote", attrs: {
    sourceRef: "filing:original", evidenceId: "e1", contentHash: "a".repeat(64),
    provenance: { sourceUrl: "https://example.test/source" },
    truth: { sourceQuality: { tier: "primary" } },
  } }],
});

test("WS-41 genuine external DOCX narrative edits retain P4 citation but cannot inherit verified authorship", () => {
  if (report.kind !== "report") assert.fail("Report expected");
  const proposed = artifactContentSchema.parse({
    ...report, blocks: [{ ...report.blocks[0], text: "Edited by user in Word" }],
  });
  const original = JSON.stringify(report);
  const edited = reconcileOfficeArtifactProvenance(report, proposed);
  if (edited.kind !== "report") assert.fail("Report expected");
  assert.equal(edited.blocks[0].text, "Edited by user in Word");
  assert.deepEqual(edited.blocks[0].attrs.sourceRef, report.blocks[0].attrs.sourceRef);
  assert.deepEqual(edited.blocks[0].attrs.provenance, report.blocks[0].attrs.provenance);
  assert.deepEqual(edited.blocks[0].attrs.truth, report.blocks[0].attrs.truth);
  assert.equal(edited.blocks[0].attrs.sourceQuoteEdited, true);
  assert.equal(edited.blocks[0].attrs.officeEdited, true);
  assert.equal(edited.blocks[0].attrs.officeEditProvenance, "user_asserted");
  assert.equal(JSON.stringify(report), original, "immutable P4 input was not mutated");
});

test("WS-41 Word/PowerPoint cannot relabel original filing, source hash or evidence quality", () => {
  if (report.kind !== "report") assert.fail("Report expected");
  for (const [name, value] of [
    ["sourceRef", "filing:forged"], ["evidenceId", "faked-e2"],
    ["contentHash", "b".repeat(64)], ["provenance", { sourceUrl: "https://other.test" }],
    ["truth", { sourceQuality: { tier: "verified" } }],
  ] as const) {
    const edited = artifactContentSchema.parse({
      ...report, blocks: [{ ...report.blocks[0], attrs: { ...report.blocks[0].attrs, [name]: value } }],
    });
    assert.throws(() => reconcileOfficeArtifactProvenance(report, edited), /cannot change recorded source provenance/, name);
  }
  const invented = artifactContentSchema.parse({
    ...report, blocks: [...report.blocks, { id: "invented", type: "paragraph", text: "Added", attrs: { sourceRef: "filing:forged" } }],
  });
  assert.throws(() => reconcileOfficeArtifactProvenance(report, invented), /cannot change recorded source provenance/);
});

test("WS-41 unsourced new prose is marked user-authored rather than promoted to verified content", () => {
  if (report.kind !== "report") assert.fail("Report expected");
  const proposed = artifactContentSchema.parse({
    ...report, blocks: [...report.blocks, { id: "new", type: "paragraph", text: "External note", attrs: {} }],
  });
  const edited = reconcileOfficeArtifactProvenance(report, proposed);
  if (edited.kind !== "report") assert.fail("Report expected");
  assert.equal(edited.blocks[1].attrs.officeEdited, true);
  assert.equal(edited.blocks[1].attrs.officeEditProvenance, "user_asserted");
  assert.equal(edited.blocks[1].attrs.sourceRef, undefined);
  assert.deepEqual(edited.blocks[0].attrs, report.blocks[0].attrs, "unchanged citation is left intact");
});

test("WS-41 research returned claims cannot forge evidence or elevate source_backed provenance", () => {
  const research = artifactContentSchema.parse({
    kind: "research", question: "Evaluate", blocks: [],
    claims: [{ id: "c", text: "Source claim", provenance: "source_backed", sourceRefs: ["filing:old"] }],
    evidence: [{ id: "e", title: "Filing", snippet: "Recorded", sourceRef: "filing:old" }],
    sourcePolicy: { mode: "only_refs", allowedSourceRefs: ["filing:old"], providerAllow: [], providerDeny: [] },
  });
  if (research.kind !== "research") assert.fail("Research expected");
  const edited = artifactContentSchema.parse({ ...research, claims: [{ ...research.claims[0], text: "Claim edited in Word", provenance: "source_backed" }] });
  const reconciled = reconcileOfficeArtifactProvenance(research, edited);
  if (reconciled.kind !== "research") assert.fail("Research expected");
  assert.equal(reconciled.claims[0].provenance, "user_asserted");
  assert.deepEqual(reconciled.claims[0].sourceRefs, ["filing:old"]);
  assert.throws(() => reconcileOfficeArtifactProvenance(research,
    artifactContentSchema.parse({ ...research, claims: [{ ...research.claims[0], sourceRefs: ["filing:fake"] }] })),
    /cannot add or modify a research claim/);
  assert.throws(() => reconcileOfficeArtifactProvenance(research,
    artifactContentSchema.parse({ ...research, sourcePolicy: { ...research.sourcePolicy, allowedSourceRefs: ["filing:fake"] } })),
    /cannot modify recorded research sourcePolicy/);
  assert.throws(() => reconcileOfficeArtifactProvenance(research,
    artifactContentSchema.parse({ ...research, evidence: [{ ...research.evidence[0], sourceRef: "filing:fake" }] })),
    /cannot modify recorded research evidence/);
  const fakeLabel = reconcileOfficeArtifactProvenance(research,
    artifactContentSchema.parse({ ...research, claims: [{ ...research.claims[0], provenance: "explicit_inference" }] }));
  if (fakeLabel.kind !== "research") assert.fail("Research expected");
  assert.equal(fakeLabel.claims[0].provenance, "source_backed", "unchanged claim keeps real saved provenance");
});

test("WS-41 an unchanged claim cannot get an upgraded status in an Office attachment", () => {
  const thesis = artifactContentSchema.parse({
    kind: "thesis", summary: "Work", status: "draft", claims: [
      { id: "c", text: "Original", status: "open", confidence: null, evidenceRefs: ["recorded:source"], counterEvidenceRefs: [], updatedAt: null },
    ],
  });
  if (thesis.kind !== "thesis") assert.fail("Thesis expected");
  const forged = artifactContentSchema.parse({
    ...thesis, claims: [{ ...thesis.claims[0], status: "supported", confidence: 1 }],
  });
  const cleaned = reconcileOfficeArtifactProvenance(thesis, forged);
  if (cleaned.kind !== "thesis") assert.fail("Thesis expected");
  assert.equal(cleaned.claims[0].status, "open");
  assert.equal(cleaned.claims[0].confidence, null);
  const changed = reconcileOfficeArtifactProvenance(thesis, artifactContentSchema.parse({
    ...thesis, claims: [{ ...thesis.claims[0], text: "Word-edited", status: "supported", confidence: 1 }],
  }));
  if (changed.kind !== "thesis") assert.fail("Thesis expected");
  assert.equal(changed.claims[0].status, "open");
  assert.equal(changed.claims[0].confidence, null);
});


test("WS-41 Office cannot forge linked decision sources or thesis outcome evidence and state", () => {
  const decision = artifactContentSchema.parse({
    kind: "decision", objective: "Wait for audit",
    linkedRefs: { sources: ["filing:source"], models: ["artifact:model:v2"], monitors: [] },
  });
  if (decision.kind !== "decision") assert.fail("Decision expected");
  assert.throws(() => reconcileOfficeArtifactProvenance(decision, artifactContentSchema.parse({
    ...decision, linkedRefs: { ...decision.linkedRefs, sources: ["filing:forged"] },
  })), /cannot modify recorded decision source/);

  const thesis = artifactContentSchema.parse({
    kind: "thesis", summary: "Validated question", status: "active",
    expectedOutcomes: [{ id: "target", text: "Target growth", status: "occurred", evidenceRefs: ["filing:old"] }],
    invalidationConditions: [{ id: "stop", text: "Revenue falls", triggered: true, evidenceRefs: ["filing:old"] }],
  });
  if (thesis.kind !== "thesis") assert.fail("Thesis expected");
  assert.throws(() => reconcileOfficeArtifactProvenance(thesis, artifactContentSchema.parse({
    ...thesis, expectedOutcomes: [{ ...thesis.expectedOutcomes[0], evidenceRefs: ["filing:forged"] }],
  })), /cannot modify thesis expectedOutcomes evidence references/);
  assert.throws(() => reconcileOfficeArtifactProvenance(thesis, artifactContentSchema.parse({
    ...thesis, status: "closed",
  })), /cannot modify recorded thesis status/);
  const changes = reconcileOfficeArtifactProvenance(thesis, artifactContentSchema.parse({
    ...thesis,
    expectedOutcomes: [{ ...thesis.expectedOutcomes[0], text: "Word-edited target", status: "occurred" }],
    invalidationConditions: [{ ...thesis.invalidationConditions[0], text: "Word-edited trigger", triggered: true }],
  }));
  if (changes.kind !== "thesis") assert.fail("Thesis expected");
  assert.equal(changes.expectedOutcomes[0].status, "open");
  assert.equal(changes.invalidationConditions[0].triggered, false);
  assert.deepEqual(changes.expectedOutcomes[0].evidenceRefs, ["filing:old"]);
});
