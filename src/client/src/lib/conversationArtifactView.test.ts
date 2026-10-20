import assert from "node:assert/strict";
import test from "node:test";
import { parseArtifactView } from "./conversationArtifactView";

test("only bounded versioned Artifact references restore deliberate focus", () => {
  const artifactId = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(parseArtifactView({ version: 1, artifactId, focus: true }), { artifactId, focus: true });
  assert.deepEqual(parseArtifactView({ version: 1, artifactId: `artifact:${artifactId}`, focus: true }), { artifactId: `artifact:${artifactId}`, focus: true });
  assert.deepEqual(parseArtifactView({ version: 1, artifactId, focus: false }), { artifactId, focus: false });
  for (const invalid of [null, [], { version: 2, artifactId, focus: true }, { version: 1, artifactId: "https://example.test/", focus: true }, { version: 1, artifactId, focus: "true" }]) {
    assert.deepEqual(parseArtifactView(invalid), { artifactId: null, focus: false });
  }
});
