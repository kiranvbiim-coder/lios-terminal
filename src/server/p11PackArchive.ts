import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { unzipSync, zipSync, type Zippable } from "fflate";
import {
  hiddenEnginePackManifestV1Schema,
  type HiddenEnginePackManifestV1,
  type HiddenEnginePackPlatform,
} from "@shared/hiddenEnginePackManifest";
import { isPackCompatible } from "@shared/engineFabricContracts";

export const P11_PACK_REQUIRED_LAYOUT = [
  "manifest.json",
  "adapter/",
  "runtime/",
  "schemas/",
  "licenses/",
  "sbom.cdx.json",
  "checksums.json",
  "signature.json",
] as const;

const DEFAULT_MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_EXPANDED_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_FILES = 4_096;
const ENVELOPE_FILES = new Set(["manifest.json", "checksums.json", "signature.json"]);
const PACK_ARCHIVE_MTIME = new Date(1980, 0, 1, 0, 0, 0);
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export interface P11PackArtifact {
  /** A bounded ZIP archive containing the complete, signed .lios-pack tree. */
  archive: Uint8Array;
}

export type P11PackFile = Uint8Array | string | { bytes: Uint8Array | string; executable?: boolean };

export interface P11PackVerification {
  ok: boolean;
  errors: string[];
  manifestDigest: string;
  payloadDigest: string;
  manifest: HiddenEnginePackManifestV1 | null;
  files: Record<string, Uint8Array>;
  executableFiles: string[];
}

export interface P11PackArchiveLimits {
  maxArchiveBytes?: number;
  maxExpandedBytes?: number;
  maxFiles?: number;
}

interface ZipMember {
  name: string;
  compressedSize: number;
  expandedSize: number;
  dataOffset: number;
  mode: number;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  const object = value as Record<string, unknown>;
  return "{" + Object.keys(object).sort().map((key) => JSON.stringify(key) + ":" + stableJson(object[key])).join(",") + "}";
}

function signingShape(manifest: HiddenEnginePackManifestV1): unknown {
  return {
    ...manifest,
    integrity: {
      payloadSha256: manifest.integrity.payloadSha256,
      signature: {
        algorithm: manifest.integrity.signature.algorithm,
        keyId: manifest.integrity.signature.keyId,
      },
    },
  };
}

