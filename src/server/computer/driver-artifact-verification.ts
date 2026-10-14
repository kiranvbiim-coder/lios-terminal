// Imported/adapted from OpenClaw c074824a27c96d3983043f9eeb33823cd1772d8c.
// Copyright (c) 2026 OpenClaw Foundation. MIT; see THIRD_PARTY_NOTICES.md.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import pinnedArtifacts from "./driver-artifacts.json";

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function readStringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function sha256FileSync(pathname: string): { digest: string } {
  const fd = fs.openSync(pathname, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error("Native artifact is not a regular file.");
    const hash = createHash("sha256");
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let bytes: number;
    while ((bytes = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      hash.update(chunk.subarray(0, bytes));
    }
    return { digest: hash.digest("hex") };
  } finally {
    fs.closeSync(fd);
  }
}

const DRIVER_PACKAGE = "@trycua/cua-driver";

type SupportedArtifactPlatform =
  | "linux-arm64-gnu"
  | "linux-x64-gnu"
  | "win32-arm64-msvc"
  | "win32-x64-msvc";

type DriverArtifactRecord = {
  files: Record<string, string>;
};

type CuaDriverManifest = {
  dependencies?: Record<string, string>;
  cuaDriverArtifacts?: Partial<Record<SupportedArtifactPlatform, DriverArtifactRecord>>;
};

type CuaDriverArtifactDiagnosticCode =
  | "COMPUTER_DRIVER_DIGEST_MISMATCH"
  | "COMPUTER_DRIVER_MANIFEST_INVALID"
  | "COMPUTER_DRIVER_PACKAGE_MISSING"
  | "COMPUTER_DRIVER_PLATFORM_UNSUPPORTED"
  | "COMPUTER_DRIVER_VERSION_MISMATCH";

export type CuaDriverArtifactVerification =
  | { ok: true; applicable: true; version: string; platformPackage: string }
  | {
      ok: false;
      code: CuaDriverArtifactDiagnosticCode;
      diagnostic: string;
      fixHint: string;
    };

type CuaDriverArtifactInspectionOptions = {
  platform: NodeJS.Platform;
  arch: string;
  linuxLibc?: "gnu" | "musl";
  pluginManifest?: unknown;
  resolvePackageJson: (packageName: string) => string | undefined;
};

function failure(
  code: CuaDriverArtifactDiagnosticCode,
  message: string,
  fixHint: string,
): CuaDriverArtifactVerification {
  return { ok: false, code, diagnostic: `${code}: ${message} Fix: ${fixHint}`, fixHint };
}

function resolveArtifactPlatform(
  platform: NodeJS.Platform,
  arch: string,
  linuxLibc: "gnu" | "musl" | undefined,
):
  | { kind: "applicable"; key: SupportedArtifactPlatform }
  // LiOS never treats an unverified host (including macOS) as an integrity success.
  | { kind: "unsupported"; host: string } {
  if (platform === "linux") {
    if (linuxLibc !== "gnu" || (arch !== "arm64" && arch !== "x64")) {
      return { kind: "unsupported", host: `${platform}/${arch}/${linuxLibc ?? "unknown-libc"}` };
    }
    return { kind: "applicable", key: `linux-${arch}-gnu` };
  }
  if (platform === "win32") {
    if (arch !== "arm64" && arch !== "x64") {
      return { kind: "unsupported", host: `${platform}/${arch}` };
    }
    return { kind: "applicable", key: `win32-${arch}-msvc` };
  }
  return { kind: "unsupported", host: `${platform}/${arch}` };
}

function readJson(pathname: string): unknown {
  return JSON.parse(fs.readFileSync(pathname, "utf8"));
}

export function readPackageIdentity(pathname: string): { name?: string; version?: string } {
  const record = asOptionalRecord(readJson(pathname));
  if (!record) {
    return {};
  }
  return {
    name: readStringField(record, "name"),
    version: readStringField(record, "version"),
  };
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function loadArtifactRecord(
  manifestValue: unknown,
  key: SupportedArtifactPlatform,
): { version: string; artifact: DriverArtifactRecord } | undefined {
  const value = manifestValue as CuaDriverManifest;
  const version = value.dependencies?.[DRIVER_PACKAGE];
  const artifact = value.cuaDriverArtifacts?.[key];
  if (
    typeof version !== "string" ||
    !/^\d+\.\d+\.\d+$/u.test(version) ||
    !artifact ||
    !artifact.files ||
    Object.keys(artifact.files).length === 0 ||
    Object.entries(artifact.files).some(
      ([filename, digest]) => !filename || filename === "." || filename === ".."
        || path.basename(filename) !== filename || filename.includes("\\") || !isSha256(digest),
    )
  ) {
    return undefined;
  }
  return { version, artifact };
}

export function inspectCuaDriverArtifacts(
  options: CuaDriverArtifactInspectionOptions,
): CuaDriverArtifactVerification {
  const selected = resolveArtifactPlatform(options.platform, options.arch, options.linuxLibc);
  // macOS uses an app-owned daemon, not these SDK native-package artifacts.
  if (selected.kind === "unsupported") {
    const fixHint = "Run this node host on Windows x64/ARM64 or glibc-based Linux x64/ARM64.";
    return failure(
      "COMPUTER_DRIVER_PLATFORM_UNSUPPORTED",
      `this verifier has no approved native file digest for ${selected.host}; macOS requires a separately verified app-owned daemon.`,
      fixHint,
    );
  }

  let accepted: ReturnType<typeof loadArtifactRecord>;
  try {
    accepted = loadArtifactRecord(options.pluginManifest ?? pinnedArtifacts, selected.key);
  } catch {
    accepted = undefined;
  }
  if (!accepted) {
    const fixHint = "Reinstall OpenClaw from a complete official package.";
    return failure(
      "COMPUTER_DRIVER_MANIFEST_INVALID",
      `the cua-computer artifact record for ${selected.key} is missing or invalid.`,
      fixHint,
    );
  }

  const platformPackage = `${DRIVER_PACKAGE}-${selected.key}`;
  const sdkManifestPath = options.resolvePackageJson(DRIVER_PACKAGE);
  const platformManifestPath = options.resolvePackageJson(platformPackage);
  if (!sdkManifestPath || !platformManifestPath) {
    const missing = sdkManifestPath ? platformPackage : DRIVER_PACKAGE;
    const fixHint = `Reinstall OpenClaw on this node host so ${DRIVER_PACKAGE} ${accepted.version} and its native platform package are installed together.`;
    return failure(
      "COMPUTER_DRIVER_PACKAGE_MISSING",
      `${missing} ${accepted.version} is not installed.`,
      fixHint,
    );
  }

  let sdkIdentity: ReturnType<typeof readPackageIdentity>;
  let platformIdentity: ReturnType<typeof readPackageIdentity>;
  try {
    sdkIdentity = readPackageIdentity(sdkManifestPath);
    platformIdentity = readPackageIdentity(platformManifestPath);
  } catch {
    const fixHint =
      "Reinstall OpenClaw on this node host; do not repair native package files by hand.";
    return failure(
      "COMPUTER_DRIVER_PACKAGE_MISSING",
      "the resolved CUA Driver package metadata cannot be read.",
      fixHint,
    );
  }
  if (
    sdkIdentity.name !== DRIVER_PACKAGE ||
    platformIdentity.name !== platformPackage ||
    sdkIdentity.version !== accepted.version ||
    platformIdentity.version !== accepted.version
  ) {
    const observed = `${sdkIdentity.name ?? "unknown"}@${sdkIdentity.version ?? "unknown"} + ${platformIdentity.name ?? "unknown"}@${platformIdentity.version ?? "unknown"}`;
    const fixHint = `Reinstall or update OpenClaw on this node host so both CUA Driver packages resolve to ${accepted.version}.`;
    return failure(
      "COMPUTER_DRIVER_VERSION_MISMATCH",
      `expected ${DRIVER_PACKAGE} and ${platformPackage} ${accepted.version}, resolved ${observed}.`,
      fixHint,
    );
  }

  const packageDir = path.dirname(platformManifestPath);
  for (const [filename, expectedDigest] of Object.entries(accepted.artifact.files).toSorted(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const pathname = path.join(packageDir, filename);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(pathname);
    } catch {
      const fixHint = `Reinstall OpenClaw on this node host to restore ${platformPackage} ${accepted.version}.`;
      return failure(
        "COMPUTER_DRIVER_PACKAGE_MISSING",
        `${platformPackage} is missing ${filename}.`,
        fixHint,
      );
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      const fixHint = "Reinstall OpenClaw; the native driver files must be regular package files.";
      return failure(
        "COMPUTER_DRIVER_DIGEST_MISMATCH",
        `${platformPackage}/${filename} is not a regular file.`,
        fixHint,
      );
    }
    let actualDigest: string;
    try {
      actualDigest = sha256FileSync(pathname).digest;
    } catch {
      const fixHint = `Reinstall OpenClaw on this node host to restore ${platformPackage} ${accepted.version}.`;
      return failure(
        "COMPUTER_DRIVER_PACKAGE_MISSING",
        `${platformPackage}/${filename} cannot be read.`,
        fixHint,
      );
    }
    if (actualDigest !== expectedDigest) {
      const fixHint =
        "Reinstall OpenClaw; do not run or replace the mismatched native package files.";
      return failure(
        "COMPUTER_DRIVER_DIGEST_MISMATCH",
        `${platformPackage}/${filename} does not match the accepted ${accepted.version} digest.`,
        fixHint,
      );
    }
  }

  return { ok: true, applicable: true, version: accepted.version, platformPackage };
}
