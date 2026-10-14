import fs from "node:fs";
import { execFileSync } from "node:child_process";
import {
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type PreflightMode = "ci" | "desktop";

export interface CheckResult {
  id: string;
  pass: boolean;
  required: boolean;
  scope: CheckScope;
  detail: string;
}

export interface PreflightOptions {
  mode?: PreflightMode;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  platform?: NodeJS.Platform;
  existsSync?: (target: fs.PathLike) => boolean;
  readFileSync?: (target: fs.PathLike) => string;
  execFile?: (file: string, args: readonly string[]) => string;
}

interface MigrationDescriptor {
  tag: string;
  filename: string;
}

interface MigrationJournalResult {
  latest: MigrationDescriptor | null;
  error: string | null;
}

function hasEnv(env: NodeJS.ProcessEnv, name: string): boolean {
  return Boolean(env[name]?.trim());
}

function validateDesktopUpdateFeed(raw: string | undefined): string | null {
  const value = String(raw || "").trim();
  if (!value) return "Set LIOS_UPDATE_URL to the public HTTPS directory that hosts desktop update metadata and artifacts.";
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return "LIOS_UPDATE_URL must use HTTPS.";
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local") ||
      host.endsWith(".invalid")
    ) {
      return "LIOS_UPDATE_URL must be a customer-reachable public HTTPS feed, not a local or reserved host.";
    }
    return null;
  } catch {
    return "LIOS_UPDATE_URL is not a valid URL.";
  }
}

