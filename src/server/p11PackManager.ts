import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  hiddenEnginePackManifestV1Schema,
  type HiddenEnginePackPlatform,
} from "@shared/hiddenEnginePackManifest";
import { enginePackInstallStateSchema, type EnginePackInstallState } from "@shared/engineFabricContracts";
import {
  verifyP11InstalledPack,
  verifyP11PackArtifact,
  type P11PackArtifact,
  type P11PackVerification,
} from "./p11PackArchive";

export {
  computePackManifestDigest,
  createP11PackArtifact,
  packSigningMessage,
  P11_PACK_REQUIRED_LAYOUT,
  sha256Bytes,
  validateP11PackLayout,
  verifyP11PackArtifact,
  type P11PackArtifact,
  type P11PackFile,
  type P11PackVerification,
} from "./p11PackArchive";

export interface P11InstalledPackState {
  packId: string;
  activeVersion: string | null;
  previousActiveVersion: string | null;
  versions: Array<{
    version: string;
    state: EnginePackInstallState;
    installedAt: string;
    lastHealthAt: string | null;
    lastHealth: "healthy" | "degraded" | "unknown";
  }>;
}

interface P11ManagerState {
  schemaVersion: "1";
  packs: Record<string, P11InstalledPackState>;
}

function emptyState(): P11ManagerState {
  return { schemaVersion: "1", packs: {} };
}

function isManagerState(value: unknown): value is P11ManagerState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  if (state.schemaVersion !== "1" || !state.packs || typeof state.packs !== "object" || Array.isArray(state.packs)) return false;
  for (const [packId, unknownPack] of Object.entries(state.packs as Record<string, unknown>)) {
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(packId) || !unknownPack || typeof unknownPack !== "object" || Array.isArray(unknownPack)) return false;
    const pack = unknownPack as Record<string, unknown>;
    if (pack.packId !== packId || !Array.isArray(pack.versions)) return false;
    const versions = pack.versions as Array<Record<string, unknown>>;
    const seen = new Set<string>();
    for (const row of versions) {
      if (!row || typeof row !== "object" || typeof row.version !== "string"
        || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(row.version)
        || !enginePackInstallStateSchema.safeParse(row.state).success
        || typeof row.installedAt !== "string" || !Number.isFinite(Date.parse(row.installedAt))
        || !(row.lastHealthAt === null || (typeof row.lastHealthAt === "string" && Number.isFinite(Date.parse(row.lastHealthAt))))
        || !["healthy", "degraded", "unknown"].includes(String(row.lastHealth))) return false;
      if (seen.has(row.version)) return false;
      seen.add(row.version);
    }
    if (!(pack.activeVersion === null || (typeof pack.activeVersion === "string" && seen.has(pack.activeVersion)))) return false;
    if (!(pack.previousActiveVersion === null || (typeof pack.previousActiveVersion === "string" && seen.has(pack.previousActiveVersion)))) return false;
  }
  return true;
}

export class P11PackManager {
  private readonly stateFile: string;

  constructor(private readonly options: {
    rootDir: string;
    coreVersion: string;
    platform: HiddenEnginePackPlatform;
    publisherKeys: Record<string, crypto.KeyObject | string | Buffer>;
  }) {
    fs.mkdirSync(options.rootDir, { recursive: true, mode: 0o700 });
    const rootInfo = fs.lstatSync(options.rootDir);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("P11 pack manager root must be a regular directory, not a symbolic link.");
    this.stateFile = path.join(options.rootDir, "state.json");
    this.recoverInstalledState();
  }

