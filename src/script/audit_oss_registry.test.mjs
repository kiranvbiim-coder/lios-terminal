import assert from "node:assert/strict";
import test from "node:test";
import { validateOssRegistry, validateWorkspaceBenchmark } from "./audit_oss_registry.mjs";

function fixture(overrides = {}) {
  const component = {
    id: "example",
    name: "Example",
    repository: "owner/example",
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    license: "MIT",
    posture: "donor_candidate",
    classification: "adapt",
    bundled: false,
    noticeRequiredOnImport: true,
    externalRights: "verified_not_applicable",
    roles: ["example"],
    importedPaths: [],
    destinationPaths: [],
    modifications: [],
    ...overrides,
  };
  return {
    registry: { schemaVersion: "1", components: [component] },
    lock: {
      schemaVersion: "1",
      locks: [{
        id: component.id,
        repository: component.repository,
        commitSha: component.commitSha,
        license: component.license,
      }],
    },
    noticesText: "Example",
  };
}

test("OSS registry accepts exact pinned permissive donor candidates", () => {
  const result = validateOssRegistry(fixture());
  assert.deepEqual(result.errors, []);
  assert.equal(result.componentCount, 1);
});

test("OSS registry fails closed on SHA drift between registry and lock", () => {
  const value = fixture();
  value.lock.locks[0].commitSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const result = validateOssRegistry(value);
  assert.match(result.errors.join("\n"), /Commit mismatch/i);
});

test("OSS registry forbids OpenBB from returning through the donor registry", () => {
  const value = fixture({ id: "openbb", name: "OpenBB", repository: "OpenBB-finance/OpenBB" });
  value.lock.locks[0].id = "openbb";
  value.lock.locks[0].repository = "OpenBB-finance/OpenBB";
  const result = validateOssRegistry(value);
  assert.match(result.errors.join("\n"), /explicitly excluded/i);
});

test("bundled strong-copyleft source is rejected and bundled notices are required", () => {
  const value = fixture({ license: "AGPL-3.0", bundled: true, posture: "bundled", importedPaths: ["src/a"], destinationPaths: ["vendor/a"] });
  value.lock.locks[0].license = "AGPL-3.0";
  value.noticesText = "";
  const result = validateOssRegistry(value);
  assert.match(result.errors.join("\n"), /strong-copyleft/i);
  assert.match(result.errors.join("\n"), /THIRD_PARTY_NOTICES/i);
});

test("documented one-to-many donor/package mappings do not create false path-count warnings", () => {
  const value = fixture({
    importedPaths: ["packages/core"],
    destinationPaths: ["npm:core@1.0.0", "src/adapter.ts"],
    pathMappingNote: "One upstream package maps to its pinned npm package and a LiOS adapter; these are not vendored copies.",
  });
  const result = validateOssRegistry(value);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);

  delete value.registry.components[0].pathMappingNote;
  assert.match(validateOssRegistry(value).warnings.join("\n"), /different imported\/destination path counts/i);
});


test("OSS registry validates subsystem classifications and upstream paths", () => {
  const value = fixture({
    subsystems: [{
      name: "workspace",
      classification: "invented",
      paths: [],
    }],
  });
  const result = validateOssRegistry(value);
  assert.match(result.errors.join("\n"), /invalid classification/i);
  assert.match(result.errors.join("\n"), /must record upstream paths/i);
});


