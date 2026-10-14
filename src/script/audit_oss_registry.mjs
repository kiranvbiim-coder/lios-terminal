#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SHA_RE = /^[a-f0-9]{40}$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ALLOWED_POSTURES = new Set(["donor_candidate", "runtime_candidate", "reference_only", "bundled", "major_donor", "supplemental_bounded_source_adaptation", "adapted_source_component"]);
const ALLOWED_CLASSIFICATIONS = new Set(["production", "adapt", "stub", "reject"]);
const ALLOWED_EXTERNAL_RIGHTS = new Set(["separate_review_required", "verified_not_applicable", "approved"]);
const ALLOWED_SUBSYSTEM_CLASSIFICATIONS = new Set(["production", "adapt", "stub", "reject"]);
const STRONG_COPYLEFT = /(AGPL|GPL(?:-|\b)|SSPL|BUSL|Elastic License|Commons Clause)/i;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function expect(condition, message, errors) {
  if (!condition) errors.push(message);
}

export function validateOssRegistry({ registry, lock, noticesText = "" }) {
  const errors = [];
  const warnings = [];

  expect(registry?.schemaVersion === "1", "components.json schemaVersion must be 1.", errors);
  expect(lock?.schemaVersion === "1", "upstream-lock.json schemaVersion must be 1.", errors);
  expect(Array.isArray(registry?.components), "components.json must contain a components array.", errors);
  expect(Array.isArray(lock?.locks), "upstream-lock.json must contain a locks array.", errors);
  if (errors.length) return { errors, warnings, componentCount: 0 };

  const components = registry.components;
  const locks = lock.locks;
  const ids = new Set();
  const lockById = new Map();

  for (const item of locks) {
    if (!item || typeof item !== "object") {
      errors.push("upstream-lock.json contains a malformed entry.");
      continue;
    }
    if (lockById.has(item.id)) errors.push(`Duplicate upstream lock id: ${item.id}`);
    lockById.set(item.id, item);
    expect(typeof item.id === "string" && item.id.length > 0, "Every upstream lock needs an id.", errors);
    expect(typeof item.repository === "string" && REPO_RE.test(item.repository), `Invalid repository for lock ${item.id ?? "unknown"}.`, errors);
    expect(typeof item.commitSha === "string" && SHA_RE.test(item.commitSha), `Invalid 40-character commit SHA for lock ${item.id ?? "unknown"}.`, errors);
    expect(typeof item.license === "string" && item.license.trim().length > 0, `Missing license for lock ${item.id ?? "unknown"}.`, errors);
  }

  for (const component of components) {
    if (!component || typeof component !== "object") {
      errors.push("components.json contains a malformed component.");
      continue;
    }

    const id = String(component.id ?? "");
    expect(Boolean(id), "Every component needs an id.", errors);
    if (ids.has(id)) errors.push(`Duplicate component id: ${id}`);
    ids.add(id);

    expect(typeof component.name === "string" && component.name.trim().length > 0, `Component ${id} is missing a name.`, errors);
    expect(typeof component.repository === "string" && REPO_RE.test(component.repository), `Component ${id} has an invalid repository.`, errors);
    expect(typeof component.commitSha === "string" && SHA_RE.test(component.commitSha), `Component ${id} must pin an exact 40-character commit SHA.`, errors);
    expect(typeof component.license === "string" && component.license.trim().length > 0, `Component ${id} is missing license metadata.`, errors);
    expect(ALLOWED_POSTURES.has(component.posture), `Component ${id} has invalid posture ${component.posture}.`, errors);
    expect(ALLOWED_CLASSIFICATIONS.has(component.classification), `Component ${id} has invalid classification ${component.classification}.`, errors);
    expect(ALLOWED_EXTERNAL_RIGHTS.has(component.externalRights), `Component ${id} must declare external-rights status.`, errors);
    expect(Array.isArray(component.roles), `Component ${id} must declare LiOS roles.`, errors);
    expect(Array.isArray(component.importedPaths), `Component ${id} must declare importedPaths.`, errors);
    expect(Array.isArray(component.destinationPaths), `Component ${id} must declare destinationPaths.`, errors);
    expect(Array.isArray(component.modifications), `Component ${id} must declare modifications.`, errors);
    expect(typeof component.bundled === "boolean", `Component ${id} must declare bundled status.`, errors);
    expect(typeof component.noticeRequiredOnImport === "boolean", `Component ${id} must declare noticeRequiredOnImport.`, errors);

    if (component.subsystems !== undefined) {
      expect(Array.isArray(component.subsystems), `Component ${id} subsystems must be an array.`, errors);
      if (Array.isArray(component.subsystems)) {
        const names = new Set();
        for (const subsystem of component.subsystems) {
          if (!subsystem || typeof subsystem !== "object") {
            errors.push(`Component ${id} contains a malformed subsystem entry.`);
            continue;
          }
          expect(typeof subsystem.name === "string" && subsystem.name.trim().length > 0, `Component ${id} subsystem is missing a name.`, errors);
          if (names.has(subsystem.name)) errors.push(`Component ${id} has duplicate subsystem name ${subsystem.name}.`);
          names.add(subsystem.name);
          expect(ALLOWED_SUBSYSTEM_CLASSIFICATIONS.has(subsystem.classification), `Component ${id} subsystem ${subsystem.name ?? "unknown"} has invalid classification ${subsystem.classification}.`, errors);
          expect(Array.isArray(subsystem.paths) && subsystem.paths.length > 0, `Component ${id} subsystem ${subsystem.name ?? "unknown"} must record upstream paths.`, errors);
          if (subsystem.requirements !== undefined) {
            expect(Array.isArray(subsystem.requirements), `Component ${id} subsystem ${subsystem.name ?? "unknown"} requirements must be an array.`, errors);
          }
        }
      }
    }

    if (component.dependencyNotes !== undefined) {
      expect(Array.isArray(component.dependencyNotes), `Component ${id} dependencyNotes must be an array.`, errors);
    }

    const identifyingText = [id, component.name, component.repository].join(" ");
    if (/openbb/i.test(identifyingText)) {
      errors.push(`OpenBB is explicitly excluded from LiOS P0 but appears in OSS registry entry ${id}.`);
    }

    const pinned = lockById.get(id);
    if (!pinned) {
      errors.push(`Component ${id} is missing from upstream-lock.json.`);
    } else {
      if (pinned.repository !== component.repository) errors.push(`Repository mismatch for ${id} between registry and upstream lock.`);
      if (pinned.commitSha !== component.commitSha) errors.push(`Commit mismatch for ${id} between registry and upstream lock.`);
      if (pinned.license !== component.license) errors.push(`License mismatch for ${id} between registry and upstream lock.`);
    }

    if (component.bundled === true) {
      if (STRONG_COPYLEFT.test(component.license)) {
        errors.push(`Bundled component ${id} uses a strong-copyleft/restricted license (${component.license}) without an explicit separate licensing decision.`);
      }
      if (!component.importedPaths.length && component.posture !== "bundled") {
        warnings.push(`Bundled component ${id} has no importedPaths recorded.`);
      }
      // Historic bundled packages have existing notices in section bullets;
      // retain their established inclusion check. New path-adapted sources
      // must bind an explicit exact upstream legal notice heading.
      if (component.noticeHeading === undefined) {
        if (!noticesText.toLowerCase().includes(String(component.name).toLowerCase())) {
          errors.push(`Bundled component ${id} is missing from THIRD_PARTY_NOTICES.md.`);
        }
      } else {
        const heading = String(component.noticeHeading).trim();
        const token = id.split("-")[0].toLowerCase();
        if (!heading ||
            !(heading.toLowerCase().includes(token) || id.toLowerCase().includes(heading.toLowerCase()))) {
          errors.push(`Bundled component ${id} has an invalid notice heading binding.`);
        }
        // A paragraph mentioning a donor does not meet this gate.
        const legalHeading = `## ${heading.toLowerCase()} — `;
        const headings = noticesText.split(/\r?\n/).map(line=>line.trim().toLowerCase());
        if (!headings.some(line=>line.startsWith(legalHeading))) {
          errors.push(`Bundled component ${id} is missing from THIRD_PARTY_NOTICES.md.`);
        }
      }
    }

    if (
      component.importedPaths.length !== component.destinationPaths.length &&
      component.importedPaths.length &&
      component.destinationPaths.length &&
      (typeof component.pathMappingNote !== "string" || component.pathMappingNote.trim().length < 40)
    ) {
      warnings.push(`Component ${id} has different imported/destination path counts; verify mapping manually.`);
    }

    if (STRONG_COPYLEFT.test(component.license) && component.bundled !== true) {
      warnings.push(`Component ${id} has a high-obligation license and remains non-bundled; keep it isolated unless explicitly approved.`);
    }
  }

  for (const id of lockById.keys()) {
    if (!ids.has(id)) errors.push(`Upstream lock ${id} has no matching component registry entry.`);
  }

  return {
    errors,
    warnings,
    componentCount: components.length,
  };
}