  private readState(): P11ManagerState {
    let stateInfo: fs.Stats;
    try {
      stateInfo = fs.lstatSync(this.stateFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
      throw error;
    }
    if (!stateInfo.isFile() || stateInfo.isSymbolicLink()) throw new Error("P11 pack manager state must be a regular file.");
    let value: unknown;
    try {
      value = JSON.parse(fs.readFileSync(this.stateFile, "utf8")) as unknown;
    } catch (error) {
      throw new Error("P11 pack manager state is unreadable or malformed; refusing implicit reset.", { cause: error });
    }
    if (!isManagerState(value)) throw new Error("P11 pack manager state has an invalid schema; refusing implicit reset.");
    return value;
  }

  private writeState(state: P11ManagerState): void {
    const temporary = `${this.stateFile}.${crypto.randomUUID()}.tmp`;
    let fd: number | null = null;
    try {
      fd = fs.openSync(temporary, "wx", 0o600);
      fs.writeFileSync(fd, JSON.stringify(state, null, 2));
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = null;
      fs.renameSync(temporary, this.stateFile);
    } catch (error) {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch { /* retain the original state-write failure */ }
      }
      fs.rmSync(temporary, { force: true });
      throw error;
    }
  }

  private versionDir(packId: string, version: string): string {
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(packId) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
      throw new Error("P11 pack identity or version is not path-safe.");
    }
    const rootInfo = fs.lstatSync(this.options.rootDir);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("P11 pack manager root cannot be a symbolic link.");
    const packRoot = path.join(this.options.rootDir, packId);
    try {
      const packInfo = fs.lstatSync(packRoot);
      if (!packInfo.isDirectory() || packInfo.isSymbolicLink()) throw new Error("P11 pack directory cannot be a symbolic link or non-directory.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return path.join(this.options.rootDir, packId, version);
  }

  private recoverInstalledState(): void {
    const state = this.readState();
    let changed = false;

    // Complete or reverse a removal that was interrupted between moving the
    // version directory aside and atomically publishing state.json.
    for (const packEntry of fs.readdirSync(this.options.rootDir, { withFileTypes: true })) {
      if (!packEntry.isDirectory() || packEntry.isSymbolicLink() || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(packEntry.name)) continue;
      const packRoot = path.join(this.options.rootDir, packEntry.name);
      const pack = state.packs[packEntry.name];
      for (const entry of fs.readdirSync(packRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const marker = entry.name.lastIndexOf(".removing-");
        if (marker <= 0 || !/^[0-9a-f-]{36}$/i.test(entry.name.slice(marker + ".removing-".length))) continue;
        const version = entry.name.slice(0, marker);
        if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) continue;
        const tombstone = path.join(packRoot, entry.name);
        const original = this.versionDir(packEntry.name, version);
        const stillRegistered = pack?.versions.some((row) => row.version === version) ?? false;
        if (stillRegistered && !fs.existsSync(original)) fs.renameSync(tombstone, original);
        else fs.rmSync(tombstone, { recursive: true, force: true });
        if (!stillRegistered) changed = true;
      }
    }

    for (const [packId, pack] of Object.entries(state.packs)) {
      for (const row of pack.versions) {
        const verification = verifyP11InstalledPack({ rootDir: this.versionDir(packId, row.version), options: this.options });
        const healthy = verification.ok && verification.manifest?.id === packId && verification.manifest.version === row.version;
        row.lastHealthAt = new Date().toISOString();
        row.lastHealth = healthy ? "healthy" : "degraded";
        if (!healthy && row.state !== "degraded") {
          row.state = "degraded";
          changed = true;
        }
        if (!healthy && pack.activeVersion === row.version) {
          pack.activeVersion = null;
          changed = true;
        }
        if (!healthy && pack.previousActiveVersion === row.version) {
          pack.previousActiveVersion = null;
          changed = true;
        }
      }
    }

    for (const packEntry of fs.readdirSync(this.options.rootDir, { withFileTypes: true })) {
      if (!packEntry.isDirectory() || packEntry.isSymbolicLink() || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(packEntry.name)) continue;
      const packId = packEntry.name;
      const pack = state.packs[packId] ?? {
        packId,
        activeVersion: null,
        previousActiveVersion: null,
        versions: [],
      };
      for (const versionEntry of fs.readdirSync(path.join(this.options.rootDir, packId), { withFileTypes: true })) {
        if (!versionEntry.isDirectory() || versionEntry.isSymbolicLink()) continue;
        const version = versionEntry.name;
        if (pack.versions.some((row) => row.version === version)) continue;
        const rootDir = this.versionDir(packId, version);
        const verification = verifyP11InstalledPack({ rootDir, options: this.options });
        if (!verification.ok || verification.manifest?.id !== packId || verification.manifest.version !== version) continue;
        const installedAt = fs.statSync(rootDir).mtime.toISOString();
        pack.versions.push({ version, state: "installed_inactive", installedAt, lastHealthAt: installedAt, lastHealth: "healthy" });
        state.packs[packId] = pack;
        changed = true;
      }
    }
    if (changed) this.writeState(state);
  }

  discover(): P11InstalledPackState[] {
    return Object.values(this.readState().packs)
      .map((pack) => JSON.parse(JSON.stringify(pack)) as P11InstalledPackState)
      .sort((a, b) => a.packId.localeCompare(b.packId));
  }

  inspect(packId: string): P11InstalledPackState | null {
    const pack = this.readState().packs[packId];
    return pack ? JSON.parse(JSON.stringify(pack)) as P11InstalledPackState : null;
  }

  async downloadAndInstall(fetcher: () => Promise<P11PackArtifact>): Promise<P11InstalledPackState> {
    return this.install(await fetcher());
  }

  /** Inspect a local archive using exactly the same trust/platform gates as install. */
  preview(artifact: P11PackArtifact): P11PackVerification {
    return verifyP11PackArtifact(artifact, this.options);
  }
  previewPublisher(artifact: P11PackArtifact, keyId: string, publicKey: crypto.KeyObject): P11PackVerification {
    return verifyP11PackArtifact(artifact, { ...this.options, publisherKeys: { ...this.options.publisherKeys, [keyId]: publicKey } });
  }

  trustPublisher(keyId: string, publicKey: crypto.KeyObject): void {
    const existing = this.options.publisherKeys[keyId];
    if (existing) {
      const key = existing instanceof crypto.KeyObject ? existing : crypto.createPublicKey(existing);
      if (!key.export({ type: "spki", format: "der" }).equals(publicKey.export({ type: "spki", format: "der" }))) {
        throw new Error("Pack publisher key id is already bound.");
      }
    }
    this.options.publisherKeys[keyId] = publicKey;
  }

  publisherFingerprint(keyId: string): string | null {
    const value = this.options.publisherKeys[keyId];
    if (!value) return null;
    const key = value instanceof crypto.KeyObject ? value : crypto.createPublicKey(value);
    return crypto.createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
  }

  inspectManifest(packId: string, version: string): P11PackVerification {
    return verifyP11InstalledPack({ rootDir: this.versionDir(packId, version), options: this.options });
  }

  install(artifact: P11PackArtifact): P11InstalledPackState {
    const verification = verifyP11PackArtifact(artifact, this.options);
    if (!verification.ok) throw new Error("P11 pack verification failed: " + verification.errors.join(" "));
    const manifest = verification.manifest!;
    const dir = this.versionDir(manifest.id, manifest.version);
    if (fs.existsSync(dir)) throw new Error(`P11 pack ${manifest.id}@${manifest.version} is already installed.`);

    const packRoot = path.dirname(dir);
    fs.mkdirSync(packRoot, { recursive: true, mode: 0o700 });
    const packRootInfo = fs.lstatSync(packRoot);
    if (!packRootInfo.isDirectory() || packRootInfo.isSymbolicLink()) throw new Error("P11 pack destination must be a regular directory, not a symbolic link.");
    const staging = fs.mkdtempSync(path.join(packRoot, ".install-"));
    try {
      for (const [name, bytes] of Object.entries(verification.files)) {
        const target = path.resolve(staging, ...name.split("/"));
        const relative = path.relative(staging, target);
        if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`P11 pack path escapes staging: ${name}`);
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        const executable = verification.executableFiles.includes(name);
        const fd = fs.openSync(target, "wx", executable ? 0o700 : 0o600);
        try {
          fs.writeFileSync(fd, bytes);
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
      }
      const stagedHealth = verifyP11InstalledPack({ rootDir: staging, options: this.options });
      if (!stagedHealth.ok) throw new Error("Extracted P11 pack failed verification: " + stagedHealth.errors.join(" "));
      fs.renameSync(staging, dir);
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw error;
    }

    const state = this.readState();
    const pack = state.packs[manifest.id] ?? {
      packId: manifest.id,
      activeVersion: null,
      previousActiveVersion: null,
      versions: [],
    };
    pack.versions.push({
      version: manifest.version,
      state: "installed_inactive",
      installedAt: new Date().toISOString(),
      lastHealthAt: null,
      lastHealth: "unknown",
    });
    state.packs[manifest.id] = pack;
    try {
      this.writeState(state);
    } catch (error) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw error;
    }
    return this.inspect(manifest.id)!;
  }

