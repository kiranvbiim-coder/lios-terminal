import test from "node:test";
import assert from "node:assert/strict";
import { decisionArtifactContentSchema } from "@shared/artifactContracts";
import { assembleProfessionalWorkPackage, professionalWorkPackageRequestSchema } from "./professionalWorkPackage";

const hash = "a".repeat(64);
const content = decisionArtifactContentSchema.parse({
  kind: "decision", objective: "Review decision", recommendation: "Wait for audited figures",
  linkedRefs: { sources: ["source:filing:1"] },
});

test("professional report publishes recommendation, evidence, risks and proposed actions separately as user assertions", () => {
  const input = professionalWorkPackageRequestSchema.parse({
    projectId: 12, workflow: "ic_memo", title: "Committee memo", audience: "Internal committee", reportingPeriod: "2026 Q4",
    sources: [{ artifactId: "artifact:decision:1", version: 3, contentHash: hash, role: "decision" }],
    authoredSections: [
      { title: "Executive recommendation", text: "Hold; no decision approved" },
      { title: "Authored evidence assessment · unverified", text: "Cash-flow estimate requires reconciliation" },
      { title: "Risks, dissent and open questions", text: "Downside uncertainty remains unresolved" },
      { title: "Proposed actions · not authorized", text: "Request a new model review; do not execute" },
    ],
  });
  const out = assembleProfessionalWorkPackage(input, [{
    id: "artifact:decision:1", version: 3, hash, title: "Review", role: "decision",
    content, sourceRefs: ["source:filing:1"], executionReceiptIds: [],
  }]);
  assert.equal(out.content.kind, "report");
  if (out.content.kind !== "report") return;
  const blocks = out.content.blocks;
  const authoredTexts = input.authoredSections.map(item => item.text);
  for (const text of authoredTexts) {
    const matching = blocks.filter(block => block.text === text);
    assert.equal(matching.length, 1, `expected exactly one ${text}`);
    assert.equal(matching[0].attrs.provenance && (matching[0].attrs.provenance as { evidenceKind: string }).evidenceKind, "user_asserted");
  }
  const titles = input.authoredSections.map(item => item.title);
  for (const title of titles) assert.ok(blocks.some(block => block.type === "heading" && block.text === title));
  assert.ok(blocks.some(block => block.text.startsWith("Not supplied: Company and market")));
  assert.ok(blocks.some(block => block.attrs.provenance && (block.attrs.provenance as { evidenceKind: string }).evidenceKind === "data_gap"));
  assert.ok(blocks.some(block => block.id === "source-heading-0" && block.text === "DECISION · Review · v3"));
  assert.ok(blocks.some(block => block.attrs.sourceContent && block.attrs.sourceHash === hash));
  assert.ok(!blocks.some(block => /approved by server|authorization granted|execution completed/i.test(block.text)));
  assert.ok(out.sourceRefs.includes("artifact:decision:1@v3"));
});
