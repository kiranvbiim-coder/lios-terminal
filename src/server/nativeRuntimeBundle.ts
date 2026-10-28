import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  auditInstalledPackages,
  packSpec,
  resolveSelectedPacks,
  type StrictProvisioningAuthority,
  type StrictProvisioningRequest,
} from "./pythonRuntimeManager";
import { MANAGED_RUNTIME_MANIFEST } from "./runtimeManifest";
import { satisfiesRuntimePackageVersion as satisfies } from "./runtimePackageVersion";
import {windowsRuntimeFs} from "./nativeRuntimeWindowsFs";

const MAX_METADATA_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 100_000;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const NO_FOLLOW = fs.constants.O_NOFOLLOW;

type FileEntry = { path: string; size: number; sha256: string; executable: boolean };
type BundleManifest = {
  schemaVersion: 1;
  target: "darwin-arm64" | "win32-x64";
  manifestVersion: string;
  pythonVersion: "3.13.16";
  minimumSystemVersion: "14.0" | "10.0";
  packIds: string[];
  pythonRelativePath: "bin/python3" | "python.exe";
  installedPackages: Record<string, string>;
  locks: Array<{ packId: string; sha256: string }>;
  files: FileEntry[];
  totalBytes: number;
  source: { repository: string; commit: string; archiveSha256: string };
};
type DirectoryIdentities = Map<string, fs.Stats>;
const windowsPins=new WeakMap<DirectoryIdentities,Map<string,unknown>>();
function releaseWindowsPins(identities:DirectoryIdentities) {
  const pins=windowsPins.get(identities);
  if(pins)for(const pin of pins.values())windowsRuntimeFs().releasePin(pin);
  windowsPins.delete(identities);
}
function makeDirectory(directory:string) {
  if(process.platform==="win32")windowsRuntimeFs().makeDirectory(directory);
  else fs.mkdirSync(directory,{mode:0o700});
}

function refuse(detail: string): never {
  throw new Error(`Native runtime bundle refused: ${detail}.`);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse("invalid metadata object");
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, expected: string[]): void {
  if (Object.keys(value).length !== expected.length || expected.some((key) => !Object.hasOwn(value, key))) {
    refuse("unexpected metadata fields");
  }
}

function sameIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameFile(left: fs.Stats, right: fs.Stats): boolean {
  return sameIdentity(left, right) && left.size === right.size && left.mode === right.mode &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

// macOS exposes these OS-owned aliases even for normal app data/temp paths. Do
// not realpath arbitrary caller-controlled links: all other links are refused.
function canonicalPath(value: string): string {
  if (typeof value !== "string" || !value || value.includes("\0") || (process.platform !== "win32" && value.includes("\\")) || !path.isAbsolute(value) ||
      value.split(path.sep).some((part) => part === "." || part === "..")) {
    refuse("a canonical absolute local path is required");
  }
  if(process.platform==="win32"&&(!/^[a-z]:\\/i.test(value)||/[<>\"|?*]/.test(value)||value.slice(2).includes(":")||
      value.split(/[\\/]/).slice(1).some(part=>!part||part.endsWith(".")||part.endsWith(" ")||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))))
    refuse("unsafe Windows local path");
  let result = path.resolve(value);
  if (process.platform === "darwin") {
    for (const alias of ["/tmp", "/var"]) {
      if (result === alias || result.startsWith(`${alias}/`)) {
        const target = `/private${alias}`;
        if (fs.realpathSync(alias) !== target) refuse("unexpected system path alias");
        result = target + result.slice(alias.length);
      }
    }
  }
  return result;
}

function checkDirectories(directory: string, identities: DirectoryIdentities, allowMissing = false): void {
  const parsed = path.parse(directory);
  let current = parsed.root;
  for (const part of ["", ...directory.slice(parsed.root.length).split(path.sep).filter(Boolean)]) {
    if (part) current = path.join(current, part);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!stat && allowMissing) return;
    if (!stat?.isDirectory() || stat.isSymbolicLink()) refuse("unsafe directory ancestor");
    if(process.platform==="win32"){
      let pins=windowsPins.get(identities);if(!pins){pins=new Map();windowsPins.set(identities,pins);}
      if(!pins.has(current))pins.set(current,windowsRuntimeFs().pinDirectories(current));
    }
    const prior = identities.get(current);
    if (prior && !sameIdentity(prior, stat)) refuse("directory identity changed");
    identities.set(current, stat);
  }
}

