import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  auditInstalledNodeLicenses,
  auditManagedRuntimeLicenses,
  classifyLicense,
  summarizeLicenseFindings,
  runStaticLicenseAudit,
} from "./audit_supply_chain";

test("license classifier permits common permissive licenses and blocks high-obligation licenses", () => {
  assert.equal(classifyLicense("MIT").severity, "allow");
  assert.equal(classifyLicense("Apache-2.0").severity, "allow");
  assert.equal(classifyLicense("BSD-3-Clause").severity, "allow");
  assert.equal(classifyLicense("AGPL-3.0").severity, "block");
  assert.equal(classifyLicense("GPL-3.0-only").severity, "block");
  assert.equal(classifyLicense("BUSL-1.1").severity, "block");
  assert.equal(classifyLicense("MIT OR GPL-2.0-only").severity, "allow");
  assert.equal(classifyLicense("SEE LICENSE IN LICENSE.txt").severity, "review");
  assert.equal(classifyLicense("").severity, "review");
  assert.equal(classifyLicense("LicenseRef-Proprietary").severity, "review");
  assert.equal(classifyLicense("MPL-2.0").severity, "review");
  assert.equal(classifyLicense("MIT OR GPL-2.0-only AND BUSL-1.1").severity, "block");
});

test("managed runtime license audit is derived from the manifest rather than a second package list", () => {
  const findings = auditManagedRuntimeLicenses({
    runtimeId: "test",
    manifestVersion: "1",
    pythonVersion: ">=3.11",
    supportedPlatforms: ["test"],
    installPolicy: "signed_allowlist_only",
    packs: [{
      id: "core",
      name: "Core",
      packages: [
        { name: "safe", version: "1.0.0", license: "MIT", native: false },
        { name: "review", version: "1.0.0", license: "UNKNOWN", native: false },
      ],
      engines: ["test"],
    }],
  });

  assert.equal(findings.length, 2);
  assert.equal(findings[0].severity, "allow");
  assert.equal(findings[1].severity, "review");
});

test("license summary keeps manual-review findings separate from release blockers", () => {
  const findings = [
    { component: "a", license: "MIT", source: "node" as const, severity: "allow" as const, detail: "ok" },
    { component: "b", license: "UNKNOWN", source: "node" as const, severity: "review" as const, detail: "review" },
    { component: "c", license: "AGPL-3.0", source: "runtime" as const, severity: "block" as const, detail: "block" },
  ];
  const result = summarizeLicenseFindings(findings);
  assert.deepEqual(result.review.map((item) => item.component), ["b"]);
  assert.deepEqual(result.blocked.map((item) => item.component), ["c"]);
});

function createNodeGraphFixture(): { root: string; nodeModules: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-copied-graph-audit-"));
  const nodeModules = path.join(root, "node_modules");
  fs.mkdirSync(nodeModules);
  const packages = {
    "node_modules/runtime": { version: "1.0.0" },
    "node_modules/dev-tool": { version: "2.0.0", dev: true },
    "node_modules/@fixture/scoped": { version: "3.0.0", dev: true },
    "node_modules/runtime/node_modules/nested": { version: "4.0.0", dev: true },
    // Not installed means not copied. A platform-specific optional lock entry
    // must not masquerade as either an inspected package or missing metadata.
    "node_modules/other-platform": { version: "5.0.0", optional: true },
  };
  fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages }));
  for (const [relativePath, entry] of Object.entries(packages)) {
    if (relativePath.endsWith("other-platform")) continue;
    const directory = path.join(root, relativePath);
    fs.mkdirSync(directory, { recursive: true });
    const name = relativePath.slice(relativePath.lastIndexOf("node_modules/") + "node_modules/".length);
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name, version: entry.version, license: "MIT" }));
  }
  return { root, nodeModules };
}

