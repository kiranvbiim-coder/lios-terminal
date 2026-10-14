const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const categories = new Set(["mac_clean_install","windows_clean_install","update_rollback","pack_lifecycle","workspace_restore","recovery","security_privacy","release_rights","performance","voiceover","narrator","keyboard","first_use","flagship"]);
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