function ensureDirectories(directory: string, identities: DirectoryIdentities): void {
  const missing: string[] = [];
  let current = directory;
  while (!fs.lstatSync(current, { throwIfNoEntry: false })) {
    missing.push(current);
    current = path.dirname(current);
  }
  checkDirectories(current, identities);
  for (const next of missing.reverse()) {
    checkDirectories(path.dirname(next), identities);
    makeDirectory(next);
    checkDirectories(next, identities);
  }
}

function openRegular(filename: string, maximum: number, identities: DirectoryIdentities): { fd: number; stat: fs.Stats } {
  checkDirectories(path.dirname(filename), identities);
  const before = fs.lstatSync(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximum) refuse("unsafe or oversized regular file");
  const fd = process.platform==="win32" ? windowsRuntimeFs().openFile(filename,false)
    : fs.openSync(filename, fs.constants.O_RDONLY | NO_FOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || !sameFile(before, stat)) refuse("source file identity changed");
    checkDirectories(path.dirname(filename), identities);
    return { fd, stat };
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

function checkOpenFile(filename: string, fd: number, before: fs.Stats, identities: DirectoryIdentities): void {
  checkDirectories(path.dirname(filename), identities);
  if (!sameFile(before, fs.fstatSync(fd)) || !sameFile(before, fs.lstatSync(filename))) {
    refuse("source file changed while reading");
  }
}

function metadataBytes(filename: string, budget: { remaining: number }, identities: DirectoryIdentities): Buffer {
  const { fd, stat } = openRegular(filename, budget.remaining, identities);
  try {
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) refuse("truncated metadata");
      offset += count;
    }
    checkOpenFile(filename, fd, stat, identities);
    budget.remaining -= bytes.length;
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

function json(bytes: Buffer): unknown {
  try { return JSON.parse(bytes.toString("utf8")); } catch { return refuse("invalid JSON metadata"); }
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function releasePin(bytes: Buffer): string {
  const descriptor = record(json(bytes));
  keys(descriptor, ["schemaVersion", "manifestSha256"]);
  if (descriptor.schemaVersion !== 1 || typeof descriptor.manifestSha256 !== "string" || !SHA256.test(descriptor.manifestSha256)) {
    refuse("invalid release descriptor");
  }
  return descriptor.manifestSha256;
}

function relativeFile(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096 || value.includes("\\") || /[\0-\x1f\x7f:]/.test(value)) {
    refuse("invalid payload path");
  }
  const parts = value.split("/");
  if (parts.length > 64 || parts.some((part) => !part || part === "." || part === ".." || part.endsWith(".") || part.endsWith(" ") ||
      /[<>\"|?*]/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    refuse("invalid payload path");
  }
  return value;
}


function parseManifest(raw: unknown, target: string): BundleManifest {
  const manifest = record(raw);
  keys(manifest, ["schemaVersion", "target", "manifestVersion", "pythonVersion", "minimumSystemVersion", "packIds", "pythonRelativePath", "installedPackages", "locks", "files", "totalBytes", "source"]);
  const windows=target==="win32-x64";
  if (manifest.schemaVersion !== 1 || !["darwin-arm64","win32-x64"].includes(target) || manifest.target !== target ||
      !MANAGED_RUNTIME_MANIFEST.supportedPlatforms.includes(target) ||
      manifest.manifestVersion !== MANAGED_RUNTIME_MANIFEST.manifestVersion || manifest.pythonVersion !== "3.13.16" ||
      !satisfies(manifest.pythonVersion, MANAGED_RUNTIME_MANIFEST.pythonVersion) || manifest.pythonRelativePath !== (windows?"python.exe":"bin/python3")) {
    refuse("incompatible target or manifest revision");
  }
  if (manifest.minimumSystemVersion !== (windows?"10.0":"14.0")) refuse("unsupported minimum system version");
  // The selected cp313 NumPy/SciPy wheels require macOS 14 (Darwin 23).
  // Injectable platform/arch qualify fixtures, never bypass the actual OS floor.
  if (process.platform === "darwin") {
    const kernel = os.release();
    if (!/^\d+\.\d+\.\d+$/.test(kernel) || Number(kernel.split(".")[0]) < 23) refuse("native runtime requires macOS 14 or newer");
  }
  if(process.platform==="win32"&&(!/^\d+\.\d+\.\d+$/.test(os.release())||Number(os.release().split(".")[0])<10))
    refuse("native runtime requires Windows 10 or newer");
  if (!Array.isArray(manifest.packIds) || manifest.packIds.length !== 1 || manifest.packIds[0] !== "core") refuse("unsupported pack set");
  const inventory = record(manifest.installedPackages);
  const normalizedNames = new Set<string>();
  for (const [name, version] of Object.entries(inventory)) {
    const normalized = name.toLowerCase().replace(/[_.]+/g, "-");
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name) || normalizedNames.has(normalized) ||
        typeof version !== "string" || !/^\d+(?:\.\d+)*(?:(?:a|b|rc|\.post|\.dev)\d+)?(?:\+[a-z0-9.]+)?$/i.test(version)) {
      refuse("invalid installed package inventory");
    }
    normalizedNames.add(normalized);
  }
  const installed = inventory as Record<string, string>;
  if (auditInstalledPackages(MANAGED_RUNTIME_MANIFEST, ["core"], installed).length) refuse("package inventory does not satisfy current manifest");
  const normalizedInventory = new Map(Object.entries(installed).map(([name, version]) => [name.toLowerCase().replace(/[_.]+/g, "-"), version]));
  for (const pack of resolveSelectedPacks(MANAGED_RUNTIME_MANIFEST, ["core"])) {
    for (const pkg of pack.packages) {
      if (packSpec(pkg) && !satisfies(normalizedInventory.get(pkg.name.toLowerCase().replace(/[_.]+/g, "-")) ?? "", pkg.version)) {
        refuse("package version is outside current manifest constraints");
      }
    }
  }
  if (!Array.isArray(manifest.locks) || manifest.locks.length !== 1) refuse("invalid release locks");
  const lock = record(manifest.locks[0]);
  keys(lock, ["packId", "sha256"]);
  if (lock.packId !== "core" || typeof lock.sha256 !== "string" || !SHA256.test(lock.sha256)) refuse("invalid release lock digest");
  const source = record(manifest.source);
  keys(source, ["repository", "commit", "archiveSha256"]);
  if (typeof source.repository !== "string" || !/^https:\/\/github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(source.repository) ||
      typeof source.commit !== "string" || !/^[a-f0-9]{40}$/.test(source.commit) ||
      typeof source.archiveSha256 !== "string" || !SHA256.test(source.archiveSha256)) refuse("invalid source provenance");
  if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > MAX_FILES) refuse("invalid payload inventory size");
  const paths = new Set<string>();
  const directories = new Set<string>();
  const spellings = new Map<string, string>();
  let total = 0;
  for (const rawFile of manifest.files) {
    const file = record(rawFile);
    keys(file, ["path", "size", "sha256", "executable"]);
    const filename = relativeFile(file.path);
    // Conservatively reject aliases on every host, including fixtures qualifying
    // a case-insensitive macOS payload on a case-sensitive build filesystem.
    const folded = filename.normalize("NFC").toLowerCase();
    if (paths.has(folded) || directories.has(folded)) refuse("duplicate or conflicting payload paths");
    paths.add(folded);
    const parts = filename.split("/");
    for (let index = 1; index <= parts.length; index++) {
      const spelling = parts.slice(0, index).join("/");
      const foldedPart = spelling.normalize("NFC").toLowerCase();
      const prior = spellings.get(foldedPart);
      if (prior !== undefined && prior !== spelling) refuse("case or Unicode aliased payload paths");
      spellings.set(foldedPart, spelling);
      if (index < parts.length) {
        if (paths.has(foldedPart)) refuse("file is also a payload directory");
        directories.add(foldedPart);
      }
    }
    if (!Number.isSafeInteger(file.size) || (file.size as number) < 0 || (file.size as number) > MAX_FILE_BYTES ||
        typeof file.sha256 !== "string" || !SHA256.test(file.sha256) || typeof file.executable !== "boolean") refuse("invalid payload file metadata");
    total += file.size as number;
    if (total > MAX_TOTAL_BYTES) refuse("payload exceeds total size limit");
  }
  if (!Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes !== total) refuse("invalid payload total size");
  if (!manifest.files.some((file) => file.path === manifest.pythonRelativePath && file.executable && file.size > 0)) refuse("missing executable Python payload");
  return manifest as unknown as BundleManifest;
}

