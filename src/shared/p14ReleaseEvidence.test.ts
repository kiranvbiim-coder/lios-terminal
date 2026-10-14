import assert from "node:assert/strict";
import test from "node:test";
import {
  P14_QUALIFICATION_TASKS,
  P14_RELEASE_EVIDENCE_CATEGORIES,
  P14_RELEASE_EVIDENCE_ENV,
  assertP14QualificationBoardComplete,
  buildP14QualificationBoard,
  p14ReleaseEvidenceSchema,
} from "./p14ReleaseEvidence";

test("P14 release evidence maps one environment variable to every unique closure category", () => {
  assert.equal(P14_RELEASE_EVIDENCE_ENV.length, P14_RELEASE_EVIDENCE_CATEGORIES.length);
  assert.deepEqual(new Set(P14_RELEASE_EVIDENCE_ENV.map(([, category]) => category)), new Set(P14_RELEASE_EVIDENCE_CATEGORIES));
});

test("P14 automated evidence requires exact hashes for every source artifact", () => {
  const base = {
    schemaVersion: "1" as const, category: "mac_clean_install" as const, status: "passed" as const,
    releaseTag: "v1.0.0", packageVersion: "1.0.0", generatedAt: new Date().toISOString(),
    evidenceKind: "automated" as const, platform: "darwin-arm64", notes: [],
  };
  assert.equal(p14ReleaseEvidenceSchema.safeParse({ ...base, sourceArtifacts: [{ name: "desktop-self-test-report.json", sha256: "a".repeat(64) }] }).success, true);
  assert.equal(p14ReleaseEvidenceSchema.safeParse({ ...base, sourceArtifacts: [{ name: "desktop-self-test-report.json", sha256: null }] }).success, false);
});

test("P14 human-assisted evidence remains typed and category-bound", () => {
  const parsed = p14ReleaseEvidenceSchema.parse({
    schemaVersion: "1", category: "voiceover", status: "passed", releaseTag: "v1.0.0", packageVersion: "1.0.0",
    generatedAt: new Date().toISOString(), evidenceKind: "human_assisted", platform: "macOS VoiceOver",
    sourceArtifacts: [{ name: "voiceover-walkthrough.md", sha256: null }],
    notes: ["Keyboard and screen-reader walkthrough completed against the exact signed release."],
  });
  assert.equal(parsed.category, "voiceover");
});


function evidence(category: (typeof P14_RELEASE_EVIDENCE_CATEGORIES)[number], overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1",
    category,
    status: "passed",
    releaseTag: "v1.0.0",
    packageVersion: "1.0.0",
    generatedAt: "2026-09-27T00:00:00.000Z",
    evidenceKind: ["voiceover", "narrator", "keyboard", "first_use", "flagship"].includes(category)
      ? "human_assisted"
      : "automated",
    platform: category === "windows_clean_install" || category === "narrator" ? "windows-x64" : "darwin-arm64",
    sourceArtifacts: [{ name: category + ".json", sha256: "a".repeat(64) }],
    notes: [],
    ...overrides,
  };
}

test("P14 qualification tasks cover every release-evidence category exactly once", () => {
  assert.equal(P14_QUALIFICATION_TASKS.length, 12);
  const mapped = P14_QUALIFICATION_TASKS.flatMap((task) => [...task.categories]);
  assert.equal(mapped.length, P14_RELEASE_EVIDENCE_CATEGORIES.length);
  assert.deepEqual(new Set(mapped), new Set(P14_RELEASE_EVIDENCE_CATEGORIES));
  assert.equal(new Set(mapped).size, mapped.length);

  const accessibility = P14_QUALIFICATION_TASKS.find((task) => task.id === "LIOS-P14-10");
  assert.deepEqual(accessibility?.categories, ["voiceover", "narrator", "keyboard"]);
});

test("P14 qualification board passes only with one exact-release record for every category", () => {
  const board = buildP14QualificationBoard({
    evidence: P14_RELEASE_EVIDENCE_CATEGORIES.map((category) => evidence(category)),
    expectedReleaseTag: "v1.0.0",
    expectedPackageVersion: "1.0.0",
    generatedAt: "2026-09-27T01:00:00.000Z",
  });
  assert.equal(board.status, "passed");
  assert.equal(board.tasks.length, 12);
  assert.equal(board.tasks.every((task) => task.status === "passed"), true);
  assert.deepEqual(board.evidenceCategories.missing, []);
  assert.doesNotThrow(() => assertP14QualificationBoardComplete(board));
});

test("P14 qualification board is deterministic for an unchanged evidence bundle", () => {
  const records = P14_RELEASE_EVIDENCE_CATEGORIES.map((category, index) =>
    evidence(category, { generatedAt: `2026-09-27T00:${String(index).padStart(2, "0")}:00.000Z` }),
  );
  const first = buildP14QualificationBoard({
    evidence: records,
    expectedReleaseTag: "v1.0.0",
    expectedPackageVersion: "1.0.0",
  });
  const second = buildP14QualificationBoard({
    evidence: records,
    expectedReleaseTag: "v1.0.0",
    expectedPackageVersion: "1.0.0",
  });
  assert.deepEqual(second, first);
  assert.equal(first.generatedAt, "2026-09-27T00:13:00.000Z");
});

test("P14 qualification board reports missing categories and fails closed", () => {
  const records = P14_RELEASE_EVIDENCE_CATEGORIES
    .filter((category) => category !== "narrator")
    .map((category) => evidence(category));
  const board = buildP14QualificationBoard({
    evidence: records,
    expectedReleaseTag: "v1.0.0",
    expectedPackageVersion: "1.0.0",
  });
  assert.equal(board.status, "incomplete");
  assert.deepEqual(board.evidenceCategories.missing, ["narrator"]);
  const accessibility = board.tasks.find((task) => task.id === "LIOS-P14-10");
  assert.deepEqual(accessibility?.missingCategories, ["narrator"]);
  assert.throws(() => assertP14QualificationBoardComplete(board), /incomplete/i);
});

test("P14 qualification board rejects duplicate category, wrong release and wrong package", () => {
  const complete = P14_RELEASE_EVIDENCE_CATEGORIES.map((category) => evidence(category));
  assert.throws(() => buildP14QualificationBoard({
    evidence: [...complete, evidence("mac_clean_install")],
    expectedReleaseTag: "v1.0.0",
    expectedPackageVersion: "1.0.0",
  }), /Duplicate P14 evidence category/);

  assert.throws(() => buildP14QualificationBoard({
    evidence: complete.map((record) => record.category === "flagship" ? { ...record, releaseTag: "v1.0.1" } : record),
    expectedReleaseTag: "v1.0.0",
    expectedPackageVersion: "1.0.0",
  }), /belongs to release/);

  assert.throws(() => buildP14QualificationBoard({
    evidence: complete.map((record) => record.category === "performance" ? { ...record, packageVersion: "9.9.9" } : record),
    expectedReleaseTag: "v1.0.0",
    expectedPackageVersion: "1.0.0",
  }), /belongs to package/);
});