export function sha256Bytes(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function computePackManifestDigest(manifestInput: HiddenEnginePackManifestV1): string {
  const manifest = hiddenEnginePackManifestV1Schema.parse(manifestInput);
  return sha256Bytes(Buffer.from(stableJson(signingShape(manifest)), "utf8"));
}

export function packSigningMessage(manifest: HiddenEnginePackManifestV1): Buffer {
  return Buffer.from(`${computePackManifestDigest(manifest)}:${manifest.integrity.payloadSha256}`, "utf8");
}

function safePackPath(value: string): boolean {
  if (!value || value.length > 1_024 || value.normalize("NFC") !== value || value.includes("\\") || value.includes("\0") || value.startsWith("/") || /^[a-z]:/i.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => {
    if (!segment || segment === "." || segment === ".." || Buffer.byteLength(segment, "utf8") > 255) return false;
    if (/[<>:"|?*\u0000-\u001f]/.test(segment) || /[. ]$/.test(segment)) return false;
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)) return false;
    if (/^(?:__proto__|constructor|prototype)$/i.test(segment)) return false;
    return true;
  });
}

export function validateP11PackLayout(files: readonly string[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const portableNames = new Set<string>();
  const portableFiles: string[] = [];
  for (const file of files) {
    if (!safePackPath(file)) errors.push(`Pack contains an unsafe path: ${file}`);
    if (seen.has(file)) errors.push(`Pack contains a duplicate path: ${file}`);
    const portable = file.toLocaleLowerCase("en-US");
    if (portableNames.has(portable)) errors.push(`Pack contains a path collision on case-insensitive filesystems: ${file}`);
    if (portableFiles.some((existing) => portable.startsWith(existing + "/") || existing.startsWith(portable + "/"))) {
      errors.push(`Pack contains a file/directory path collision: ${file}`);
    }
    seen.add(file);
    portableNames.add(portable);
    portableFiles.push(portable);
  }
  for (const required of P11_PACK_REQUIRED_LAYOUT) {
    if (required.endsWith("/")) {
      if (![...seen].some((item) => item.startsWith(required) && item.length > required.length)) {
        errors.push(`Missing required pack directory content: ${required}`);
      }
    } else if (!seen.has(required)) {
      errors.push(`Missing required pack file: ${required}`);
    }
  }
  return errors;
}

function parseZipDirectory(archiveInput: Uint8Array, limits: Required<P11PackArchiveLimits>): ZipMember[] {
  const archive = Buffer.from(archiveInput.buffer, archiveInput.byteOffset, archiveInput.byteLength);
  if (archive.byteLength < 22 || archive.byteLength > limits.maxArchiveBytes) throw new Error("P11 pack archive size is outside the accepted bounds.");

  const minEocd = Math.max(0, archive.byteLength - 22 - 65_535);
  let eocd = -1;
  for (let offset = archive.byteLength - 22; offset >= minEocd; offset -= 1) {
    if (archive.readUInt32LE(offset) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("P11 pack is not a valid ZIP archive.");
  const diskNumber = archive.readUInt16LE(eocd + 4);
  const centralDisk = archive.readUInt16LE(eocd + 6);
  const diskEntries = archive.readUInt16LE(eocd + 8);
  const totalEntries = archive.readUInt16LE(eocd + 10);
  const centralSize = archive.readUInt32LE(eocd + 12);
  const centralOffset = archive.readUInt32LE(eocd + 16);
  const commentLength = archive.readUInt16LE(eocd + 20);
  if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== totalEntries || totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error("Multi-disk and ZIP64 .lios-pack archives are not supported.");
  }
  if (totalEntries > limits.maxFiles || commentLength !== 0 || eocd + 22 + commentLength !== archive.byteLength || centralOffset + centralSize !== eocd) {
    throw new Error("P11 pack archive directory is malformed or exceeds its file-count limit.");
  }

  const members: ZipMember[] = [];
  const names = new Set<string>();
  const portableNames = new Set<string>();
  const dataRanges: Array<[number, number]> = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let cursor = centralOffset;
  let expandedTotal = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > eocd || archive.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) throw new Error("P11 pack central directory entry is malformed.");
    const madeBy = archive.readUInt16LE(cursor + 4);
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const expandedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const entryCommentLength = archive.readUInt16LE(cursor + 32);
    const startDisk = archive.readUInt16LE(cursor + 34);
    const externalAttributes = archive.readUInt32LE(cursor + 38);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + entryCommentLength;
    if (end > eocd || nameLength === 0 || entryCommentLength !== 0 || startDisk !== 0 || compressedSize === 0xffffffff || expandedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error("P11 pack contains an unsupported or malformed ZIP entry.");
    }
    if ((flags & 0x0001) !== 0 || (flags & ~0x0808) !== 0 || (method !== 0 && method !== 8)) {
      throw new Error("P11 pack contains an encrypted or unsupported-compression ZIP entry.");
    }
    const extraStart = cursor + 46 + nameLength;
    for (let extraCursor = extraStart; extraCursor < extraStart + extraLength;) {
      if (extraCursor + 4 > extraStart + extraLength) throw new Error("P11 pack ZIP extra field is malformed.");
      const tag = archive.readUInt16LE(extraCursor);
      const size = archive.readUInt16LE(extraCursor + 2);
      if (extraCursor + 4 + size > extraStart + extraLength || tag === 0x0001) throw new Error("P11 pack ZIP64 or malformed extra fields are not supported.");
      extraCursor += 4 + size;
    }
    const nameBytes = archive.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = decoder.decode(nameBytes);
    if ((flags & 0x0800) === 0 && nameBytes.some((byte) => byte > 0x7f)) throw new Error("P11 pack path names must use UTF-8 encoding.");
    const portableName = name.toLocaleLowerCase("en-US");
    if (!safePackPath(name) || name.endsWith("/") || names.has(name) || portableNames.has(portableName)) {
      throw new Error(`P11 pack contains an unsafe, colliding, directory, or duplicate path: ${name}`);
    }
    names.add(name);
    portableNames.add(portableName);

    let mode = 0;
    if ((madeBy >>> 8) === 3) {
      mode = externalAttributes >>> 16;
      const fileType = mode & 0o170000;
      if ((fileType !== 0 && fileType !== 0o100000) || (mode & 0o7000) !== 0) throw new Error(`P11 pack contains a non-regular or privileged file: ${name}`);
    }
    if ((externalAttributes & 0x10) !== 0 || expandedSize > limits.maxExpandedBytes) throw new Error(`P11 pack entry exceeds safety limits: ${name}`);
    expandedTotal += expandedSize;
    if (expandedTotal > limits.maxExpandedBytes) throw new Error("P11 pack expands beyond the configured size limit.");

    if (localOffset + 30 > centralOffset || archive.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) throw new Error(`P11 pack local entry is malformed: ${name}`);
    const localFlags = archive.readUInt16LE(localOffset + 6);
    const localMethod = archive.readUInt16LE(localOffset + 8);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const localNameStart = localOffset + 30;
    const dataOffset = localNameStart + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (localFlags !== flags || localMethod !== method || localNameLength !== nameLength || localExtraLength !== 0 || dataOffset > centralOffset || dataEnd > centralOffset || !archive.subarray(localNameStart, localNameStart + localNameLength).equals(nameBytes)) {
      throw new Error(`P11 pack local and central ZIP metadata disagree: ${name}`);
    }
    if ((flags & 0x0008) === 0 && (archive.readUInt32LE(localOffset + 14) !== archive.readUInt32LE(cursor + 16) || archive.readUInt32LE(localOffset + 18) !== compressedSize || archive.readUInt32LE(localOffset + 22) !== expandedSize)) {
      throw new Error(`P11 pack local sizes or checksum disagree: ${name}`);
    }
    dataRanges.push([localOffset, dataEnd]);
    members.push({ name, compressedSize, expandedSize, dataOffset, mode });
    cursor = end;
  }
  if (cursor !== centralOffset + centralSize) throw new Error("P11 pack central directory contains trailing or unparsed data.");
  dataRanges.sort((a, b) => a[0] - b[0]);
  for (let index = 1; index < dataRanges.length; index += 1) {
    if (dataRanges[index][0] < dataRanges[index - 1][1]) throw new Error("P11 pack ZIP entries overlap.");
  }
  return members;
}

function effectiveLimits(limits: P11PackArchiveLimits = {}): Required<P11PackArchiveLimits> {
  return {
    maxArchiveBytes: limits.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES,
    maxExpandedBytes: limits.maxExpandedBytes ?? DEFAULT_MAX_EXPANDED_BYTES,
    maxFiles: limits.maxFiles ?? DEFAULT_MAX_FILES,
  };
}

function asBytes(value: P11PackFile): { bytes: Uint8Array; executable: boolean } {
  if (typeof value === "string" || value instanceof Uint8Array) return { bytes: Buffer.from(value), executable: false };
  return { bytes: Buffer.from(value.bytes), executable: value.executable === true };
}

export function createP11PackArtifact(input: {
  manifest: HiddenEnginePackManifestV1;
  files: Record<string, P11PackFile>;
  privateKey: crypto.KeyObject | string | Buffer;
}): P11PackArtifact {
  const base = hiddenEnginePackManifestV1Schema.parse(input.manifest);
  const contentFiles = Object.create(null) as Record<string, Uint8Array>;
  const executableFiles: string[] = [];
  for (const [name, file] of Object.entries(input.files)) {
    if (ENVELOPE_FILES.has(name)) throw new Error(`Pack content cannot replace reserved envelope file ${name}.`);
    if (!safePackPath(name)) throw new Error(`Pack contains an unsafe path: ${name}`);
    const normalized = asBytes(file);
    contentFiles[name] = normalized.bytes;
    if (normalized.executable) executableFiles.push(name);
  }
  const contentNames = Object.keys(contentFiles);
  const layoutErrors = validateP11PackLayout([...contentNames, "manifest.json", "checksums.json", "signature.json"]);
  if (layoutErrors.length) throw new Error("P11 pack layout is invalid: " + layoutErrors.join(" "));
  if (!contentFiles[base.runtime.entrypoint]) throw new Error("P11 runtime entrypoint is absent from the pack archive.");
  if (base.licenses.sbom !== "sbom.cdx.json" || !contentFiles[base.licenses.sbom] || !contentFiles[base.licenses.notices]) {
    throw new Error("P11 pack must include its declared CycloneDX SBOM and third-party notices.");
  }
  if (base.integrity.signature.keyId !== base.publisher.keyId) throw new Error("P11 publisher key and signing key id do not match.");

  const checksums = Object.fromEntries(contentNames.sort().map((name) => [name, sha256Bytes(contentFiles[name])]));
  const checksumsBytes = Buffer.from(stableJson(checksums), "utf8");
  const unsigned = hiddenEnginePackManifestV1Schema.parse({
    ...base,
    integrity: { ...base.integrity, payloadSha256: sha256Bytes(checksumsBytes), manifestSha256: "0".repeat(64), signature: { ...base.integrity.signature, value: "A".repeat(88) } },
  });
  const manifestDigest = computePackManifestDigest(unsigned);
  const manifest = hiddenEnginePackManifestV1Schema.parse({
    ...unsigned,
    integrity: { ...unsigned.integrity, manifestSha256: manifestDigest },
  });
  const signatureValue = crypto.sign(null, packSigningMessage(manifest), input.privateKey).toString("base64");
  const signedManifest = hiddenEnginePackManifestV1Schema.parse({
    ...manifest,
    integrity: { ...manifest.integrity, signature: { ...manifest.integrity.signature, value: signatureValue } },
  });
  const signatureEnvelope = {
    algorithm: "ed25519",
    keyId: signedManifest.integrity.signature.keyId,
    manifestSha256: signedManifest.integrity.manifestSha256,
    payloadSha256: signedManifest.integrity.payloadSha256,
    value: signedManifest.integrity.signature.value,
  };
  const zip = Object.create(null) as Zippable;
  for (const name of contentNames) {
    const mode = executableFiles.includes(name) ? 0o100700 : 0o100600;
    zip[name] = [contentFiles[name], { os: 3, attrs: mode << 16, level: 6, mtime: PACK_ARCHIVE_MTIME }];
  }
  zip["manifest.json"] = [Buffer.from(JSON.stringify(signedManifest, null, 2) + "\n"), { os: 3, attrs: 0o100600 << 16, level: 6, mtime: PACK_ARCHIVE_MTIME }];
  zip["checksums.json"] = [checksumsBytes, { os: 3, attrs: 0o100600 << 16, level: 6, mtime: PACK_ARCHIVE_MTIME }];
  zip["signature.json"] = [Buffer.from(stableJson(signatureEnvelope), "utf8"), { os: 3, attrs: 0o100600 << 16, level: 6, mtime: PACK_ARCHIVE_MTIME }];
  return { archive: zipSync(zip) };
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(`P11 ${label} is not valid JSON.`);
  }
}