function inspectTree(root: string, files: Set<string>, directories: Set<string>, identities: DirectoryIdentities): void {
  checkDirectories(root, identities);
  const visit = (directory: string, relative: string): void => {
    checkDirectories(directory, identities);
    const handle = fs.opendirSync(directory);
    try {
      let entry: fs.Dirent | null;
      while ((entry = handle.readSync()) !== null) {
        const filename = relative ? `${relative}/${entry.name}` : entry.name;
        const fullPath = path.join(directory, entry.name);
        const stat = fs.lstatSync(fullPath);
        if (stat.isSymbolicLink()) refuse("symlink in bundle inventory");
        if (stat.isDirectory() && directories.has(filename)) visit(fullPath, filename);
        else if (!stat.isFile() || !files.has(filename)) refuse("unlisted or special bundle entry");
      }
    } finally {
      handle.closeSync();
    }
    checkDirectories(directory, identities);
  };
  visit(root, "");
}

function payloadDirectories(files: FileEntry[]): Set<string> {
  const directories = new Set<string>();
  for (const file of files) {
    const parts = file.path.split("/");
    for (let index = 1; index < parts.length; index++) directories.add(parts.slice(0, index).join("/"));
  }
  return directories;
}

function inspectPayload(root: string, manifest: BundleManifest, identities: DirectoryIdentities): void {
  inspectTree(root, new Set(manifest.files.map((file) => file.path)), payloadDirectories(manifest.files), identities);
}