  health(packId: string, version: string): { healthy: boolean; detail: string } {
    const dir = this.versionDir(packId, version);
    const verification = verifyP11InstalledPack({ rootDir: dir, options: this.options });
    const healthy = verification.ok && verification.manifest?.id === packId && verification.manifest.version === version;
    const detail = healthy ? "Installed pack files, signed checksums and compatibility health checks passed." : verification.errors.join(" ") || "Installed pack identity does not match its directory.";

    const state = this.readState();
    const pack = state.packs[packId];
    const row = pack?.versions.find((item) => item.version === version);
    if (row) {
      row.lastHealthAt = new Date().toISOString();
      row.lastHealth = healthy ? "healthy" : "degraded";
      row.state = healthy ? (pack.activeVersion === version ? "active" : "installed_inactive") : "degraded";
      if (!healthy && pack.activeVersion === version) pack.activeVersion = null;
      if (!healthy && pack.previousActiveVersion === version) pack.previousActiveVersion = null;
      this.writeState(state);
    }
    return { healthy, detail };
  }

  activate(packId: string, version: string): P11InstalledPackState {
    const state = this.readState();
    const pack = state.packs[packId];
    if (!pack) throw new Error(`P11 pack ${packId} is not installed.`);
    const row = pack.versions.find((item) => item.version === version);
    if (!row) throw new Error(`P11 pack ${packId}@${version} is not installed.`);
    const health = this.health(packId, version);
    if (!health.healthy) throw new Error("P11 pack failed health gate: " + health.detail);

    const refreshed = this.readState();
    const target = refreshed.packs[packId];
    if (target.activeVersion && target.activeVersion !== version) {
      target.previousActiveVersion = target.activeVersion;
      const previous = target.versions.find((item) => item.version === target.activeVersion);
      if (previous) previous.state = "installed_inactive";
    }
    target.activeVersion = version;
    target.versions.find((item) => item.version === version)!.state = "active";
    this.writeState(refreshed);
    return this.inspect(packId)!;
  }