test("audits the actual copied graph including dev, scoped and nested packages rather than production lock entries", () => {
  const fixture = createNodeGraphFixture();
  try {
    const exportDirectory = path.join(fixture.nodeModules, "runtime", "dist", "esm");
    fs.mkdirSync(exportDirectory, { recursive: true });
    fs.writeFileSync(path.join(exportDirectory, "package.json"), JSON.stringify({ type: "module" }));
    const audit = auditInstalledNodeLicenses(fixture.root, fixture.nodeModules);
    assert.deepEqual(audit.findings.map((finding) => finding.component).sort(), [
      "@fixture/scoped@3.0.0 [node_modules/@fixture/scoped]",
      "dev-tool@2.0.0 [node_modules/dev-tool]",
      "nested@4.0.0 [node_modules/runtime/node_modules/nested]",
      "runtime@1.0.0 [node_modules/runtime]",
    ]);
    assert.ok(audit.findings.every((finding) => finding.severity === "allow"));
    assert.deepEqual(audit.missingPackageMetadata, []);
    assert.doesNotThrow(() => runStaticLicenseAudit(fixture.root, fixture.nodeModules));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("keeps copied dev-only unknown and unrecognized license terms as binary-release blockers", () => {
  const fixture = createNodeGraphFixture();
  try {
    const manifest = path.join(fixture.nodeModules, "dev-tool", "package.json");
    for (const license of ["UNKNOWN", "LicenseRef-Distribution-Restricted", "SEE LICENSE IN LICENSE.md"]) {
      fs.writeFileSync(manifest, JSON.stringify({ name: "dev-tool", version: "2.0.0", license }));
      const finding = auditInstalledNodeLicenses(fixture.root, fixture.nodeModules).findings.find((item) => item.component.startsWith("dev-tool@"));
      assert.equal(finding?.severity, "review");
      assert.throws(() => runStaticLicenseAudit(fixture.root, fixture.nodeModules), /Binary release blocked/);
    }
    fs.writeFileSync(manifest, JSON.stringify({ name: "dev-tool", version: "2.0.0", license: "AGPL-3.0" }));
    assert.throws(() => runStaticLicenseAudit(fixture.root, fixture.nodeModules), /blocked high-obligation.*dev-tool/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("blocks copied untracked packages, version drift and invalid package metadata without silently dropping them", () => {
  const fixture = createNodeGraphFixture();
  try {
    const untracked = path.join(fixture.nodeModules, "untracked");
    fs.mkdirSync(untracked);
    fs.writeFileSync(path.join(untracked, "package.json"), JSON.stringify({ name: "untracked", version: "1.0.0", license: "MIT" }));
    fs.writeFileSync(path.join(fixture.nodeModules, "dev-tool", "package.json"), JSON.stringify({ name: "dev-tool", version: "9.0.0", license: "MIT" }));
    fs.writeFileSync(path.join(fixture.nodeModules, "@fixture", "scoped", "package.json"), "not json");
    fs.mkdirSync(path.join(fixture.nodeModules, "missing-manifest"));
    const audit = auditInstalledNodeLicenses(fixture.root, fixture.nodeModules);
    assert.ok(audit.findings.some((finding) => finding.component.startsWith("untracked@") && finding.severity === "review" && /absent from the lockfile/.test(finding.detail)));
    assert.ok(audit.findings.some((finding) => finding.component.startsWith("dev-tool@9.0.0") && finding.severity === "review" && /differs from locked/.test(finding.detail)));
    assert.deepEqual(audit.missingPackageMetadata, ["node_modules/@fixture/scoped", "node_modules/missing-manifest"]);
    assert.throws(() => runStaticLicenseAudit(fixture.root, fixture.nodeModules), /Binary release blocked/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("installed-source inventory shares packaging pruning while exact-copy inventory inspects every retained directory", () => {
  const fixture = createNodeGraphFixture();
  try {
    const excluded = path.join(fixture.nodeModules, "runtime", "tests", "fixture");
    fs.mkdirSync(excluded, { recursive: true });
    fs.writeFileSync(path.join(excluded, "package.json"), JSON.stringify({ name: "omitted-fixture", version: "1.0.0", license: "GPL-3.0" }));
    assert.equal(auditInstalledNodeLicenses(fixture.root).findings.length, 4);
    assert.ok(auditInstalledNodeLicenses(fixture.root, fixture.nodeModules).findings.some((finding) => finding.component.startsWith("omitted-fixture@") && finding.severity === "block"));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
