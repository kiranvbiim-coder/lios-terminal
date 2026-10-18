import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
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
  assert.equal(classifyLicense("MIT OR GPL-2.0-only AND BUSL-1.1").severity, "allow");
});

test("SPDX selection obeys precedence, parentheses and complete conjunctions", () => {
  assert.deepEqual(classifyLicense("MIT OR GPL-2.0-only AND BUSL-1.1").selectedTerms, ["MIT"]);
  assert.equal(classifyLicense("(MIT OR GPL-2.0-only) AND BUSL-1.1").severity, "block");
  assert.deepEqual(classifyLicense("(MIT AND ISC) OR GPL-3.0-only").selectedTerms, ["MIT", "ISC"]);
  assert.deepEqual(classifyLicense("GPL-3.0-only OR (Apache-2.0 AND BSD-3-Clause)").selectedTerms, ["Apache-2.0", "BSD-3-Clause"]);
  assert.equal(classifyLicense("MIT AND (ISC OR MPL-2.0)").selectedExpression, "(MIT AND ISC)");
  assert.equal(classifyLicense("MIT AND MPL-2.0").severity, "review");
  assert.equal(classifyLicense("(MPL-2.0 OR Apache-2.0)").selectedExpression, "Apache-2.0");
  assert.equal(classifyLicense("LicenseRef-Unknown OR MIT").selectedExpression, "MIT");
  for (const expression of ["MIT OR", "(MIT OR ISC", "MIT AND", "MIT OR SEE LICENSE IN file", "MIT WITH LLVM-exception", "MIT AND LicenseRef-Unknown", "MIT-0", "OFL-1.1", "Python-2.0", "BlueOak-1.0.0", "Zlib"]) {
    assert.equal(classifyLicense(expression).severity, "review", expression);
  }
  assert.equal(classifyLicense("(GPL-3.0-only WITH Classpath-exception-2.0) AND MIT").severity, "review");
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
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lios-copied-graph-audit-"));
  const root = path.join(workspace, "src");
  const nodeModules = path.join(root, "node_modules");
  fs.mkdirSync(nodeModules, { recursive: true });
  fs.mkdirSync(path.join(workspace, "third_party"));
  fs.writeFileSync(path.join(workspace, "third_party", "release-rights-matrix.json"), JSON.stringify({ nodePackageReviews: [] }));
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
    fs.rmSync(path.dirname(fixture.root), { recursive: true, force: true });
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
    fs.rmSync(path.dirname(fixture.root), { recursive: true, force: true });
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
    fs.rmSync(path.dirname(fixture.root), { recursive: true, force: true });
  }
});

test("both audit modes inspect complete retained payloads, including nested explicit grants", () => {
  const fixture = createNodeGraphFixture();
  try {
    const excluded = path.join(fixture.nodeModules, "runtime", "tests", "fixture");
    fs.mkdirSync(excluded, { recursive: true });
    fs.writeFileSync(path.join(excluded, "package.json"), JSON.stringify({ name: "omitted-fixture", version: "1.0.0", license: "GPL-3.0" }));
    assert.ok(auditInstalledNodeLicenses(fixture.root).findings.some((finding) => finding.component.startsWith("omitted-fixture@") && finding.severity === "block"));
    assert.ok(auditInstalledNodeLicenses(fixture.root, fixture.nodeModules).findings.some((finding) => finding.component.startsWith("omitted-fixture@") && finding.severity === "block"));
  } finally {
    fs.rmSync(path.dirname(fixture.root), { recursive: true, force: true });
  }
});

test("legacy license arrays are not invented OR grants", () => {
  const fixture = createNodeGraphFixture();
  try {
    fs.writeFileSync(path.join(fixture.nodeModules, "runtime", "package.json"), JSON.stringify({
      name: "runtime", version: "1.0.0", licenses: [{ type: "MIT" }, { type: "ISC" }],
    }));
    assert.equal(auditInstalledNodeLicenses(fixture.root, fixture.nodeModules).findings.find((item) => item.component.startsWith("runtime@"))?.severity, "review");
    assert.throws(() => runStaticLicenseAudit(fixture.root, fixture.nodeModules), /Binary release blocked/);
  } finally {
    fs.rmSync(path.dirname(fixture.root), { recursive: true, force: true });
  }
});

