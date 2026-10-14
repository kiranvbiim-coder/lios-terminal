import assert from "node:assert/strict";
import test from "node:test";
import { artifactContentSchema } from "@shared/artifactContracts";
import { assembleProfessionalWorkPackage, professionalWorkPackageRequestSchema } from "./professionalWorkPackage";
import { buildArtifactDocx } from "../client/src/lib/exportDocx";
import { readOfficeArtifactRoundtrip } from "@shared/officeArtifactRoundtrip";
const table = artifactContentSchema.parse({ kind: "table", columns: [{ key: "amount", label: "Amount", type: "string" }], rows: [{ amount: "9007199254740993.25" }] });
for (const workflow of ["ic_memo", "credit_memo", "deal_memo", "board_materials", "banking_pitch", "client_proposal", "client_report"] as const) test(`${workflow} publishes only selected exact evidence and authored analysis, retaining native source custody`, async () => {
  const input = professionalWorkPackageRequestSchema.parse({ projectId: 1, workflow, title: "Authored package", audience: "Committee", reportingPeriod: "FY2025", sources: [{ artifactId: "artifact:source", version: 2, contentHash: "a".repeat(64), role: "evidence" }], authoredSections: [{ title: "Executive recommendation", text: "Authored conditional recommendation" }] });
  const assembled = assembleProfessionalWorkPackage(input, [{ id: "artifact:source", version: 2, hash: "a".repeat(64), title: "Exact observations", role: "evidence", content: table, sourceRefs: ["source:owned"] }]);
  if (assembled.content.kind !== "report") throw new Error("Expected report.");
  assert.ok(assembled.content.blocks.some(block => block.text.includes("Not supplied:")));
  const captured = assembled.content.blocks.find(block => block.type === "table")!;
  assert.deepEqual(captured.attrs.table, table);
  assert.ok(assembled.sourceRefs.includes("artifact:source@v2"));
  const plan = { artifactId: "artifact:package", version: 1, contentHash: "b".repeat(64), kind: "report" as const, formats: ["docx" as const], filenameStem: "Package", sourceRefs: assembled.sourceRefs };
  assert.deepEqual((await readOfficeArtifactRoundtrip(buildArtifactDocx(plan, assembled.content).bytes, "docx")).content, assembled.content);
});