export function validateWorkspaceBenchmark(benchmark, registry) {
  const errors = [];
  const warnings = [];
  expect(benchmark?.schemaVersion === "1", "workspace-layout-benchmark.json schemaVersion must be 1.", errors);
  expect(benchmark?.decision === "select_one_for_p1", "Workspace benchmark must select exactly one P1 candidate.", errors);
  expect(benchmark?.productionDependencyAddedInP0 === false, "P0 must not replace the stable workspace before packaged Electron acceptance.", errors);
  expect(Array.isArray(benchmark?.candidates) && benchmark.candidates.length === 2, "Workspace benchmark must compare exactly Dockview and FlexLayout during P0.", errors);
  if (Array.isArray(benchmark?.candidates)) {
    const registryById = new Map((registry?.components ?? []).map((component) => [component.id, component]));
    const selected = benchmark.candidates.filter((candidate) => candidate.p0Verdict === "selected_for_p1");
    expect(selected.length === 1, "Workspace benchmark must mark exactly one selected_for_p1 candidate.", errors);
    expect(benchmark.selectedCandidate === selected[0]?.id, "selectedCandidate must match the selected_for_p1 candidate.", errors);
    for (const candidate of benchmark.candidates) {
      const component = registryById.get(candidate.id);
      if (!component) {
        errors.push(`Workspace candidate ${candidate.id ?? "unknown"} is missing from components.json.`);
        continue;
      }
      if (component.repository !== candidate.repository) errors.push(`Workspace candidate ${candidate.id} repository drifted from components.json.`);
      if (component.commitSha !== candidate.commitSha) errors.push(`Workspace candidate ${candidate.id} commit drifted from components.json.`);
      if (component.license !== candidate.license) errors.push(`Workspace candidate ${candidate.id} license drifted from components.json.`);
      if (!["selected_for_p1", "not_selected"].includes(candidate.p0Verdict)) {
        errors.push(`Workspace candidate ${candidate.id} has invalid P0 verdict ${candidate.p0Verdict}.`);
      }
    }
  }
  expect(Array.isArray(benchmark?.p1AcceptanceCriteria) && benchmark.p1AcceptanceCriteria.length >= 5, "Workspace benchmark needs explicit P1 acceptance criteria.", errors);
  expect(
    benchmark?.packagedElectronAcceptance?.status === "source_pass_packaged_open",
    "Workspace benchmark must distinguish merged source acceptance from still-open packaged desktop evidence.",
    errors,
  );
  expect(
    benchmark?.packagedElectronAcceptance?.sourceEvidence?.status === "pass" &&
      Array.isArray(benchmark.packagedElectronAcceptance.sourceEvidence.commands),
    "Workspace benchmark must record source acceptance separately from packaged acceptance.",
    errors,
  );
  expect(
    benchmark?.packagedElectronAcceptance?.desktopEvidence?.status === "partial" &&
      benchmark.packagedElectronAcceptance.desktopEvidence.blocked > 0 &&
      Array.isArray(benchmark.packagedElectronAcceptance.desktopEvidence.blockedIds) &&
      benchmark.packagedElectronAcceptance.desktopEvidence.blockedIds.length === benchmark.packagedElectronAcceptance.desktopEvidence.blocked,
    "Workspace benchmark must keep incomplete desktop evidence explicit.",
    errors,
  );
  expect(
    benchmark?.activeP1Implementation === benchmark?.selectedCandidate,
    "Current P1 implementation must match the selected workspace candidate.",
    errors,
  );
  return { errors, warnings };
}

