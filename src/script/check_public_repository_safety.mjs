/**
 * Lightweight public-source publication gate. No third-party packages or
 * network calls; no secrets are printed. This is not a substitute for GitHub
 * secret scanning, a full history audit, code review, or release qualification.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function unsafeTrackedPath(path) {
  const normalized = path.replaceAll("\\", "/");
  const name = basename(normalized);
  if (
    /^\.env(?:\..*)?$/i.test(name) &&
    !/^\.env(?:\.[^/]+)*\.(?:example|sample|template)$/i.test(name)
  ) return "non-template environment file";

  if (/^(?:id_(?:rsa|dsa|ecdsa|ed25519)|\.npmrc|\.pypirc|\.netrc)$/i.test(name)) {
    return "local credential file";
  }
  if (/^(?:credentials|service-account|service_account|secrets?)(?:\.[^.]+)?\.(?:json|ya?ml|txt)$/i.test(name)) {
    return "credential-data filename";
  }
  if (/\.(?:pem|p12|pfx|jks|kdbx|sqlite3?|db|bak|dump)$/i.test(name)) {
    return "key or private-data file";
  }
  if (/(?:^|\/)(?:\.ssh|\.aws|\.kube|\.gnupg)(?:\/|$)/i.test(normalized)) {
    return "local credential directory";
  }
  return null;
}

export function unsafeWorkflow(source) {
  // Ignore full-line comments; inspect actionable workflow declarations.
  const active = source.replace(/^[ \t]*#.*$/gm, "");
  if (/^[ \t]*pull_request_target[ \t]*:/m.test(active)) {
    return "untrusted pull_request_target trigger";
  }
  if (/^[ \t]*workflow_run[ \t]*:/m.test(active)) {
    return "privilege-crossing workflow_run trigger";
  }
  if (/\bself-hosted\b/i.test(active)) {
    return "persistent/self-hosted runner";
  }
  if (/^[ \t]*permissions[ \t]*:[ \t]*write-all\b/m.test(active)) {
    return "write-all token permissions";
  }
  if (/^[ \t]*id-token[ \t]*:[ \t]*write\b/m.test(active)) {
    return "OIDC write permission on public source CI";
  }
  if (/^[ \t]*secrets[ \t]*:[ \t]*inherit\b/m.test(active)) {
    return "inherited secrets in public source CI";
  }
  return null;
}

export function checkRepository(rootDir = root) {
  const errors = [];
  const index = execFileSync("git", ["ls-files", "-s", "-z"], {
    cwd: rootDir,
    maxBuffer: 16 * 1024 * 1024,
  }).toString("utf8");
  const records = index.split("\0").filter(Boolean);
  const paths = [];
  for (const record of records) {
    const divider = record.indexOf("\t");
    if (divider < 0) throw new Error("Unexpected git index record");
    const path = record.slice(divider + 1);
    const mode = record.slice(0, divider).split(" ")[0];
    paths.push(path);
    const hazard = unsafeTrackedPath(path);
    if (hazard) errors.push({ path, hazard });
    if (mode === "120000") errors.push({ path, hazard: "symlink in public source" });
  }

  for (const required of [
    "LICENSE",
    "SECURITY.md",
    "THIRD_PARTY_NOTICES.md",
    ".github/CODEOWNERS",
    ".github/workflows/source-cross-platform.yml",
    "src/package-lock.json",
  ]) {
    if (!paths.includes(required)) errors.push({ path: required, hazard: "required control missing" });
  }
  for (const path of paths.filter((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(p))) {
    const hazard = unsafeWorkflow(readFileSync(join(rootDir, path), "utf8"));
    if (hazard) errors.push({ path, hazard });
  }
  return { scannedPaths: paths.length, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkRepository();
  if (result.errors.length) {
    for (const { path, hazard } of result.errors) {
      // Never print file contents or credential values to hosted Actions logs.
      const safePath = path.replace(/[\x00-\x1f\x7f]/g, "?").slice(0, 200);
      process.stderr.write("Public-source safeguard failed: " + safePath + " (" + hazard + ")\n");
    }
    process.exitCode = 1;
  } else {
    process.stdout.write("Public-source file and workflow guard passed (" + result.scannedPaths + " tracked files).\n");
  }
}