function transferFile(source: string, file: FileEntry, identities: DirectoryIdentities, buffer: Buffer,
  destination?: { filename: string; identities: DirectoryIdentities }): void {
  const { fd, stat } = openRegular(source, MAX_FILE_BYTES, identities);
  let output: number | undefined;
  try {
    if (stat.size !== file.size || process.platform!=="win32"&&Boolean(stat.mode & 0o111) !== file.executable) refuse("payload size or executable mode changed");
    if (destination) {
      ensureDirectories(path.dirname(destination.filename), destination.identities);
      checkDirectories(path.dirname(destination.filename), destination.identities);
      output = process.platform==="win32" ? windowsRuntimeFs().openFile(destination.filename,true)
        : fs.openSync(destination.filename, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | NO_FOLLOW, 0o600);
    }
    const hash = createHash("sha256");
    let offset = 0;
    while (offset < stat.size) {
      const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, stat.size - offset), offset);
      if (!count) refuse("truncated payload file");
      hash.update(buffer.subarray(0, count));
      if (output !== undefined) {
        let written = 0;
        while (written < count) {
          const countWritten = fs.writeSync(output, buffer, written, count - written, offset + written);
          if (!countWritten) refuse("incomplete staging write");
          written += countWritten;
        }
      }
      offset += count;
    }
    checkOpenFile(source, fd, stat, identities);
    if (hash.digest("hex") !== file.sha256) refuse("payload digest mismatch");
    if (output !== undefined && destination) {
      if(process.platform!=="win32")fs.fchmodSync(output, file.executable ? 0o755 : 0o644);
      const copied = fs.fstatSync(output);
      const copiedHash = createHash("sha256");
      let copiedOffset = 0;
      while (copiedOffset < file.size) {
        const count = fs.readSync(output, buffer, 0, Math.min(buffer.length, file.size - copiedOffset), copiedOffset);
        if (!count) refuse("truncated staging file");
        copiedHash.update(buffer.subarray(0, count));
        copiedOffset += count;
      }
      if (copiedHash.digest("hex") !== file.sha256 || !sameFile(copied, fs.fstatSync(output))) refuse("staging payload digest mismatch");
      checkDirectories(path.dirname(destination.filename), destination.identities);
      if (!copied.isFile() || copied.size !== file.size || !sameFile(copied, fs.lstatSync(destination.filename))) refuse("staging file identity changed");
    }
  } finally {
    if (output !== undefined) fs.closeSync(output);
    fs.closeSync(fd);
  }
}