function readLatestMigration(
  journalPath: string,
  readFileSync: (target: fs.PathLike) => string,
): MigrationJournalResult {
  let journal: unknown;
  try {
    journal = JSON.parse(readFileSync(journalPath));
  } catch (error) {
    return {
      latest: null,
      error: `Migration journal is missing or unreadable at ${journalPath}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let entries: unknown;
  if (journal && typeof journal === "object" && "entries" in journal) {
    entries = journal.entries;
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      latest: null,
      error: `Migration journal at ${journalPath} does not contain any entries.`,
    };
  }

  const latestEntry = entries.at(-1);
  let tag: unknown;
  if (latestEntry && typeof latestEntry === "object" && "tag" in latestEntry) {
    tag = latestEntry.tag;
  }
  if (typeof tag !== "string" || !/^\d+_[A-Za-z0-9][A-Za-z0-9_-]*$/.test(tag)) {
    return {
      latest: null,
      error: `Migration journal at ${journalPath} has an invalid latest migration tag.`,
    };
  }

  return {
    latest: { tag, filename: `${tag}.sql` },
    error: null,
  };
}

function migrationCheck(
  id: string,
  descriptor: MigrationDescriptor | null,
  journalError: string | null,
  migrationRoot: string,
  existsSync: (target: fs.PathLike) => boolean,
  required: boolean,
  label: string,
): CheckResult {
  if (journalError || !descriptor) {
    return {
      id,
      pass: false,
      required,
      scope: "code",
      detail: journalError ?? "Unable to derive the latest migration from the journal.",
    };
  }

  const migrationPath = path.resolve(migrationRoot, descriptor.filename);
  const present = existsSync(migrationPath);
  return {
    id,
    pass: present,
    required,
    scope: "code",
    detail: present
      ? `${label} migration ${descriptor.tag} from the migration journal is present.`
      : `${label} migration ${descriptor.tag} from the migration journal is missing at ${migrationPath}.`,
  };
}


function parseMode(argv: string[]): PreflightMode {
  const modeArg = argv.find((arg) => arg.startsWith("--mode="));
  if (!modeArg) return "desktop";
  const rawMode = modeArg.slice("--mode=".length);
  if (rawMode !== "ci" && rawMode !== "desktop") {
    throw new Error(`Unsupported preflight mode: ${rawMode}`);
  }
  return rawMode;
}

function ed25519RuntimeSelfTest(): string | null {
  try {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const probe = Buffer.from("lios-ci-ed25519-self-test-v1", "utf8");
    const signature = sign(null, probe, privateKey);
    if (!verify(null, probe, publicKey, signature)) {
      return "Node Ed25519 sign/verify self-test failed.";
    }
    return null;
  } catch (error) {
    return `Node Ed25519 self-test failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function makeExternalResult(
  mode: PreflightMode,
  id: string,
  pass: boolean,
  detail: string,
  required = false,
): CheckResult {
  return {
    id,
    pass,
    required,
    scope: "external",
    detail,
  };
}

function hasValidAppleSigningIdentity(output: string): boolean {
  return /(?:^|\s)(?:[1-9]\d*)\s+valid identities found\b/i.test(output) ||
    /Developer ID Application:/i.test(output);
}

function hasMacNotarizationCredentials(env: NodeJS.ProcessEnv): boolean {
  const apiKeyAuth =
    hasEnv(env, "APPLE_API_KEY") &&
    hasEnv(env, "APPLE_API_KEY_ID") &&
    hasEnv(env, "APPLE_API_ISSUER");
  const appleIdAuth =
    hasEnv(env, "APPLE_ID") &&
    hasEnv(env, "APPLE_APP_SPECIFIC_PASSWORD") &&
    hasEnv(env, "APPLE_TEAM_ID");
  const keychainAuth =
    hasEnv(env, "APPLE_KEYCHAIN") &&
    hasEnv(env, "APPLE_KEYCHAIN_PROFILE");
  return apiKeyAuth || appleIdAuth || keychainAuth;
}

function pythonVersionError(output: string): string | null {
  const match = output.match(/\bPython\s+(\d+)\.(\d+)(?:\.(\d+))?/i);
  if (!match) return "Python version output is not recognizable.";
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major !== 3 || minor < 11 || minor >= 14) {
    return `Supported Python runtime is >=3.11,<3.14; detected Python ${major}.${minor}${match[3] ? `.${match[3]}` : ""}.`;
  }
  return null;
}

export function collectPreflightChecks(options: PreflightOptions = {}): CheckResult[] {
  const mode = options.mode ?? "desktop";
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const platform = options.platform ?? process.platform;
  const exists = options.existsSync ?? fs.existsSync;
  const readFile =
    options.readFileSync ??
    ((target: fs.PathLike) => fs.readFileSync(target, "utf8"));
  const execFile =
    options.execFile ??
    ((file: string, args: readonly string[]) =>
      execFileSync(file, [...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim());

  const migrationsRoot = path.resolve(cwd, "migrations");
  const journalPath = path.join(migrationsRoot, "meta", "_journal.json");
  const journalResult = readLatestMigration(journalPath, readFile);
  const sourceMigration = migrationCheck(
    "source_migration",
    journalResult.latest,
    journalResult.error,
    migrationsRoot,
    exists,
    true,
    "Latest",
  );
  const resourceRoot = env.ELECTRON_RESOURCES_PATH?.trim();
  const packagedMigration = resourceRoot
    ? migrationCheck(
        "packaged_migration",
        journalResult.latest,
        journalResult.error,
        path.resolve(resourceRoot, "migrations"),
        exists,
        true,
        "Packaged latest",
      )
    : {
        id: "packaged_migration",
        pass: true,
        required: false,
        scope: "code" as const,
        detail: "No ELECTRON_RESOURCES_PATH is configured; packaged migration validation is skipped for development.",
      };
  const productionEnvironment = env.NODE_ENV === "production";
  const legacyHmacDisabled = env.LIMURIA_ALLOW_LEGACY_HMAC_LICENSE_LEASE !== "true";
  const legacyDeviceHeaderDisabled = env.LIMURIA_ALLOW_LEGACY_DEVICE_FINGERPRINT_HEADER !== "true";
  const legacyDefaultAdminRemoved = ![
    "LIMURIA_STANDARD_ADMIN_PASSWORD",
    "LIMURIA_DISABLE_STANDARD_ADMIN_PASSWORD",
    "LIMURIA_BOOTSTRAP_USE_STANDARD_ADMIN",
  ].some((name) => hasEnv(env, name));
  const results: CheckResult[] = [
    sourceMigration,
    packagedMigration,
    {
      id: "production_node_env",
      pass: mode === "ci" || productionEnvironment,
      required: true,
      scope: "code",
      detail: mode === "ci" || productionEnvironment
        ? mode === "ci"
          ? "CI capability mode does not require NODE_ENV=production."
          : "NODE_ENV=production is set for the production release preflight."
        : "Production release preflight must run with NODE_ENV=production.",
    },
    {
      id: "legacy_hmac_disabled",
      pass: legacyHmacDisabled,
      required: true,
      scope: "code",
      detail: legacyHmacDisabled
        ? "Legacy HMAC license-lease migration mode is disabled."
        : "Unset LIMURIA_ALLOW_LEGACY_HMAC_LICENSE_LEASE before release.",
    },
    {
      id: "legacy_device_header_disabled",
      pass: legacyDeviceHeaderDisabled,
      required: true,
      scope: "code",
      detail: legacyDeviceHeaderDisabled
        ? "Legacy client-supplied device fingerprint migration mode is disabled."
        : "Unset LIMURIA_ALLOW_LEGACY_DEVICE_FINGERPRINT_HEADER before release.",
    },
    {
      id: "legacy_default_admin_removed",
      pass: legacyDefaultAdminRemoved,
      required: true,
      scope: "code",
      detail: legacyDefaultAdminRemoved
        ? "Legacy standard/default administrator credential switches are absent."
        : "Remove legacy standard/default administrator credential environment switches before release.",
    },
  ];

  if (mode === "desktop") {
    const localOnly = !hasEnv(env, "DATABASE_URL");
    results.push({
      id: "desktop_local_database",
      pass: localOnly,
      required: true,
      scope: "code",
      detail: localOnly
        ? "Desktop release has no DATABASE_URL and will use local-first storage."
        : "Unset DATABASE_URL for a local desktop release.",
    });

    const sidecarExecutable = path.resolve(
      cwd,
      "python-sidecar-dist",
      "lios-python-sidecar",
      platform === "win32" ? "lios-python-sidecar.exe" : "lios-python-sidecar",
    );
    const bundledSidecarReady = exists(sidecarExecutable);
    results.push({
      id: "desktop_python_sidecar_bundle",
      pass: bundledSidecarReady,
      required: true,
      scope: "code",
      detail: bundledSidecarReady
        ? `Self-contained Python sidecar is staged for packaging at ${sidecarExecutable}.`
        : `Build the platform Python sidecar before desktop preflight: npm run python:sidecar:build (expected ${sidecarExecutable}).`,
    });
  }
  if (mode === "ci") {
    const cryptoError = ed25519RuntimeSelfTest();
    results.push({
      id: "asymmetric_license_crypto",
      pass: !cryptoError,
      required: true,
      scope: "code",
      detail: cryptoError ?? "Node Ed25519 sign/verify runtime self-test passed.",
    });
    results.push(
      makeExternalResult(
        mode,
        "asymmetric_license_keys",
        false,
        "Production Ed25519 license keys are intentionally not required in PR CI; the licence key pair is validated outside PR CI.",
      ),
    );
  } else {
    results.push(
      makeExternalResult(
        mode,
        "asymmetric_license_keys",
        false,
        "Desktop releases do not issue license leases; local activation uses the installed application and user-owned data.",
      ),
    );
  }

  const betaDir = env.LIOS_BETA_DATA_DIR?.trim();
  const betaDataPresent = Boolean(betaDir && exists(path.resolve(cwd, betaDir)));
  results.push(
    makeExternalResult(
      mode,
      "beta_data",
      betaDataPresent,
      betaDataPresent
        ? "Approved beta data directory exists."
        : "Set LIOS_BETA_DATA_DIR to real approved client/provider data before a production release.",
    ),
  );

  const updateFeedError = validateDesktopUpdateFeed(env.LIOS_UPDATE_URL);
  if (mode === "desktop") {
    results.push(
      makeExternalResult(
        mode,
        "desktop_update_feed",
        !updateFeedError,
        updateFeedError ?? "Customer-reachable HTTPS desktop update feed is configured.",
        true,
      ),
    );
  } else {
    results.push(
      makeExternalResult(
        mode,
        "desktop_update_feed",
        false,
        mode === "ci"
          ? "Desktop update hosting is production evidence and is intentionally external to PR capability CI."
          : "Desktop update feed is not required for this mode.",
        false,
      ),
    );
  }

  try {
    const version = execFile(env.PYTHON_EXECUTABLE || "python3", ["--version"]).trim();
    const versionError = pythonVersionError(version);
    results.push({
      id: "python",
      pass: !versionError,
      required: true,
      scope: "code",
      detail: versionError ?? `${version} detected.`,
    });
  } catch {
    results.push({
      id: "python",
      pass: false,
      required: true,
      scope: "code",
      detail: "No usable Python executable detected.",
    });
  }

  if (mode === "ci") {
    results.push(
      makeExternalResult(
        mode,
        "desktop_signing",
        false,
        "Desktop signing is intentionally not required on the CI capability runner; the platform release job must sign the target artifact.",
      ),
    );
  } else if (platform === "darwin") {
    const certificateSecretConfigured = hasEnv(env, "CSC_LINK") && hasEnv(env, "CSC_KEY_PASSWORD");
    let keychainIdentityDetected = false;
    try {
      const identities = execFile("security", ["find-identity", "-v", "-p", "codesigning"]);
      keychainIdentityDetected = hasValidAppleSigningIdentity(identities);
    } catch {
      keychainIdentityDetected = false;
    }
    const signingConfigured = certificateSecretConfigured || keychainIdentityDetected;
    results.push(
      makeExternalResult(
        mode,
        "desktop_signing",
        signingConfigured,
        certificateSecretConfigured
          ? "macOS signing certificate is supplied through CSC_LINK/CSC_KEY_PASSWORD; the packaged artifact must still pass codesign verification."
          : keychainIdentityDetected
            ? "Developer ID Application signing identity detected in the macOS keychain."
            : "Provide CSC_LINK/CSC_KEY_PASSWORD or install a valid Developer ID Application identity.",
        true,
      ),
    );
  } else if (platform === "win32") {
    const certificateConfigured = hasEnv(env, "CSC_LINK") && hasEnv(env, "CSC_KEY_PASSWORD");
    results.push(
      makeExternalResult(
        mode,
        "desktop_signing",
        certificateConfigured,
        certificateConfigured
          ? "Windows code-signing certificate is configured."
          : "Set CSC_LINK and CSC_KEY_PASSWORD for signed Windows artifacts.",
        true,
      ),
    );
  } else {
    results.push(
      makeExternalResult(
        mode,
        "desktop_signing",
        false,
        `Desktop release must run on macOS or Windows for platform signing; current platform is ${platform}.`,
        true,
      ),
    );
  }

  if (mode === "ci") {
    results.push(
      makeExternalResult(
        mode,
        "desktop_notarization",
        false,
        "macOS notarization credentials are intentionally not required in CI capability mode; the release job validates the notarized artifact.",
        false,
      ),
    );
  } else if (platform === "darwin") {
    const notarizationConfigured = hasMacNotarizationCredentials(env);
    results.push(
      makeExternalResult(
        mode,
        "desktop_notarization",
        notarizationConfigured,
        notarizationConfigured
          ? "macOS notarization credentials are configured; the release workflow must still verify the stapled ticket."
          : "Configure APPLE_API_KEY/API_KEY_ID/API_ISSUER, APPLE_ID/APP_SPECIFIC_PASSWORD/TEAM_ID, or an Apple keychain profile.",
        true,
      ),
    );
  } else {
    results.push(
      makeExternalResult(
        mode,
        "desktop_notarization",
        false,
        "Apple notarization is not required for this desktop target.",
        false,
      ),
    );
  }

  return results;
}

export function formatPreflightResult(result: CheckResult): string {
  if (result.pass) return `PASS ${result.id}: ${result.detail}`;
  if (!result.required) return `EXTERNAL ${result.id}: ${result.detail}`;
  return `BLOCKED ${result.id}: ${result.detail}`;
}

export function runPreflight(mode: PreflightMode = "desktop"): number {
  const results = collectPreflightChecks({ mode });
  for (const result of results) console.log(formatPreflightResult(result));

  const reportPath = process.env.LIOS_PREFLIGHT_REPORT?.trim();
  if (reportPath) {
    fs.writeFileSync(
      path.resolve(reportPath),
      `${JSON.stringify({ mode, generatedAt: new Date().toISOString(), results }, null, 2)}\n`,
      "utf8",
    );
  }

  const blocked = results.filter((result) => result.required && !result.pass);
  return blocked.length ? 1 : 0;
}

const isCli = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const mode = parseMode(process.argv.slice(2));
  process.exitCode = runPreflight(mode);
}
