import assert from "node:assert/strict";
import test from "node:test";
import { conversationArtifactViewKey, parseArtifactView } from "./conversationArtifactView";

test("only bounded versioned Artifact references restore deliberate focus", () => {
  const artifactId = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(parseArtifactView({ version: 1, artifactId, focus: true }), { artifactId, focus: true });
  assert.deepEqual(parseArtifactView({ version: 1, artifactId: `artifact:${artifactId}`, focus: true }), { artifactId: `artifact:${artifactId}`, focus: true });
  assert.deepEqual(parseArtifactView({ version: 1, artifactId, focus: false }), { artifactId, focus: false });
  for (const invalid of [null, [], { version: 2, artifactId, focus: true }, { version: 1, artifactId: "https://example.test/", focus: true }, { version: 1, artifactId, focus: "true" }]) {
    assert.deepEqual(parseArtifactView(invalid), { artifactId: null, focus: false });
  }
});

test("Quick Chat restores only its own owner's exact saved revision without allocating a Project", () => {
  const key = conversationArtifactViewKey(11, null, 42);
  assert.equal(key, "lios.artifact-view.v1.11.quick.42");
  assert.notEqual(key, conversationArtifactViewKey(12, null, 42));
  assert.notEqual(key, conversationArtifactViewKey(11, null, 43));
  assert.notEqual(key, conversationArtifactViewKey(11, 17, 42));
  assert.equal(conversationArtifactViewKey(11, 17, 42), "lios.artifact-view.v1.11.17.42", "existing Project bookmarks are unchanged");
  const saved = { version: 1, artifactId: "artifact:11111111-1111-4111-8111-111111111111", focus: true, revision: 4 };
  assert.deepEqual(parseArtifactView(JSON.parse(JSON.stringify(saved))), { artifactId: saved.artifactId, focus: true, revision: 4 });
  assert.equal(conversationArtifactViewKey(undefined, null, null), null, "Temporary Chat has no retained UI bookmark");
  assert.equal(conversationArtifactViewKey(11, null, null), null);
});