  installAndActivate(artifact: P11PackArtifact): P11InstalledPackState {
    const verification = verifyP11PackArtifact(artifact, this.options);
    if (!verification.ok || !verification.manifest) throw new Error("P11 pack verification failed: " + verification.errors.join(" "));
    const manifest = verification.manifest;
    const before = this.inspect(manifest.id)?.activeVersion ?? null;
    this.install(artifact);
    try {
      return this.activate(manifest.id, manifest.version);
    } catch (error) {
      if (before) {
        try { this.activate(manifest.id, before); } catch { /* preserve original activation failure */ }
      }
      throw error;
    }
  }

  deactivate(packId: string): P11InstalledPackState {
    const state = this.readState();
    const pack = state.packs[packId];
    if (!pack) throw new Error(`P11 pack ${packId} is not installed.`);
    if (pack.activeVersion) {
      const row = pack.versions.find((item) => item.version === pack.activeVersion);
      if (row) row.state = "installed_inactive";
    }
    pack.previousActiveVersion = pack.activeVersion;
    pack.activeVersion = null;
    this.writeState(state);
    return this.inspect(packId)!;
  }

  rollback(packId: string): P11InstalledPackState {
    const state = this.readState();
    const pack = state.packs[packId];
    if (!pack?.previousActiveVersion) throw new Error("No P11 pack rollback target is available.");
    const targetVersion = pack.previousActiveVersion;
    const currentVersion = pack.activeVersion;
    const target = pack.versions.find((item) => item.version === targetVersion);
    if (!target) throw new Error("P11 rollback target is no longer installed.");
    const health = this.health(packId, targetVersion);
    if (!health.healthy) throw new Error("P11 rollback target failed health gate.");

    const refreshed = this.readState();
    const refreshedPack = refreshed.packs[packId];
    if (currentVersion) {
      const current = refreshedPack.versions.find((item) => item.version === currentVersion);
      if (current) current.state = "rolled_back";
    }
    refreshedPack.activeVersion = targetVersion;
    refreshedPack.previousActiveVersion = currentVersion;
    refreshedPack.versions.find((item) => item.version === targetVersion)!.state = "active";
    this.writeState(refreshed);
    return this.inspect(packId)!;
  }