function verifyPackContents(input: {
  manifestInput: unknown;
  entries: Record<string, Uint8Array>;
  keyEnvelope: unknown;
  executableFiles: string[];
  options: { publisherKeys: Record<string, crypto.KeyObject | string | Buffer>; coreVersion: string; platform: HiddenEnginePackPlatform };
}): P11PackVerification {
  const errors: string[] = [];
  let manifest: HiddenEnginePackManifestV1 | null = null;
  try {
    manifest = hiddenEnginePackManifestV1Schema.parse(input.manifestInput);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Invalid P11 pack manifest.");
  }
  if (!manifest) return { ok: false, errors, manifestDigest: "", payloadDigest: "", manifest: null, files: {}, executableFiles: [] };

  const names = Object.keys(input.entries).sort();
  errors.push(...validateP11PackLayout(names));
  if (!input.entries[manifest.runtime.entrypoint]) errors.push("Pack runtime entrypoint is missing.");
  if (!input.entries[manifest.licenses.sbom] || !input.entries[manifest.licenses.notices]) errors.push("Pack SBOM or third-party notices are missing.");
  if (manifest.licenses.sbom !== "sbom.cdx.json") errors.push("Pack SBOM must use the canonical sbom.cdx.json path.");

  let checksumMap: Record<string, unknown> = {};
  try {
    const parsed = parseJson(input.entries["checksums.json"] ?? new Uint8Array(), "checksums.json");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    checksumMap = parsed as Record<string, unknown>;
  } catch {
    errors.push("P11 checksums.json is missing or malformed.");
  }
  const contentNames = names.filter((name) => !ENVELOPE_FILES.has(name));
  const checksumNames = Object.keys(checksumMap).sort();
  if (stableJson(contentNames) !== stableJson(checksumNames)) errors.push("Pack checksum index does not cover exactly the archive payload files.");
  for (const name of contentNames) {
    if (typeof checksumMap[name] !== "string" || sha256Bytes(input.entries[name]) !== checksumMap[name]) errors.push(`Pack payload SHA-256 mismatch for ${name}.`);
  }
  const payloadDigest = sha256Bytes(Buffer.from(stableJson(checksumMap), "utf8"));
  if (payloadDigest !== manifest.integrity.payloadSha256) errors.push("Pack payload index SHA-256 does not match the manifest.");
  const manifestDigest = computePackManifestDigest(manifest);
  if (manifestDigest !== manifest.integrity.manifestSha256) errors.push("Pack manifest SHA-256 does not match its canonical signing payload.");

  const signature = manifest.integrity.signature;
  if (manifest.publisher.keyId !== signature.keyId) errors.push("Pack publisher key does not match the signature key.");
  const envelope = input.keyEnvelope;
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    errors.push("P11 signature.json is missing or malformed.");
  } else {
    const row = envelope as Record<string, unknown>;
    if (Object.keys(row).sort().join(",") !== ["algorithm", "keyId", "manifestSha256", "payloadSha256", "value"].sort().join(",")
      || row.algorithm !== signature.algorithm || row.keyId !== signature.keyId || row.manifestSha256 !== manifest.integrity.manifestSha256 || row.payloadSha256 !== manifest.integrity.payloadSha256 || row.value !== signature.value) {
      errors.push("P11 signature.json does not match its signed manifest.");
    }
  }

  const compatibility = isPackCompatible(manifest, input.options.coreVersion, input.options.platform);
  if (!compatibility.compatible) errors.push(compatibility.reason);
  const key = input.options.publisherKeys[signature.keyId];
  if (!key) errors.push("Pack publisher key is not allow-listed.");
  else {
    try {
      const decoded = Buffer.from(signature.value, "base64");
      if (decoded.toString("base64") !== signature.value || !crypto.verify(null, packSigningMessage(manifest), key, decoded)) errors.push("Pack signature verification failed.");
    } catch {
      errors.push("Pack signature could not be decoded or verified.");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    manifestDigest,
    payloadDigest,
    manifest,
    files: input.entries,
    executableFiles: input.executableFiles,
  };
}

