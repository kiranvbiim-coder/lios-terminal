import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createProvenanceRecord, sha256Bytes, sourceIdentity } from "./provenance";

describe("data provenance", () => {
  it("produces a deterministic SHA-256 source identity", () => {
    assert.equal(sha256Bytes(Buffer.from("LIOS")), sha256Bytes(Buffer.from("LIOS")));
    assert.notEqual(sha256Bytes(Buffer.from("LIOS")), sha256Bytes(Buffer.from("lios")));
  });

  it("records source size and sanitized filename", () => {
    const nullByte = String.fromCharCode(0);
    const source = sourceIdentity(Buffer.from("abc"), `../../client.xlsx${nullByte}`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.equal(source.sizeBytes, 3);
    assert.ok(!source.fileName.includes("../"));
    assert.ok(!source.fileName.includes(nullByte));
  });

  it("creates an immutable source-to-dataset identity", () => {
    const record = createProvenanceRecord({
      source: sourceIdentity(Buffer.from("abc"), "client.xlsx"),
      organizationId: 7,
      uploadedByUserId: 42,
      datasetId: "dataset-1",
    });
    assert.equal(record.source.sha256.length, 64);
    assert.equal(record.organizationId, 7);
    assert.equal(record.uploadedByUserId, 42);
    assert.equal(record.parentVersionId, null);
    assert.equal(record.transformation.type, "source");
  });
});
