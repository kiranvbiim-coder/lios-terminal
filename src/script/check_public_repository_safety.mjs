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

const CONTENT_SIGNATURES = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]{40,}-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, "private key material"],
  [new RegExp("\\bsk-" + "(?:proj|svcacct)-[A-Za-z0-9_-]{20,}\\b"), "OpenAI API token"],
  [new RegExp("\\bsk-" + "ant-[A-Za-z0-9_-]{20,}\\b"), "Anthropic API token"],
  [new RegExp("\\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\\b"), "GitHub token"],
  [/(?:AWS_ACCESS_KEY_ID|LIOS_[A-Z0-9_]*ACCESS_KEY_ID)\s*[:=]\s*["']?(?:AKIA|ASIA)(?![0-9A-Z]{0,16}EXAMPLE)[0-9A-Z]{16}\b/, "AWS access key assignment"],
  [new RegExp("\\bxox[baprs]-[A-Za-z0-9-]{20,}\\b"), "Slack token"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "Google API key"],
  [new RegExp("\\b(?:sk|rk)_" + "live_[A-Za-z0-9]{16,}\\b"), "Stripe live secret key"],
];

export function unsafeContent(source) {
  for (const [pattern, hazard] of CONTENT_SIGNATURES) {
    if (pattern.test(source)) return hazard;
  }
  return null;
}

export function unsafeWorkflow(source) {
  const active = source.replace(/^[ \t]*#.*$/gm, "");
  if (/^[ \t]*pull_request_target[ \t]*:/m.test(active)) return "untrusted pull_request_target trigger";
  if (/^[ \t]*workflow_run[ \t]*:/m.test(active)) return "privilege-crossing workflow_run trigger";
  if (/\bself-hosted\b/i.test(active)) return "persistent/self-hosted runner";
  if (/^[ \t]*permissions[ \t]*:[ \t]*write-all\b/m.test(active)) return "write-all token permissions";
  if (/^[ \t]*id-token[ \t]*:[ \t]*write\b/m.test(active)) return "OIDC write permission on public source CI";
  if (/^[ \t]*secrets[ \t]*:[ \t]*inherit\b/m.test(active)) return "inherited secrets in public source CI";
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
  const symlinks = new Set();
  for (const record of records) {
    const divider = record.indexOf("\t");
    if (divider < 0) throw new Error("Unexpected git index record");
    const path = record.slice(divider + 1);
    const mode = record.slice(0, divider).split(" ")[0];
    paths.push(path);
    const hazard = unsafeTrackedPath(path);
    if (hazard) errors.push({ path, hazard });
    if (mode === "120000") {
      symlinks.add(path);
      errors.push({ path, hazard: "symlink in public source" });
    }
  }

  let scannedTextFiles = 0;
  let skippedBinaryFiles = 0;
  for (const path of paths) {
    if (symlinks.has(path)) continue;
    const bytes = readFileSync(join(rootDir, path));
    // NUL is a conservative cross-platform signal for binary content. Scan
    // every other tracked file regardless of extension so credentials hidden
    // in ordinary source/docs/config cannot bypass a filename-only gate.
    if (bytes.includes(0)) {
      skippedBinaryFiles += 1;
      continue;
    }
    scannedTextFiles += 1;
    const hazard = unsafeContent(bytes.toString("utf8"));
    if (hazard) errors.push({ path, hazard });
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
  return { scannedPaths: paths.length, scannedTextFiles, skippedBinaryFiles, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkRepository();
  if (result.errors.length) {
    for (const { path, hazard } of result.errors) {
      const safePath = path.replace(/[\x00-\x1f\x7f]/g, "?").slice(0, 200);
      process.stderr.write("Public-source safeguard failed: " + safePath + " (" + hazard + ")\n");
    }
    process.exitCode = 1;
  } else {
    process.stdout.write(
      "Public-source file, content and workflow guard passed (" + result.scannedPaths +
      " tracked files; " + result.scannedTextFiles + " text files scanned; " +
      result.skippedBinaryFiles + " binary files skipped).\n",
    );
  }
}