export function verifyP11PackArtifact(
  artifactInput: P11PackArtifact,
  options: { publisherKeys: Record<string, crypto.KeyObject | string | Buffer>; coreVersion: string; platform: HiddenEnginePackPlatform },
  archiveLimits: P11PackArchiveLimits = {},
): P11PackVerification {
  try {
    const limits = effectiveLimits(archiveLimits);
    const members = parseZipDirectory(artifactInput.archive, limits);
    const unzipped = unzipSync(artifactInput.archive);
    if (Object.keys(unzipped).length !== members.length) throw new Error("P11 pack ZIP entry count changed during extraction.");
    const files = Object.create(null) as Record<string, Uint8Array>;
    const executableFiles: string[] = [];
    for (const member of members) {
      const bytes = unzipped[member.name];
      if (!bytes || bytes.byteLength !== member.expandedSize) throw new Error(`P11 pack entry size mismatch: ${member.name}`);
      files[member.name] = bytes;
      if ((member.mode & 0o111) !== 0) executableFiles.push(member.name);
    }
    const manifest = parseJson(files["manifest.json"] ?? new Uint8Array(), "manifest.json");
    const signature = parseJson(files["signature.json"] ?? new Uint8Array(), "signature.json");
    const internalChecksumMap = files["checksums.json"];
    if (!internalChecksumMap) throw new Error("P11 checksums.json is missing.");
    const outsideManifest = hiddenEnginePackManifestV1Schema.safeParse(manifest);
    const verified = verifyPackContents({ manifestInput: manifest, entries: files, keyEnvelope: signature, executableFiles, options });
    if (!outsideManifest.success) return verified;
    return verified;
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : "P11 pack verification failed."],
      manifestDigest: "",
      payloadDigest: "",
      manifest: null,
      files: {},
      executableFiles: [],
    };
  }
}

