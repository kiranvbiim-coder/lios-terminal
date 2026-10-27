import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PHASE4_REQUIRED_EVIDENCE, evaluatePhase4ReleaseEvidence } from "./phase4_release_evidence.mjs";
import { assessPhase4Release, verifyEvidenceFiles } from "./phase4_release_gate.mjs";

const commit = "ab".repeat(20);
const payload = Buffer.from("RELEASE EVIDENCE TEST FIXTURE -- NOT AN INSTALLED RUN\n");
const digest = createHash("sha256").update(payload).digest("hex");
function sample(id, extras = {}) {
  const gate = PHASE4_REQUIRED_EVIDENCE.find(item => item.id === id);
  assert.ok(gate);
  return {
    id, scope: gate.scope, platform: gate.platform, commit,
    status: "passed", observedAt: "2026-10-27T12:00:00.000Z",
    artifactPath: id + ".json", artifactSha256: digest, ...extras,
  };
}
function complete() {
  return { commit, evidence: PHASE4_REQUIRED_EVIDENCE.map(row => sample(row.id)) };
}

test("default Phase 4 report is blocked even when earlier source PRs passed", () => {
  const result = evaluatePhase4ReleaseEvidence({ commit, evidence: [] });
  assert.equal(result.releaseReady, false);
  assert.equal(result.required, 15);
  assert.equal(result.sourceChecksPassed, 0);
  assert.equal(result.nativeChecksPassed, 0);
  assert.ok(result.blockers.some(row => row.id === "packaged-valuation-http"));
  assert.ok(result.blockers.some(row => row.id === "sp01-packaged-journey"));
});

test("source CI passes do not stand in for native signed/valuation acceptance", () => {
  const evidence = PHASE4_REQUIRED_EVIDENCE.filter(row => row.scope === "source").map(row => sample(row.id));
  const result = evaluatePhase4ReleaseEvidence({ commit, evidence });
  assert.equal(result.releaseReady, false);
  assert.equal(result.sourceChecksPassed, 3);
  assert.equal(result.nativeChecksPassed, 0);
  assert.equal(result.blockers.length, 12);
});

test("missing 502-affected packaged valuation report always blocks release", () => {
  const input = complete();
  input.evidence = input.evidence.filter(row => row.id !== "packaged-valuation-http");
  const result = evaluatePhase4ReleaseEvidence(input);
  assert.equal(result.releaseReady, false);
  assert.deepEqual(result.blockers.map(row => row.id), ["packaged-valuation-http"]);
});

test("foreign commit, failed job, wrong scope, fixture and duplicated evidence fail closed", () => {
  const changes = [
    ["source-linux", { commit: "cd".repeat(20) }],
    ["source-windows", { status: "failed" }],
    ["signed-macos", { scope: "source" }],
    ["signed-windows", { mode: "mock" }],
    ["clean-install-macos", { synthetic: true }],
    ["accessibility-macos", { artifactSha256: "not-a-sha" }],
    ["source-macos", { observedAt: "invalid" }],
  ];
  const input = complete();
  for (const [id, patch] of changes) {
    const index = input.evidence.findIndex(row => row.id === id);
    input.evidence[index] = { ...input.evidence[index], ...patch };
  }
  input.evidence.push(sample("source-linux"));
  const result = evaluatePhase4ReleaseEvidence(input);
  assert.equal(result.releaseReady, false);
  assert.ok(result.blockers.length >= changes.length);
});

test("all green text records without physically verified evidence never authorize release", () => {
  const result = assessPhase4Release(complete(), null);
  assert.equal(result.releaseReady, false);
  assert.equal(result.evidenceFilesChecked, false);
  assert.equal(result.blockers.length, 0, "individual metadata can be valid but release is still unqualified");
});

test("artifact contents must be retained, byte-identical, regular files within evidence root", () => {
  const root = mkdtempSync(join(tmpdir(), "lios-phase4-negative-"));
  try {
    mkdirSync(join(root, "reports"));
    writeFileSync(join(root, "reports", "source.json"), payload);
    const input = { evidence: [{ ...sample("source-linux"), artifactPath: "reports/source.json" }] };
    assert.deepEqual(verifyEvidenceFiles(input, root), []);
    input.evidence[0].artifactSha256 = "0".repeat(64);
    assert.match(verifyEvidenceFiles(input, root)[0].reason, /SHA-256/);
    input.evidence[0].artifactSha256 = digest;
    input.evidence[0].artifactPath = "../outside.json";
    assert.match(verifyEvidenceFiles(input, root)[0].reason, /contained/);
    input.evidence[0].artifactPath = "missing.json";
    assert.match(verifyEvidenceFiles(input, root)[0].reason, /does not exist/);
    try {
      symlinkSync(join(root, "reports", "source.json"), join(root, "linked.json"));
      input.evidence[0].artifactPath = "linked.json";
      assert.match(verifyEvidenceFiles(input, root)[0].reason, /non-symlinked/);
    } catch (error) {
      // Unprivileged Windows CI may not have SeCreateSymbolicLinkPrivilege.
      if (!["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) throw error;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("matching manifest digests from a different checkout never authorize release", () => {
  const root = mkdtempSync(join(tmpdir(), "lios-phase4-checkout-"));
  try {
    const input = complete();
    for (const row of input.evidence) writeFileSync(join(root, row.artifactPath), payload);
    const oldCommit = assessPhase4Release(input, root, { commit: "cd".repeat(20), trackedFilesClean: true });
    assert.equal(oldCommit.releaseReady, false);
    assert.equal(oldCommit.exactCheckout, false);
    assert.match(oldCommit.checkoutErrors.join(" "), /Git HEAD/);
    const dirty = assessPhase4Release(input, root, { commit, trackedFilesClean: false });
    assert.equal(dirty.releaseReady, false);
    assert.match(dirty.checkoutErrors.join(" "), /modified/);
    assert.equal(assessPhase4Release(input, root, null).releaseReady, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("positive decision is possible only with all named exact-commit physical evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "lios-phase4-positive-fixture-"));
  try {
    const input = complete();
    for (const row of input.evidence) writeFileSync(join(root, row.artifactPath), payload);
    const result = assessPhase4Release(input, root, { commit, trackedFilesClean: true });
    assert.equal(result.releaseReady, true, "test fixture validates algorithm only; does NOT demonstrate installed app readiness");
    assert.equal(result.evidenceFilesChecked, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