test("exact-package selected grants fail closed for changed, missing, escaping and symlinked evidence", () => {
  const fixture = createNodeGraphFixture();
  try {
    const directory = path.join(fixture.nodeModules, "runtime");
    const grant = "Exact reviewed grant bytes\n";
    const review = {
      name: "runtime", version: "1.0.0", declaredLicense: "MIT AND Zlib",
      selectedExpression: "MIT AND Zlib", reviewedTerms: ["Zlib"],
      obligations: ["Preserve both grants."],
      legalFiles: [{ scope: "package", path: "LICENSE", sha256: createHash("sha256").update(grant).digest("hex") }],
    };
    const matrixPath = path.join(path.dirname(fixture.root), "third_party", "release-rights-matrix.json");
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name: "runtime", version: "1.0.0", license: review.declaredLicense }));
    fs.writeFileSync(path.join(directory, "LICENSE"), grant);
    fs.writeFileSync(matrixPath, JSON.stringify({ nodePackageReviews: [review] }));
    const find = () => auditInstalledNodeLicenses(fixture.root, fixture.nodeModules).findings.find((item) => item.component.startsWith("runtime@"))!;
    assert.equal(find().severity, "allow");
    assert.deepEqual(find().selectedTerms, ["MIT", "Zlib"]);
    fs.writeFileSync(path.join(directory, "LICENSE"), "tampered");
    assert.equal(find().severity, "review");
    assert.throws(() => runStaticLicenseAudit(fixture.root, fixture.nodeModules), /Binary release blocked/);
    fs.rmSync(path.join(directory, "LICENSE"));
    assert.equal(find().severity, "review");
    fs.writeFileSync(path.join(directory, "grant-target"), grant);
    fs.symlinkSync("grant-target", path.join(directory, "LICENSE"));
    assert.equal(find().severity, "review");
    review.legalFiles[0].path = "../runtime/grant-target";
    fs.writeFileSync(matrixPath, JSON.stringify({ nodePackageReviews: [review] }));
    assert.equal(find().severity, "review");
  } finally {
    fs.rmSync(path.dirname(fixture.root), { recursive: true, force: true });
  }
});

test("metadata correction requires exact name, version, declaration and retained legal bytes", () => {
  const fixture = createNodeGraphFixture();
  try {
    const directory = path.join(fixture.nodeModules, "runtime");
    const manifest = path.join(directory, "package.json");
    const grant = "Reviewed MIT grant from README\n";
    const review = {
      name: "runtime", version: "1.0.0", declaredLicense: "", selectedExpression: "MIT",
      reviewedTerms: [], metadataCorrection: "The exact README supplies the omitted declaration.",
      obligations: ["Preserve the README."],
      legalFiles: [{ scope: "package", path: "Readme.md", sha256: createHash("sha256").update(grant).digest("hex") }],
    };
    fs.writeFileSync(path.join(directory, "Readme.md"), grant);
    fs.writeFileSync(path.join(path.dirname(fixture.root), "third_party", "release-rights-matrix.json"), JSON.stringify({ nodePackageReviews: [review] }));
    fs.writeFileSync(manifest, JSON.stringify({ name: "runtime", version: "1.0.0" }));
    assert.equal(auditInstalledNodeLicenses(fixture.root, fixture.nodeModules).findings.find((item) => item.component.startsWith("runtime@"))?.severity, "allow");
    for (const metadata of [
      { name: "runtime", version: "1.0.0", license: "UNKNOWN" },
      { name: "runtime", version: "1.0.0", license: "GPL-3.0-only" },
      { name: "runtime", version: "2.0.0" },
      { name: "different", version: "1.0.0" },
    ]) {
      fs.writeFileSync(manifest, JSON.stringify(metadata));
      assert.throws(() => runStaticLicenseAudit(fixture.root, fixture.nodeModules), /Binary release blocked|blocked high-obligation/);
    }
  } finally {
    fs.rmSync(path.dirname(fixture.root), { recursive: true, force: true });
  }
});

test("binary audit refuses a missing canonical rights matrix", () => {
  const fixture = createNodeGraphFixture();
  try {
    fs.rmSync(path.join(path.dirname(fixture.root), "third_party", "release-rights-matrix.json"));
    assert.throws(() => runStaticLicenseAudit(fixture.root, fixture.nodeModules), /ENOENT/);
  } finally {
    fs.rmSync(path.dirname(fixture.root), { recursive: true, force: true });
  }
});

