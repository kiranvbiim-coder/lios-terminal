import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { ArtifactComparison } from "@shared/artifactContracts";
import type { ArtifactDetail, ProjectArtifactVersionRecord } from "./useArtifacts";
import {
  artifactHistoryAnchor, canRestoreArtifactHistory, exactArtifactHistoryComparison,
  exactArtifactHistoryDetail, sameArtifactHistoryAnchor,
} from "./artifactHistorySafety";

const id = "artifact:11111111-1111-4111-8111-111111111111";
const oldHash = "a".repeat(64);
const headHash = "b".repeat(64);
const oldRecord = { artifactId: id, version: 2, contentHash: oldHash } as ProjectArtifactVersionRecord;
const headRecord = { artifactId: id, version: 5, contentHash: headHash } as ProjectArtifactVersionRecord;
const detail = {
  artifact: { id, projectId: 17, owningChatId: null, kind: "chart", headVersion: 5 },
  version: { ...headRecord, content: { kind: "chart", chartType: "line", series: [], options: {}, rendererPreference: "recharts" } },
} as unknown as ArtifactDetail;
const comparison = {
  artifactId: id, leftVersion: 2, rightVersion: 5, leftHash: oldHash, rightHash: headHash,
  changed: true, topLevelChangedKeys: ["series"], spreadsheetDiffs: [],
} as ArtifactComparison;

test("WS-40 only renders exactly requested P4 ID, version, head, kind and owner/Chat scope", () => {
  assert.equal(exactArtifactHistoryDetail(detail, id, null, 17, null, false), detail);
  assert.equal(exactArtifactHistoryDetail(detail, id, 5, 17, null, false), detail);
  assert.equal(exactArtifactHistoryDetail(detail, id, 2, 17, null, false), null);
  assert.equal(exactArtifactHistoryDetail(detail, "artifact:another", null, 17, null, false), null);
  assert.equal(exactArtifactHistoryDetail(detail, id, null, 18, null, false), null);
  assert.equal(exactArtifactHistoryDetail(detail, id, 5, 17, null, true), null);
  assert.equal(exactArtifactHistoryDetail({ ...detail, version: { ...detail.version, artifactId: "artifact:foreign" } }, id, 5, 17, null, false), null);
  assert.equal(exactArtifactHistoryDetail({ ...detail, version: { ...detail.version, version: 4 } }, id, null, 17, null, false), null, "current-head read cannot display a historical revision");
  assert.equal(exactArtifactHistoryDetail({ ...detail, artifact: { ...detail.artifact, kind: "table" } }, id, 5, 17, null, false), null);
  assert.equal(exactArtifactHistoryDetail({ ...detail, artifact: { ...detail.artifact, headVersion: 4 } }, id, 5, 17, null, false), null);
  const quick = { ...detail, artifact: { ...detail.artifact, projectId: null, owningChatId: 42 } };
  assert.equal(exactArtifactHistoryDetail(quick, id, 5, null, 42, false), quick);
  assert.equal(exactArtifactHistoryDetail(quick, id, 5, null, 43, false), null);
  assert.equal(exactArtifactHistoryDetail(quick, id, 5, 17, 42, false), null);
});