function loadBundle(root: string, pin: string, target: string, identities: DirectoryIdentities): BundleManifest {
  const budget = { remaining: MAX_METADATA_BYTES };
  checkDirectories(root, identities);
  if (releasePin(metadataBytes(path.join(root, "release.json"), budget, identities)) !== pin) refuse("release descriptor does not match trusted pin");
  const bytes = metadataBytes(path.join(root, "manifest.json"), budget, identities);
  if (digest(bytes) !== pin) refuse("manifest digest mismatch");
  const manifest = parseManifest(json(bytes), target);
  const lockBytes = metadataBytes(path.join(root, "locks", "core.lock.txt"), budget, identities);
  if (!lockBytes.length || digest(lockBytes) !== manifest.locks[0].sha256) refuse("release lock digest mismatch");
  inspectTree(root, new Set(["release.json", "manifest.json", "locks/core.lock.txt", ...manifest.files.map((file) => `runtime/${file.path}`)]),
    new Set(["locks", "runtime", ...[...payloadDirectories(manifest.files)].map((directory) => `runtime/${directory}`)]), identities);
  return manifest;
}

function validateRequest(request: StrictProvisioningRequest, root: string, bundleRoot: string, manifest: BundleManifest): string {
  const staging = canonicalPath(request.runtimePath);
  if (path.dirname(staging) !== root || !/^install-\d+-\d+$/.test(path.basename(staging))) refuse("invalid generated staging child");
  if (request.hashVerified !== true || request.requireVerified !== true) refuse("verified release artifacts are required");
  if (!Array.isArray(request.selectedPackIds) || request.selectedPackIds.length !== 1 || request.selectedPackIds[0] !== "core") refuse("request pack set differs from bundle");
  const expectedSpecs = resolveSelectedPacks(MANAGED_RUNTIME_MANIFEST, ["core"])
    .flatMap((pack) => pack.packages.map(packSpec)).filter((spec): spec is string => spec !== null);
  if (!Array.isArray(request.packageSpecs) || request.packageSpecs.length !== expectedSpecs.length ||
      new Set(request.packageSpecs).size !== expectedSpecs.length || expectedSpecs.some((spec) => !request.packageSpecs.includes(spec))) {
    refuse("request requirements differ from current manifest");
  }
  if (!Array.isArray(request.lockFiles) || request.lockFiles.length !== 1) refuse("request release locks differ from bundle");
  const lockPath = canonicalPath(request.lockFiles[0]);
  const lockIdentities: DirectoryIdentities = new Map();
  const bytes = metadataBytes(lockPath, { remaining: MAX_METADATA_BYTES }, lockIdentities);
  if (digest(bytes) !== manifest.locks[0].sha256) refuse("request release lock digest mismatch");
  // Both lock sources must be identical bytes, not merely similarly named files.
  const bundled = metadataBytes(path.join(bundleRoot, "locks", "core.lock.txt"), { remaining: MAX_METADATA_BYTES }, new Map());
  if (!bytes.equals(bundled)) refuse("request release lock bytes differ from bundle");
  return staging;
}

/**
 * Copy-only implementation of the existing P10 authority. Inventory is trusted
 * because the release pins both metadata and payload bytes; it is NOT evidence
 * of executing/importing the native runtime. The manager alone activates and
 * rolls back current. No interpreter, package script, pip or host runner runs here.
 */