test("workspace benchmark pins must stay aligned and select exactly one candidate", () => {
  const registry = {
    components: [
      { id: "dockview", repository: "dockview/dockview", commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", license: "MIT" },
      { id: "flexlayout", repository: "caplin/FlexLayout", commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", license: "MIT" },
    ],
  };
  const benchmark = {
    schemaVersion: "1",
    decision: "select_one_for_p1",
    selectedCandidate: "dockview",
    productionDependencyAddedInP0: false,
    currentImplementation: { capabilities: { arbitraryDockDragDrop: false } },
    candidates: [
      { id: "dockview", repository: "dockview/dockview", commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", license: "MIT", p0Verdict: "selected_for_p1" },
      { id: "flexlayout", repository: "caplin/FlexLayout", commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", license: "MIT", p0Verdict: "not_selected" },
    ],
    packagedElectronAcceptance: {
      status: "source_pass_packaged_open",
      sourceEvidence: { status: "pass", commands: ["npm run test:p1", "npm run acceptance:p1"] },
      desktopEvidence: { status: "partial", verified: 2, blocked: 10, blockedIds: Array(10).fill("desktop:evidence") },
    },
    activeP1Implementation: "dockview",
    p1AcceptanceCriteria: ["a", "b", "c", "d", "e"],
  };
  const validation = validateWorkspaceBenchmark(benchmark, registry);
  assert.deepEqual(validation.errors, []);
  assert.deepEqual(validation.warnings, []);
  benchmark.candidates[0].commitSha = "cccccccccccccccccccccccccccccccccccccccc";
  assert.match(validateWorkspaceBenchmark(benchmark, registry).errors.join("\n"), /commit drifted/i);
});

test("workspace benchmark rejects obsolete merge-blocked language after source integration", () => {
  const registry = {
    components: [
      { id: "dockview", repository: "dockview/dockview", commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", license: "MIT" },
      { id: "flexlayout", repository: "caplin/FlexLayout", commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", license: "MIT" },
    ],
  };
  const benchmark = {
    schemaVersion: "1",
    decision: "select_one_for_p1",
    selectedCandidate: "dockview",
    productionDependencyAddedInP0: false,
    currentImplementation: { capabilities: { arbitraryDockDragDrop: true } },
    candidates: [
      { id: "dockview", repository: "dockview/dockview", commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", license: "MIT", p0Verdict: "selected_for_p1" },
      { id: "flexlayout", repository: "caplin/FlexLayout", commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", license: "MIT", p0Verdict: "not_selected" },
    ],
    packagedElectronAcceptance: {
      status: "merge_blocked_until_acceptance",
      sourceEvidence: { status: "pass", commands: ["npm run test:p1"] },
      desktopEvidence: { status: "partial", verified: 2, blocked: 10, blockedIds: Array(10).fill("desktop:evidence") },
    },
    activeP1Implementation: "dockview",
    p1AcceptanceCriteria: ["a", "b", "c", "d", "e"],
  };
  const result = validateWorkspaceBenchmark(benchmark, registry);
  assert.match(result.errors.join("\n"), /distinguish merged source acceptance/i);
});


test("bounded source adaptation postures pass OSS review without allowing unknown categories", () => {
  for (const posture of ["supplemental_bounded_source_adaptation", "adapted_source_component"]) {
    const value = fixture({ posture });
    assert.deepEqual(validateOssRegistry(value).errors, []);
  }
  assert.match(validateOssRegistry(fixture({posture:"unlicensed_full_runtime"})).errors.join("\n"), /invalid posture/);
});

test("bundled bounded adaptation must point at its exact donor heading, not a casual mention", () => {
  const value=fixture({name:"Example adapted subsystem",posture:"supplemental_bounded_source_adaptation",
    bundled:true,noticeHeading:"Example"});
  value.noticesText="## Example — MIT (bounded source adaptation)\\ncopyright";
  assert.deepEqual(validateOssRegistry(value).errors,[]);
  value.noticesText="Example appears only in prose";
  assert.match(validateOssRegistry(value).errors.join("\n"),/THIRD_PARTY_NOTICES/);
  value.noticesText="## Completely Unrelated — MIT";
  assert.match(validateOssRegistry(value).errors.join("\n"),/THIRD_PARTY_NOTICES/);
  value.noticesText="## Example — MIT";
  value.registry.components[0].noticeHeading="Unrelated";
  assert.match(validateOssRegistry(value).errors.join("\n"),/invalid notice heading binding/);
});

test("the major_donor posture (OpenClaw, GM-00) is accepted but still pinned, and unknown postures stay rejected", () => {
  assert.deepEqual(validateOssRegistry(fixture({ posture: "major_donor" })).errors, []);
  const drift = fixture({ posture: "major_donor" });
  drift.lock.locks[0].commitSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  assert.match(validateOssRegistry(drift).errors.join("\n"), /Commit mismatch/i);
  assert.match(validateOssRegistry(fixture({ posture: "unreviewed_import" })).errors.join("\n"), /invalid posture/i);
});