export function auditOssRegistry(repoRoot) {
  const registryPath = path.join(repoRoot, "third_party", "components.json");
  const lockPath = path.join(repoRoot, "third_party", "upstream-lock.json");
  const benchmarkPath = path.join(repoRoot, "third_party", "workspace-layout-benchmark.json");
  const noticesPath = path.join(repoRoot, "THIRD_PARTY_NOTICES.md");
  const registry = readJson(registryPath);
  const lock = readJson(lockPath);
  const benchmark = readJson(benchmarkPath);
  const noticesText = fs.readFileSync(noticesPath, "utf8");
  const result = validateOssRegistry({ registry, lock, noticesText });
  const benchmarkResult = validateWorkspaceBenchmark(benchmark, registry);
  result.errors.push(...benchmarkResult.errors);
  result.warnings.push(...benchmarkResult.warnings);

  for (const warning of result.warnings) console.warn(`WARN oss-registry: ${warning}`);
  if (result.errors.length) {
    throw new Error(`OSS registry audit failed:\n- ${result.errors.join("\n- ")}`);
  }
  console.log(`OSS registry audit passed: ${result.componentCount} pinned major components; warnings=${result.warnings.length}.`);
  return result;
}

const isCli = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isCli) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  try {
    auditOssRegistry(repoRoot);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
