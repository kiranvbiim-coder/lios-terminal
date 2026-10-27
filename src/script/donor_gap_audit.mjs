/**
 * Read-only LiOS donor-gap report. Uses the canonical 92-donor status registry;
 * does NOT mark a runtime imported merely because a fork, filename, npm pin,
 * adapted design pattern or catalog entry exists.
 *
 * Run from any directory: node src/script/donor_gap_audit.mjs
 * Prints bounded machine-readable audit JSON to stdout. No files or registries
 * are changed. Installed runtime acceptance is an independent release gate.
 */
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const load = relative => JSON.parse(readFileSync(path.join(root, relative), "utf8"));

const FINISH_OR_IMPORT = new Set([
  "discovered", "documented_only", "partially_integrated",
  "bridge_only", "contract_only_deferred",
]);
const QUALIFY_ALREADY_ADOPTED = new Set([
  "runtime_integrated", "runtime_integrated_optional",
  "runtime_integrated_connector", "provider_integrated_external_runtime",
  "standard_compatible_not_library",
]);
const IGNORE_AS_IMPORT_TARGET = new Set(["rejected", "reference_only"]);
const PIN_PRIORITY = Object.freeze({
  P0_PRIMARY: 0,
  P1_FINISH_GAP: 1,
  P1_STRATEGIC: 2,
  P2_DEPENDENCY_DRIVEN: 3,
});
export const TARGET_PACKAGE_NAMES = Object.freeze({
  "assistant-ui": ["@assistant-ui/react", "assistant-ui"],
  "tool-ui": ["@assistant-ui/tool-ui"],
  "langgraphjs": ["@langchain/langgraph"],
  "perspective": ["@finos/perspective", "@finos/perspective-viewer"],
  "polars": ["nodejs-polars"],
  "univer": ["@univerjs/presets", "@univerjs/preset-sheets-core"],
  "tiptap": ["@tiptap/core", "@tiptap/react"],
  "dockview": ["dockview-react"],
  "apache-echarts": ["echarts"],
  "echarts": ["echarts"],
  "duckdb": ["@duckdb/node-api"],
});

/** A source file/directory or npm reference is a presence check, NOT execution proof. */
export function checkRegisteredDestination(destination, component, present, dependencyVersions) {
  if (typeof destination !== "string" || !destination.trim()) return "unverifiable";
  if (destination.startsWith("npm:")) {
    const spec = destination.slice(4);
    const split = spec.lastIndexOf("@");
    if (split <= 0) return "unverifiable";
    return dependencyVersions[spec.slice(0, split)] === spec.slice(split + 1)
      ? "present" : "missing";
  }
  const based = destination.startsWith("src/") ? destination : `${component?.destinationPathBase ?? "src/"}${destination}`;
  if (!based.startsWith("src/") || based.includes("\\") || based.split("/").some(part => part === "." || part === ".." || part === "")) {
    return "unverifiable";
  }
  return present(based) ? "present" : "missing";
}