test("constituent obligations and distribution-scoped grant files cannot be dropped", () => {
  const fixture = createNodeGraphFixture();
  try {
    const grant = "Exact package grant";
    const supplement = "Exact upstream distribution grant";
    const directory = path.join(fixture.nodeModules, "runtime");
    fs.writeFileSync(path.join(directory, "LICENSE"), grant);
    const legalDirectory = path.join(fixture.root, "third_party", "licenses");
    fs.mkdirSync(legalDirectory, { recursive: true });
    const supplementalPath = path.join(legalDirectory, "upstream.txt");
    fs.writeFileSync(supplementalPath, supplement);
    const review = {
      name: "runtime", version: "1.0.0", declaredLicense: "MIT AND ISC",
      selectedExpression: "MIT AND ISC", additionalExpression: "BSD-3-Clause", reviewedTerms: [],
      obligations: ["All three license obligations apply."],
      legalFiles: [
        { scope: "package", path: "LICENSE", sha256: createHash("sha256").update(grant).digest("hex") },
        { scope: "distribution", path: "third_party/licenses/upstream.txt", sha256: createHash("sha256").update(supplement).digest("hex") },
      ],
    };
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name: "runtime", version: "1.0.0", license: review.declaredLicense }));
    fs.writeFileSync(path.join(path.dirname(fixture.root), "third_party", "release-rights-matrix.json"), JSON.stringify({ nodePackageReviews: [review] }));
    const finding = auditInstalledNodeLicenses(fixture.root, fixture.nodeModules).findings.find((item) => item.component.startsWith("runtime@"));
    assert.equal(finding?.severity, "allow");
    assert.deepEqual(finding?.selectedTerms, ["MIT", "ISC", "BSD-3-Clause"]);
    fs.rmSync(supplementalPath);
    assert.throws(() => runStaticLicenseAudit(fixture.root, fixture.nodeModules), /Binary release blocked/);
  } finally {
    fs.rmSync(path.dirname(fixture.root), { recursive: true, force: true });
  }
});

test("a package-level MIT declaration cannot hide a nested restricted grant", () => {
  const fixture = createNodeGraphFixture();
  try {
    const directory = path.join(fixture.nodeModules, "runtime", "vendor");
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name: "restricted-vendor", license: "GPL-3.0-only" }));
    assert.throws(() => runStaticLicenseAudit(fixture.root, fixture.nodeModules), /blocked high-obligation.*restricted-vendor/);
  } finally {
    fs.rmSync(path.dirname(fixture.root), { recursive: true, force: true });
  }
});

test("the rights matrix cannot whitelist unknown, restricted or exception-bearing terms", () => {
  const fixture = createNodeGraphFixture();
  try {
    const grant = "Retained grant";
    fs.writeFileSync(path.join(fixture.nodeModules, "runtime", "LICENSE"), grant);
    for (const term of ["LicenseRef-Unknown", "MPL-2.0", "GPL-3.0-only", "MIT WITH LLVM-exception"]) {
      const review = {
        name: "runtime", version: "1.0.0", declaredLicense: term,
        selectedExpression: term, reviewedTerms: [term], obligations: ["Preserve grant."],
        legalFiles: [{ scope: "package", path: "LICENSE", sha256: createHash("sha256").update(grant).digest("hex") }],
      };
      fs.writeFileSync(path.join(path.dirname(fixture.root), "third_party", "release-rights-matrix.json"), JSON.stringify({ nodePackageReviews: [review] }));
      assert.throws(() => runStaticLicenseAudit(fixture.root, fixture.nodeModules), /Invalid.*exact-package rights review/);
    }
  } finally {
    fs.rmSync(path.dirname(fixture.root), { recursive: true, force: true });
  }
});

test("a single legacy license entry is unambiguous without inventing an OR expression", () => {
  const fixture = createNodeGraphFixture();
  try {
    const manifest = path.join(fixture.nodeModules, "runtime", "package.json");
    for (const licenses of [["MIT"], [{ type: "MIT", url: "https://opensource.org/licenses/MIT" }]]) {
      fs.writeFileSync(manifest, JSON.stringify({ name: "runtime", version: "1.0.0", licenses }));
      const finding = auditInstalledNodeLicenses(fixture.root, fixture.nodeModules).findings.find((item) => item.component.startsWith("runtime@"));
      assert.equal(finding?.severity, "allow");
      assert.equal(finding?.selectedExpression, "MIT");
    }
    for (const licenses of [[{}], [{ type: 3 }], [{ type: "UNKNOWN" }], [{ type: "MIT" }, { type: "ISC" }]]) {
      fs.writeFileSync(manifest, JSON.stringify({ name: "runtime", version: "1.0.0", licenses }));
      assert.throws(() => runStaticLicenseAudit(fixture.root, fixture.nodeModules), /Binary release blocked/);
    }
  } finally {
    fs.rmSync(path.dirname(fixture.root), { recursive: true, force: true });
  }
});