export function createNativeRuntimeBundleAuthority(options: {
  runtimeRoot: string;
  bundleRoot: string;
  manifestSha256: string;
  platform?: NodeJS.Platform;
  arch?: string;
}): StrictProvisioningAuthority {
  if (process.platform==="win32")windowsRuntimeFs();
  else if(!NO_FOLLOW)refuse("no-follow filesystem support is required");
  if(typeof options.manifestSha256 !== "string" || !SHA256.test(options.manifestSha256))refuse("a trusted manifest pin is required");
  const runtimeRoot = canonicalPath(options.runtimeRoot);
  const bundleRoot = canonicalPath(options.bundleRoot);
  if (runtimeRoot === bundleRoot || runtimeRoot.startsWith(`${bundleRoot}${path.sep}`) || bundleRoot.startsWith(`${runtimeRoot}${path.sep}`)) {
    refuse("source and managed runtime roots overlap");
  }
  const target = `${options.platform ?? process.platform}-${options.arch ?? process.arch}`;
  const pin = options.manifestSha256;
  const sourceIdentities: DirectoryIdentities = new Map();
  const runtimeIdentities: DirectoryIdentities = new Map();
  checkDirectories(runtimeRoot, runtimeIdentities, true);
  const manifest = loadBundle(bundleRoot, pin, target, sourceIdentities);
  const buffer = Buffer.alloc(64 * 1024);
  for (const file of manifest.files) transferFile(path.join(bundleRoot, "runtime", file.path), file, sourceIdentities, buffer);
  inspectPayload(path.join(bundleRoot, "runtime"), manifest, sourceIdentities);

  return Object.freeze({
    async provisionManagedRuntime(request: StrictProvisioningRequest) {
      const currentManifest = loadBundle(bundleRoot, pin, target, sourceIdentities);
      const staging = validateRequest(request, runtimeRoot, bundleRoot, currentManifest);
      ensureDirectories(runtimeRoot, runtimeIdentities);
      checkDirectories(runtimeRoot, runtimeIdentities);
      if (fs.lstatSync(staging, { throwIfNoEntry: false })) refuse("staging destination is already occupied");
      makeDirectory(staging);
      const owned = fs.lstatSync(staging);
      const stagingIdentities = new Map(runtimeIdentities);
      try {
        checkDirectories(staging, stagingIdentities);
        for (const file of currentManifest.files) {
          transferFile(path.join(bundleRoot, "runtime", file.path), file, sourceIdentities, buffer,
            { filename: path.join(staging, file.path), identities: stagingIdentities });
        }
        loadBundle(bundleRoot, pin, target, sourceIdentities);
        inspectPayload(staging, currentManifest, stagingIdentities);
        return {
          packageOutput: `Copied SHA-256-pinned native runtime bundle (${target}, manifest ${pin}); package inventory is release metadata, not runtime execution proof.`,
          installedPackages: { ...currentManifest.installedPackages },
        };
      } catch (error) {
        // Never remove a colliding/replaced path or anything outside our staging.
        checkDirectories(runtimeRoot, runtimeIdentities);
        const current = fs.lstatSync(staging, { throwIfNoEntry: false });
        if (current?.isDirectory() && !current.isSymbolicLink() && sameIdentity(owned, current)) {
          fs.rmSync(staging, { recursive: true, force: true });
        }
        throw error;
      }
      finally { releaseWindowsPins(stagingIdentities); }
    },
  });
}

/** Fixed server-owned resources only; an installed but invalid bundle is fatal. */
export function resolvePackagedNativeRuntimeBundleAuthority(
  resourcesPath: string,
  runtimeRoot: string,
): StrictProvisioningAuthority | null {
  const resources = canonicalPath(resourcesPath);
  const identities: DirectoryIdentities = new Map();
  checkDirectories(resources, identities, true);
  const bundleRoot = path.join(resources, "native-runtime-dist");
  const present = fs.lstatSync(bundleRoot, { throwIfNoEntry: false });
  if (!present) return null;
  checkDirectories(bundleRoot, identities);
  const pin = releasePin(metadataBytes(path.join(bundleRoot, "release.json"), { remaining: MAX_METADATA_BYTES }, identities));
  return createNativeRuntimeBundleAuthority({ runtimeRoot, bundleRoot, manifestSha256: pin });
}