export function buildDonorGapReport({ baseline, ledger, components, dependencyVersions = {}, present = () => false }) {
  if (!Array.isArray(baseline?.donors) || baseline.donors.length !== 92
      || !Array.isArray(ledger?.baselineDonors) || ledger.baselineDonors.length !== 92
      || !Array.isArray(components?.components)) throw new Error("Expected the complete canonical 92-donor intake");
  const ledgerById = new Map(ledger.baselineDonors.map(entry => [entry.id, entry]));
  const componentsById = new Map(components.components.map(entry => [entry.id, entry]));
  const statuses = {};
  const rows = baseline.donors.map(donor => {
    const recorded = ledgerById.get(donor.id);
    if (!recorded || recorded.baselineTruthStatus !== donor.currentTruthStatus || recorded.upstreamRepository !== donor.repository) {
      throw new Error(`Donor truth drift: ${donor.id}`);
    }
    const component = componentsById.get(donor.id);
    const destinations = component?.destinationPaths ?? [];
    const checks = destinations.map(dest => ({ target: dest, status: checkRegisteredDestination(dest, component, present, dependencyVersions) }));
    const knownPackageNames = TARGET_PACKAGE_NAMES[donor.id] ?? [];
    const installedKnownPackages = knownPackageNames.filter(name => Boolean(dependencyVersions[name]));
    const group = IGNORE_AS_IMPORT_TARGET.has(donor.currentTruthStatus) ? "exclude_or_reference"
      : FINISH_OR_IMPORT.has(donor.currentTruthStatus) ? "import_or_finish_gap"
        : QUALIFY_ALREADY_ADOPTED.has(donor.currentTruthStatus) ? "qualify_existing_integration" : "review_unknown_status";
    statuses[donor.currentTruthStatus] = (statuses[donor.currentTruthStatus] ?? 0) + 1;
    return {
      id: donor.id,
      repository: donor.repository,
      canonicalOwner: donor.canonicalOwner,
      truthStatus: donor.currentTruthStatus,
      decision: donor.declaredDecision,
      priorityBand: recorded.priorityBand,
      group,
      pinned: Boolean(recorded.sourcePin),
      sourcePathsRecorded: recorded.registeredSourcePaths.length,
      sourceFileAuditComplete: recorded.fullPackageSourceAuditComplete === true,
      donorFullyExhausted: recorded.donorFullyExhausted === true,
      packagedAccepted: recorded.packagedShippingPointAccepted === true,
      localTargetsPresent: checks.filter(x => x.status === "present").length,
      localTargetsMissing: checks.filter(x => x.status === "missing").length,
      localTargetsUnverifiable: checks.filter(x => x.status === "unverifiable").length,
      installedKnownPackages,
      knownPackageCheck: knownPackageNames.length ? "named_packages_checked" : "no_named_package_check",
      nextEvidence: recorded.ownerReviewGate,
      nextPhase: recorded.nextExecutionPhase,
    };
  });
  const sorted = [...rows].sort((a, b) =>
    (PIN_PRIORITY[a.priorityBand] ?? 99) - (PIN_PRIORITY[b.priorityBand] ?? 99)
    || a.id.localeCompare(b.id));
  const groupCounts = Object.fromEntries([...new Set(rows.map(row => row.group))].sort()
    .map(group => [group, rows.filter(row => row.group === group).length]));
  return {
    schemaVersion: 1,
    basis: "current canonical donor ledger + declared package versions + local source target presence",
    caveat: "Catalog, fork, source path and package presence are never native installed runtime, authorized user journey or packaged shipping proof.",
    baselineCount: rows.length,
    countsByStatus: Object.fromEntries(Object.entries(statuses).sort(([a], [b]) => a.localeCompare(b))),
    countsByWorkGroup: groupCounts,
    sourceFileAuditsComplete: rows.filter(row => row.sourceFileAuditComplete).length,
    packagedAccepted: rows.filter(row => row.packagedAccepted).length,
    rows: sorted,
  };
}

export function loadDonorGapReport() {
  const manifest = load("src/package.json");
  const lock = load("src/package-lock.json");
  const direct = { ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.devDependencies };
  const versions = {};
  for (const name of Object.keys(direct)) {
    // npm semver declarations are not installation evidence. Use exact lock values.
    if (lock.packages?.[`node_modules/${name}`]?.version) versions[name] = lock.packages[`node_modules/${name}`].version;
  }
  return buildDonorGapReport({
    baseline: load("third_party/capability-assimilation.json"),
    ledger: load("third_party/universal-donor-adoption.json"),
    components: load("third_party/components.json"),
    dependencyVersions: versions,
    present: target => {
      const full = path.resolve(root, target);
      if (!full.startsWith(root + path.sep) || !existsSync(full)) return false;
      return !lstatSync(full).isSymbolicLink();
    },
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(loadDonorGapReport(), null, 2) + "\n");
}