  remove(packId: string, version: string): P11InstalledPackState | null {
    const state = this.readState();
    const pack = state.packs[packId];
    if (!pack) return null;
    if (pack.activeVersion === version) throw new Error("Deactivate a P11 pack before removing its active version.");
    const dir = this.versionDir(packId, version);
    let tombstone: string | null = null;
    try {
      const info = fs.lstatSync(dir);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("P11 pack version cannot be removed through a symbolic link or non-directory.");
      tombstone = `${dir}.removing-${crypto.randomUUID()}`;
      fs.renameSync(dir, tombstone);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    pack.versions = pack.versions.filter((item) => item.version !== version);
    if (pack.previousActiveVersion === version) pack.previousActiveVersion = null;
    if (pack.versions.length === 0) delete state.packs[packId];
    try {
      this.writeState(state);
    } catch (error) {
      if (tombstone && fs.existsSync(tombstone) && !fs.existsSync(dir)) fs.renameSync(tombstone, dir);
      throw error;
    }
    if (tombstone) {
      try { fs.rmSync(tombstone, { recursive: true, force: true }); } catch { /* startup recovery finalizes committed removals */ }
    }
    return this.inspect(packId);
  }

  pruneInactive(packId: string, keep = 1): string[] {
    const state = this.readState();
    const pack = state.packs[packId];
    if (!pack) return [];
    const inactive = pack.versions
      .filter((row) => row.version !== pack.activeVersion && row.version !== pack.previousActiveVersion)
      .sort((a, b) => b.installedAt.localeCompare(a.installedAt));
    const removed: string[] = [];
    const staged: Array<{ version: string; dir: string; tombstone: string }> = [];
    for (const row of inactive.slice(Math.max(0, keep))) {
      const dir = this.versionDir(packId, row.version);
      try {
        const info = fs.lstatSync(dir);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("P11 pack version cannot be pruned through a symbolic link or non-directory.");
        const tombstone = `${dir}.removing-${crypto.randomUUID()}`;
        fs.renameSync(dir, tombstone);
        staged.push({ version: row.version, dir, tombstone });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          for (const item of staged.reverse()) {
            if (fs.existsSync(item.tombstone) && !fs.existsSync(item.dir)) fs.renameSync(item.tombstone, item.dir);
          }
          throw error;
        }
      }
      pack.versions = pack.versions.filter((item) => item.version !== row.version);
      removed.push(row.version);
    }
    try {
      this.writeState(state);
    } catch (error) {
      for (const item of staged.reverse()) {
        if (fs.existsSync(item.tombstone) && !fs.existsSync(item.dir)) fs.renameSync(item.tombstone, item.dir);
      }
      throw error;
    }
    for (const item of staged) {
      try { fs.rmSync(item.tombstone, { recursive: true, force: true }); } catch { /* startup recovery finalizes committed removals */ }
    }
    return removed;
  }
}
