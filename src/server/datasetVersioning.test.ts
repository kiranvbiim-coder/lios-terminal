import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDatasetVersion, nextDatasetVersion } from "./datasetVersioning";

describe("dataset versioning", () => {
  const hash = "a".repeat(64);

  it("creates immutable versions with parent linkage", () => {
    const version = createDatasetVersion({ datasetId: "d1", sourceSha256: hash, sourceSizeBytes: 10, organizationId: 1, createdByUserId: 2, version: 2, parentVersionId: "v1" });
    assert.equal(version.status, "immutable");
    assert.equal(version.parentVersionId, "v1");
    assert.equal(version.version, 2);
  });

  it("increments from the highest existing version", () => {
    assert.equal(nextDatasetVersion([{ version: 1 }, { version: 7 }, { version: 3 }]), 8);
    assert.equal(nextDatasetVersion([]), 1);
  });

  it("rejects invalid hashes and versions", () => {
    assert.throws(() => createDatasetVersion({ datasetId: "d1", sourceSha256: "bad", sourceSizeBytes: 1, organizationId: 1, createdByUserId: 2, version: 1 }), /INVALID_SOURCE_HASH/);
    assert.throws(() => createDatasetVersion({ datasetId: "d1", sourceSha256: hash, sourceSizeBytes: 1, organizationId: 1, createdByUserId: 2, version: 0 }), /INVALID_VERSION/);
  });
});
