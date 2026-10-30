import assert from "node:assert/strict";
import test from "node:test";
import { artifactContentSchema, artifactExportPlanSchema } from "@shared/artifactContracts";
import { buildArtifactDocx } from "./exportDocx";
import { readOfficeArtifactRoundtrip } from "@shared/officeArtifactRoundtrip";

const example = artifactContentSchema.parse({
  kind: "report", templateId: null, sections: [{ id: "s", title: "Editable report", blockIds: ["b"] }],
  blocks: [{ id: "b", type: "paragraph", text: "Recorded forecast assumptions", attrs: {} }],
});
const plan = artifactExportPlanSchema.parse({
  artifactId: "artifact:ws41:document", version: 3, contentHash: "f".repeat(64),
  kind: "report", formats: ["docx", "pptx", "json"], filenameStem: "Forecast review",
  sourceRefs: ["user:research-record"],
});

test("WS-41 genuine generated native Word archive parses back to the exact P4 saved version", async () => {
  const file = buildArtifactDocx(plan, example);
  assert.match(file.filename, /-v3\.docx$/);
  assert.deepEqual(Array.from(file.bytes.subarray(0, 4)), [0x50, 0x4b, 0x03, 0x04], "real Office OPC ZIP, not HTML renamed DOCX");
  const result = await readOfficeArtifactRoundtrip(file.bytes, "docx");
  assert.equal(result.sourceArtifactId, plan.artifactId);
  assert.equal(result.sourceVersion, plan.version);
  assert.equal(result.sourceHash, plan.contentHash);
  assert.deepEqual(result.sourceContent, example);
  assert.deepEqual(result.content, example);
  assert.equal(result.warnings.length, 0);
});

