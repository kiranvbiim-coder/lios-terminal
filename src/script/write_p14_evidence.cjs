const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const categories = new Set(["mac_clean_install","windows_clean_install","update_rollback","pack_lifecycle","workspace_restore","recovery","security_privacy","release_rights","performance","voiceover","narrator","keyboard","first_use","flagship"]);
const observationValidators = {
  update_rollback: "validate_p14_update_rollback_evidence.ts",
  pack_lifecycle: "validate_p14_pack_lifecycle_evidence.ts",
  workspace_restore: "validate_p14_workspace_restore_evidence.ts",
};
function fail(message) { process.stderr.write("P14 evidence writer: " + message + "\n"); process.exit(1); }
const [category, outputPath, evidenceKind, releaseTag, ...sourcePaths] = process.argv.slice(2);
if (!categories.has(category)) fail("unknown evidence category: " + String(category || ""));
if (!outputPath) fail("output path is required");
if (!["automated", "human_assisted"].includes(evidenceKind)) fail("evidence kind must be automated or human_assisted");
if (!releaseTag || !releaseTag.trim()) fail("release tag is required");
if (!sourcePaths.length) fail("at least one source artifact is required");
const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"));
const packageVersion = String(packageJson.version || "").trim();
const normalizedTag = releaseTag.trim().replace(/^v/, "");
if (!packageVersion || normalizedTag !== packageVersion) fail("release tag " + releaseTag + " does not match package version " + packageVersion);

const observationValidator = observationValidators[category];
if (observationValidator) {
  const observationPath = path.resolve(sourcePaths[0]);
  const validation = spawnSync(process.execPath, [
    "--import",
    "tsx",
    path.resolve(__dirname, observationValidator),
    observationPath,
  ], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    env: process.env,
  });
  if (validation.error || validation.signal || validation.status !== 0) {
    fail(category + " observation failed validation");
  }

  let observation;
  try {
    observation = JSON.parse(fs.readFileSync(observationPath, "utf8"));
  } catch {
    fail(category + " observation could not be read after validation");
  }
  const requiredSupportRaw = Array.isArray(observation.sourceEvidence) ? observation.sourceEvidence : [];
  const requiredSupport = requiredSupportRaw.map((identifier) => {
    if (typeof identifier !== "string") {
      fail(category + " sourceEvidence identifiers must be unique basenames");
    }
    const normalized = identifier.trim();
    if (!normalized || normalized === "." || normalized === ".." || normalized.includes("/") || normalized.includes("\\")) {
      fail(category + " sourceEvidence identifiers must be unique basenames");
    }
    return normalized;
  });
  if (new Set(requiredSupport).size !== requiredSupport.length) {
    fail(category + " sourceEvidence identifiers must be unique basenames");
  }
  const suppliedSupport = sourcePaths.slice(1).map((sourcePath) => path.basename(path.resolve(sourcePath)));
  if (new Set(suppliedSupport).size !== suppliedSupport.length) {
    fail(category + " support artifacts must have unique basenames");
  }
  for (const identifier of requiredSupport) {
    if (!suppliedSupport.includes(identifier)) {
      fail(category + " support artifact named by observation was not supplied: " + identifier);
    }
  }
}

const sourceArtifacts = sourcePaths.map((sourcePath) => {
  const resolved = path.resolve(sourcePath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) fail("source artifact does not exist: " + resolved);
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(resolved)).digest("hex");
  return { name: path.basename(resolved), sha256 };
});
const evidence = { schemaVersion: "1", category, status: "passed", releaseTag: releaseTag.trim(), packageVersion, generatedAt: new Date().toISOString(), evidenceKind, platform: process.platform + "-" + process.arch, sourceArtifacts, notes: [] };
const resolvedOut = path.resolve(outputPath);
fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
fs.writeFileSync(resolvedOut, JSON.stringify(evidence, null, 2) + "\n", "utf8");
process.stdout.write("P14 evidence written: " + resolvedOut + "\n");
