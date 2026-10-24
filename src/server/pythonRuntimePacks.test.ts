import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { resolveSelectedPacks, auditInstalledPackages, classifyManifestVersion, packSpec } from "./pythonRuntimeManager";
import { MANAGED_RUNTIME_MANIFEST } from "./runtimeManifest";
import { consentScopeForRuntimePack } from "./communityDataConsent";

// ── Manifest version -> pip spec translation ────────────────────────────
// The manifest carries three genuinely different version shapes and a
// naive "starts with a digit means exact pin" rule produces invalid pip
// specs for two of them.

test("classifyManifestVersion distinguishes exact pins, ranges, and non-pip components", () => {
  assert.equal(classifyManifestVersion("1.14.1"), "exact");
  assert.equal(classifyManifestVersion("0.141.1"), "exact");
  assert.equal(classifyManifestVersion("2.x"), "range");
  assert.equal(classifyManifestVersion("<3.0"), "range");
  assert.equal(classifyManifestVersion("managed-sidecar"), "not-pip-installable");
});

test("packSpec never emits an invalid pip spec for the manifest's non-exact versions", () => {
  assert.equal(packSpec({ name: "scipy", version: "1.14.1" }), "scipy==1.14.1");
  assert.equal(packSpec({ name: "pandas", version: "<3.0" }), "pandas<3.0");
  // "numpy==2.x" is not a valid pip requirement -- it must become a real range.
  assert.equal(packSpec({ name: "numpy", version: "2.x" }), "numpy>=2,<3");
  // External managed components are not pip wheels and must never become invalid specs.
  assert.equal(packSpec({ name: "external-runtime", version: "managed-sidecar" }), null);
});

test("every package in the shipped manifest translates to a valid pip spec or an explicit non-pip component", () => {
  for (const pack of MANAGED_RUNTIME_MANIFEST.packs) {
    for (const pkg of pack.packages) {
      const spec = packSpec(pkg);
      if (spec === null) continue;
      assert.match(
        spec,
        /^[A-Za-z0-9._-]+(==[0-9][^\s]*|[<>=!~][^\s]*|>=\d+,<\d+)$/,
        `pack ${pack.id} produced an invalid pip spec: ${spec}`,
      );
    }
  }
});

// ── Pack selection (P0.5: core-only by default, allow-list enforced) ────

test("resolveSelectedPacks returns core alone when nothing is selected -- the retail default", () => {
  const packs = resolveSelectedPacks(MANAGED_RUNTIME_MANIFEST, []);
  assert.deepEqual(packs.map((p) => p.id), ["core"]);
});

test("resolveSelectedPacks always includes core even when only an optional pack is requested", () => {
  const packs = resolveSelectedPacks(MANAGED_RUNTIME_MANIFEST, ["ml"]);
  const ids = packs.map((p) => p.id);
  assert.ok(ids.includes("core"), "core must always be installed -- every other pack's engines import from it");
  assert.ok(ids.includes("ml"));
  assert.equal(ids.length, 2, "no unselected pack may be installed");
});

test("resolveSelectedPacks never installs yfinance unless the community-yahoo pack is explicitly selected", () => {
  const defaultPacks = resolveSelectedPacks(MANAGED_RUNTIME_MANIFEST, []);
  const defaultPackages = defaultPacks.flatMap((p) => p.packages.map((pkg) => pkg.name));
  assert.ok(!defaultPackages.includes("yfinance"), "a default retail install must not pull yfinance");

  const optedIn = resolveSelectedPacks(MANAGED_RUNTIME_MANIFEST, ["community-yahoo"]);
  assert.ok(optedIn.flatMap((p) => p.packages.map((pkg) => pkg.name)).includes("yfinance"));
});

test("resolveSelectedPacks rejects a pack that is not in the signed manifest", () => {
  assert.throws(
    () => resolveSelectedPacks(MANAGED_RUNTIME_MANIFEST, ["not-a-real-pack"]),
    /not present in the signed manifest/,
  );
});

// ── Post-install allow-list audit ───────────────────────────────────────