test("WS-40 async comparison and restoration are bound to exact immutable anchor", () => {
  const anchor = artifactHistoryAnchor(detail);
  assert.deepEqual(anchor, { artifactId: id, displayedVersion: 5, headVersion: 5, contentHash: headHash });
  assert.equal(sameArtifactHistoryAnchor(anchor, { ...anchor }), true);
  for (const variant of [
    { ...anchor, artifactId: "artifact:foreign" },
    { ...anchor, displayedVersion: 2 },
    { ...anchor, headVersion: 6 },
    { ...anchor, contentHash: oldHash },
  ]) assert.equal(sameArtifactHistoryAnchor(anchor, variant), false);
  assert.equal(exactArtifactHistoryComparison(comparison, anchor, oldRecord, headRecord), true);
  assert.equal(exactArtifactHistoryComparison({ ...comparison, rightHash: oldHash }, anchor, oldRecord, headRecord), false);
  assert.equal(exactArtifactHistoryComparison({ ...comparison, leftHash: headHash }, anchor, oldRecord, headRecord), false);
  assert.equal(exactArtifactHistoryComparison({ ...comparison, leftVersion: 3 }, anchor, oldRecord, headRecord), false);
  assert.equal(exactArtifactHistoryComparison({ ...comparison, artifactId: "artifact:foreign" }, anchor, oldRecord, headRecord), false);
  assert.equal(exactArtifactHistoryComparison(comparison, { ...anchor, displayedVersion: 2 }, oldRecord, headRecord), false);
  assert.equal(exactArtifactHistoryComparison(comparison, anchor, undefined, headRecord), false);
});

test("WS-40 restoration only uses current head, earlier recorded version and no dirty or in-flight work", () => {
  const anchor = artifactHistoryAnchor(detail);
  assert.equal(canRestoreArtifactHistory(anchor, oldRecord, false, false), true);
  assert.equal(canRestoreArtifactHistory(anchor, oldRecord, true, false), false);
  assert.equal(canRestoreArtifactHistory(anchor, oldRecord, false, true), false);
  assert.equal(canRestoreArtifactHistory(anchor, headRecord, false, false), false);
  assert.equal(canRestoreArtifactHistory({ ...anchor, displayedVersion: 2 }, oldRecord, false, false), false);
  assert.equal(canRestoreArtifactHistory({ ...anchor, headVersion: 1, displayedVersion: 1 }, oldRecord, false, false), false);
  assert.equal(canRestoreArtifactHistory(anchor, undefined, false, false), false);
  assert.equal(canRestoreArtifactHistory(anchor, { ...oldRecord, artifactId: "artifact:foreign" }, false, false), false);
});

test("WS-40 history UI never swaps placeholder revisions or auto-restores and validates async response hashes", () => {
  const pane = readFileSync(new URL("../components/terminal/ArtifactPane.tsx", import.meta.url), "utf8");
  const hooks = readFileSync(new URL("./useArtifacts.ts", import.meta.url), "utf8");
  assert.match(pane, /exactArtifactHistoryDetail\(detail\.data, artifactId, version, projectId, owningChatId, detail\.isPlaceholderData \|\| detail\.isError\)/);
  assert.doesNotMatch(hooks, /placeholderData: previous => previous\?\.artifact\.id === artifactId/);
  assert.match(pane, /exactArtifactHistoryComparison\(result, captured, from, to\)/);
  assert.match(pane, /historyRequest\.current !== requestId/);
  assert.match(pane, /sameArtifactHistoryAnchor\(historyCurrent\.current\.anchor, captured\)/);
  assert.match(pane, /historyCurrent\.current\.left !== from\.version/);
  assert.match(pane, /metadataDeltaLabels\(compareArtifactVersionMetadata\(from, to\)\)/);
  assert.match(pane, /data-testid="artifact-history-version-list"/);
  assert.match(pane, /View exact v/);
  assert.match(pane, /data-testid="artifact-prepare-restore"/);
  assert.match(pane, /data-testid="artifact-restore-confirmation"/);
  assert.match(pane, /data-testid="artifact-confirm-restore"/);
  assert.match(pane, /await restoreArtifactRevision\(artifactId, captured\.anchor\.headVersion, captured\.targetVersion\)/);
  assert.match(pane, /saved\.version !== captured\.anchor\.headVersion \+ 1/);
  assert.match(pane, /Save or reset unsaved Artifact edits before switching revisions/);
  assert.match(pane, /setRestoreIntent\(\{anchor:\{\.\.\.anchor\},targetVersion:previous\.version,targetHash:previous\.contentHash\}\)/);
  assert.doesNotMatch(pane, /await undoArtifact\(/);
});