export function verifyP11InstalledPack(input: {
  rootDir: string;
  options: { publisherKeys: Record<string, crypto.KeyObject | string | Buffer>; coreVersion: string; platform: HiddenEnginePackPlatform };
}): P11PackVerification {
  try {
    const rootStat = fs.lstatSync(input.rootDir);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Installed P11 pack version path is not a regular directory.");
    const actual: string[] = [];
    const walk = (dir: string, prefix: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const absolute = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`Installed P11 pack contains a symbolic link: ${relative}`);
        if (entry.isDirectory()) walk(absolute, relative);
        else if (entry.isFile()) actual.push(relative);
        else throw new Error(`Installed P11 pack contains a non-regular file: ${relative}`);
      }
    };
    walk(input.rootDir, "");
    const files = Object.create(null) as Record<string, Uint8Array>;
    const executableFiles: string[] = [];
    const manifestFile = path.join(input.rootDir, "manifest.json");
    const manifest = parseJson(fs.readFileSync(manifestFile), "installed manifest.json");
    const parsed = hiddenEnginePackManifestV1Schema.parse(manifest);
    const expected = new Set<string>(["manifest.json", "checksums.json", "signature.json"]);
    const checksumMap = parseJson(fs.readFileSync(path.join(input.rootDir, "checksums.json")), "installed checksums.json") as Record<string, unknown>;
    for (const name of Object.keys(checksumMap)) expected.add(name);
    if (stableJson(actual.sort()) !== stableJson([...expected].sort())) throw new Error("Installed P11 pack file set differs from its signed checksum index.");
    for (const name of Object.keys(checksumMap)) {
      if (!safePackPath(name)) throw new Error(`Installed P11 pack contains an unsafe path: ${name}`);
      const filePath = path.resolve(input.rootDir, ...name.split("/"));
      const relative = path.relative(path.resolve(input.rootDir), filePath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Installed P11 pack path escapes its version directory.");
      const bytes = fs.readFileSync(filePath);
      files[name] = bytes;
      const fileMode = fs.statSync(filePath).mode;
      if ((fileMode & 0o111) !== 0) executableFiles.push(name);
    }
    files["manifest.json"] = fs.readFileSync(path.join(input.rootDir, "manifest.json"));
    files["checksums.json"] = fs.readFileSync(path.join(input.rootDir, "checksums.json"));
    files["signature.json"] = fs.readFileSync(path.join(input.rootDir, "signature.json"));
    return verifyPackContents({
      manifestInput: parsed,
      entries: files,
      keyEnvelope: parseJson(files["signature.json"], "installed signature.json"),
      executableFiles,
      options: input.options,
    });
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : "P11 installed-pack verification failed."],
      manifestDigest: "",
      payloadDigest: "",
      manifest: null,
      files: {},
      executableFiles: [],
    };
  }
}