test("auditInstalledPackages reports nothing when the venv matches the manifest pins", () => {
  const warnings = auditInstalledPackages(MANAGED_RUNTIME_MANIFEST, ["core"], {
    fastapi: "0.141.1", starlette: "1.6.0",
    uvicorn: "0.34.0",
    numpy: "2.1.0",
    pandas: "2.2.3",
    scipy: "1.14.1",
    statsmodels: "0.14.4",
  });
  assert.deepEqual(warnings, []);
});

test("auditInstalledPackages flags an exact-pin mismatch (a substituted or drifted wheel)", () => {
  const warnings = auditInstalledPackages(MANAGED_RUNTIME_MANIFEST, ["core"], {
    fastapi: "0.141.1", starlette: "1.6.0",
    uvicorn: "0.34.0",
    numpy: "2.1.0",
    pandas: "2.2.3",
    scipy: "9.9.9",
    statsmodels: "0.14.4",
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /scipy is pinned to 1\.14\.1 .* but 9\.9\.9 is installed/);
});

test("auditInstalledPackages flags a manifest package that never got installed", () => {
  const warnings = auditInstalledPackages(MANAGED_RUNTIME_MANIFEST, ["ml"], {
    fastapi: "0.141.1", starlette: "1.6.0", uvicorn: "0.34.0", numpy: "2.1.0", pandas: "2.2.3", scipy: "1.14.1", statsmodels: "0.14.4",
  });
  assert.ok(warnings.some((w) => /scikit-learn .* is not installed/.test(w)));
});

test("auditInstalledPackages normalizes pip's name casing/separators before comparing", () => {
  // pip reports scikit_learn / Scikit-Learn depending on version; the audit
  // must not raise a false "missing package" on a naming variant.
  const warnings = auditInstalledPackages(MANAGED_RUNTIME_MANIFEST, ["ml"], {
    fastapi: "0.141.1", starlette: "1.6.0", uvicorn: "0.34.0", numpy: "2.1.0", pandas: "2.2.3", scipy: "1.14.1", statsmodels: "0.14.4",
    scikit_learn: "1.9.0",
  });
  assert.deepEqual(warnings, []);
});

test("auditInstalledPackages accepts versions inside approved manifest ranges", () => {
  // pandas is pinned "<3.0" and numpy to "2.x" -- supported 2.x stays admitted
  // while the same shared parser guards both post-install audit and release bundle.
  const warnings = auditInstalledPackages(MANAGED_RUNTIME_MANIFEST, ["core"], {
    fastapi: "0.141.1", starlette: "1.6.0", uvicorn: "0.34.0", numpy: "2.3.1", pandas: "2.0.0", scipy: "1.14.1", statsmodels: "0.14.4",
  });
  assert.deepEqual(warnings, []);
});

// ── Manifest / requirements.txt drift guard ─────────────────────────────

test("core runtime pins the audited FastAPI/Starlette pair", () => {
  const core = MANAGED_RUNTIME_MANIFEST.packs.find((pack) => pack.id === "core");
  assert.ok(core);
  assert.equal(MANAGED_RUNTIME_MANIFEST.manifestVersion, "1.1.0");
  assert.equal(core.packages.find((pkg) => pkg.name === "fastapi")?.version, "0.141.1");
  assert.equal(core.packages.find((pkg) => pkg.name === "starlette")?.version, "1.6.0");
});

test("every exact manifest pin matches python-service/requirements.txt", () => {
  const requirementsPath = path.resolve(process.cwd(), "python-service", "requirements.txt");
  const text = fs.readFileSync(requirementsPath, "utf8");
  const pinned = new Map<string, string>();
  for (const line of text.split("\n")) {
    const match = line.trim().match(/^([A-Za-z0-9._-]+)(?:\[[^\]]+\])?==([0-9][^\s#]*)/);
    if (match) pinned.set(match[1].toLowerCase().replace(/[_.]+/g, "-"), match[2]);
  }

  const mismatches: string[] = [];
  for (const pack of MANAGED_RUNTIME_MANIFEST.packs) {
    for (const pkg of pack.packages) {
      // Only exact pins that intentionally belong to the dev/CI superset are comparable.
      // Heavy opt-in desktop packs (for example P7 Docling) remain installable through the
      // signed managed-runtime manifest without bloating every CI/base installation.
      if (classifyManifestVersion(pkg.version) !== "exact" || pkg.ciSuperset === false) continue;
      const key = pkg.name.toLowerCase().replace(/[_.]+/g, "-");
      const inRequirements = pinned.get(key);
      if (!inRequirements) {
        mismatches.push(`${pkg.name} is pinned ${pkg.version} in the manifest but absent from requirements.txt`);
      } else if (inRequirements !== pkg.version) {
        mismatches.push(`${pkg.name}: manifest ${pkg.version} vs requirements.txt ${inRequirements}`);
      }
    }
  }
  assert.deepEqual(mismatches, [], "the signed manifest and the dev/CI requirements superset must not drift apart");
});

// ── Consent unification (P0.5) ──────────────────────────────────────────

test("the community-yahoo runtime pack resolves to the same consent scope the connector uses", () => {
  assert.equal(consentScopeForRuntimePack("community-yahoo"), "yahoo_community");
});

test("packs with no community-data implication require no consent record", () => {
  for (const packId of ["core", "ml", "fixed-income", "forecasting", "optimization", "research-sec", "research-docs"]) {
    assert.equal(consentScopeForRuntimePack(packId), null, `${packId} must not demand community consent`);
  }
});


test("research-docs managed runtime remains opt-in and pins Docling without entering the CI superset", () => {
  const pack = MANAGED_RUNTIME_MANIFEST.packs.find((item) => item.id === "research-docs");
  assert.ok(pack);
  const docling = pack.packages.find((pkg) => pkg.name === "docling");
  assert.equal(docling?.version, "2.129.0");
  assert.equal(docling?.ciSuperset, false);
  assert.deepEqual(resolveSelectedPacks(MANAGED_RUNTIME_MANIFEST, []).map((item) => item.id), ["core"]);
  assert.ok(resolveSelectedPacks(MANAGED_RUNTIME_MANIFEST, ["research-docs"]).some((item) => item.id === "research-docs"));
});

test("managed Python audit rejects out-of-range versions before release activation", () => {
  const packages = {
    fastapi: "0.141.1", starlette: "1.6.0", uvicorn: "0.34.0",
    numpy: "2.3.1", pandas: "2.2.3", scipy: "1.14.1", statsmodels: "0.14.4",
  };
  assert.deepEqual(auditInstalledPackages(MANAGED_RUNTIME_MANIFEST, ["core"], packages), []);
  const badNumpy = auditInstalledPackages(MANAGED_RUNTIME_MANIFEST, ["core"], { ...packages, numpy: "3.0.0" });
  assert.equal(badNumpy.length, 1);
  assert.match(badNumpy[0], /numpy requires 2\.x.*3\.0\.0 is installed/);
  const badPandas = auditInstalledPackages(MANAGED_RUNTIME_MANIFEST, ["core"], { ...packages, pandas: "3.0.0" });
  assert.equal(badPandas.length, 1);
  assert.match(badPandas[0], /pandas requires <3\.0.*3\.0\.0 is installed/);
  const malformed = auditInstalledPackages(MANAGED_RUNTIME_MANIFEST, ["core"], { ...packages, numpy: "2.3.0rc1" });
  assert.equal(malformed.length, 1);
  assert.match(malformed[0], /numpy requires/);
});

test("managed Python audit refuses ambiguously named installed packages", () => {
  const installed = {
    fastapi: "0.141.1", starlette: "1.6.0", uvicorn: "0.34.0",
    numpy: "2.3.1", NumPy: "3.0.0", pandas: "2.2.3",
    scipy: "1.14.1", statsmodels: "0.14.4",
  };
  const warnings = auditInstalledPackages(MANAGED_RUNTIME_MANIFEST, ["core"], installed);
  assert.ok(warnings.some(w => /duplicate canonical package name numpy/.test(w)));
  assert.ok(warnings.some(w => /numpy requires/.test(w)));
});
