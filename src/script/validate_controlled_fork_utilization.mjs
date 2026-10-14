/**
 * SI-05.16 controlled mirror audit. No network, import, runtime activation or
 * fork-count target. This only checks recorded provenance against canonical
 * repository-owned donor truth; an observed mirror SHA is NOT an approved pin.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (relativePath) => JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));

export function loadControlledForkInputs() {
  return {
    inventory: readJson("third_party/controlled-fork-utilization.json"),
    registry: readJson("third_party/capability-assimilation.json"),
    pins: readJson("third_party/upstream-lock.json"),
    components: readJson("third_party/components.json"),
    plan: readFileSync(path.join(root, "docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md"), "utf8"),
  };
}

/** Throws on any false identity, reuse-status or pin claim. */
export function validateControlledForkUtilization({ inventory, registry, pins, components, plan }) {
  assert.equal(inventory.schemaVersion, 1);
  assert.equal(inventory.scope, "controlled_fork_snapshot_not_runtime_or_import_approval");
  assert.equal(inventory.canonicalBaseline, "third_party/capability-assimilation.json");
  assert.equal(inventory.canonicalPins, "third_party/upstream-lock.json");
  assert.equal(inventory.canonicalComponents, "third_party/components.json");
  assert.ok(Array.isArray(registry.donors));
  assert.equal(registry.donors.length, inventory.baselineDonorCount, "Do not silently change the 92-donor baseline");
  assert.ok(Array.isArray(inventory.mirrors) && inventory.mirrors.length > 0);
  const ids = new Set();
  const forks = new Set();
  let partiallyIntegrated = 0;
  let documentedOnly = 0;
  let mirrorOnly = 0;
  for (const mirror of inventory.mirrors) {
    assert.match(mirror.id, /^[A-Za-z0-9-]+$/);
    assert.ok(!ids.has(mirror.id), "Duplicate fork identifier");
    ids.add(mirror.id);
    assert.equal(mirror.forkRepository.split("/")[0], inventory.owner);
    assert.ok(!forks.has(mirror.forkRepository), "Duplicate fork repository");
    forks.add(mirror.forkRepository);
    assert.match(mirror.upstreamRepository, /^[^/\s]+\/[^/\s]+$/);
    assert.match(mirror.observedCommit, /^[0-9a-f]{40}$/);
    assert.ok(["main", "master"].includes(mirror.defaultBranch));
    assert.ok(Array.isArray(mirror.si05Workstreams) && mirror.si05Workstreams.length > 0);
    assert.equal(new Set(mirror.si05Workstreams).size, mirror.si05Workstreams.length);
    for (const workstream of mirror.si05Workstreams) {
      assert.match(workstream, /^SI-05\.\d{2}$/);
      assert.ok(plan.includes("**" + workstream + " "), "Unknown SI-05 workstream " + workstream);
    }
    assert.ok(typeof mirror.nextAction === "string" && mirror.nextAction.length >= 60);
    const pinnedComponents = components.components.filter((component) =>
      component.repository?.toLowerCase() === mirror.upstreamRepository.toLowerCase() &&
      component.bundled === true &&
      Array.isArray(component.importedPaths) && component.importedPaths.length > 0 &&
      Array.isArray(component.destinationPaths) && component.destinationPaths.length > 0 &&
      pins.locks.some((lock) => lock.id === component.id &&
        lock.repository?.toLowerCase() === component.repository.toLowerCase() &&
        /^[0-9a-f]{40}$/.test(lock.commitSha) && lock.commitSha === component.commitSha));
    if (mirror.baselineDonorId === null) {
      if (mirror.status === "partially_integrated_pinned_paths") {
        assert.ok(pinnedComponents.length > 0,
          "Unregistered mirror cannot claim an import without exact supplemental component/path/pin provenance");
        partiallyIntegrated++;
      } else {
        assert.equal(mirror.status, "mirror_observed_no_runtime_claim",
          "Unregistered mirror cannot claim a runtime or an import");
        assert.ok(!registry.donors.some((d) =>
          d.repository?.toLowerCase() === mirror.upstreamRepository.toLowerCase()),
          "The mirror has an exact upstream registry match; it needs an explicit baseline id");
        mirrorOnly++;
      }
      continue;
    }
    const donor = registry.donors.find((d) => d.id === mirror.baselineDonorId);
    assert.ok(donor, "Missing baseline donor: " + mirror.baselineDonorId);
    assert.equal(donor.repository.toLowerCase(), mirror.upstreamRepository.toLowerCase(),
      "Mirror upstream cannot be substituted for the approved donor upstream");
    const pinned = pins.locks.find((lock) => lock.id === donor.id);
    if (pinned) assert.equal(pinned.repository.toLowerCase(), donor.repository.toLowerCase(),
      "Approved import pin must reference the canonical upstream, not fork HEAD");
    if (mirror.status === "partially_integrated_pinned_paths") {
      assert.equal(donor.currentTruthStatus, "partially_integrated");
      assert.ok(pinnedComponents.some((component) =>
        component.id === donor.id || component.baselineDonorId === donor.id),
        "Partial integration must have actual imported-path provenance and an exact approved pin");
      partiallyIntegrated++;
    } else {
      assert.equal(mirror.status, "documented_only");
      assert.equal(donor.currentTruthStatus, "documented_only",
        "Documented donor must not be reported as a running engine");
      documentedOnly++;
    }
  }
  return Object.freeze({
    baselineDonors: registry.donors.length,
    controlledMirrors: inventory.mirrors.length,
    partiallyIntegrated,
    documentedOnly,
    mirrorOnly,
    pinnedMirrors: 0, // Fork HEADs are observational; actual approved pins stay in upstream-lock.json.
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validateControlledForkUtilization(loadControlledForkInputs());
  console.log(JSON.stringify({ status: "valid_observation_only", ...result }, null, 2));
}
