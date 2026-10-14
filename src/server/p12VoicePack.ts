import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { dataRoot } from "./dataRoot";

export type P12VoiceAssetSource =
  | "environment"
  | "user_config"
  | "managed_pack"
  | "packaged_resources"
  | "legacy_data"
  | "system"
  | null;

export interface P12VoiceRuntimeResolution {
  packId: "lios.voice";
  managedPackRelativeRoot: "runtime-packs/lios.voice/current";
  whisperExecutable: string | null;
  modelPath: string | null;
  ffmpegPath: string | null;
  sources: {
    whisper: P12VoiceAssetSource;
    model: P12VoiceAssetSource;
    ffmpeg: P12VoiceAssetSource;
  };
  transcriptionReady: boolean;
  browserRecordingReady: boolean;
  installPolicy: "user_or_release_provisioned_no_silent_download";
}

export interface P12VoiceRuntimePublicStatus {
  packId: "lios.voice";
  managedPackRelativeRoot: "runtime-packs/lios.voice/current";
  whisperBinaryFound: boolean;
  modelFound: boolean;
  ffmpegFound: boolean;
  transcriptionReady: boolean;
  browserRecordingReady: boolean;
  sources: P12VoiceRuntimeResolution["sources"];
  installPolicy: P12VoiceRuntimeResolution["installPolicy"];
  guidance: string;
}

interface ResolveOptions {
  dataDir?: string;
  resourcesPath?: string | null;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
  explicitPaths?: {
    whisperExecutable?: string;
    model?: string;
    ffmpeg?: string;
  };
  systemLookup?: (name: string) => string | null;
}

const MANAGED_RELATIVE_ROOT = "runtime-packs/lios.voice/current" as const;

function regularFile(candidate: string | undefined | null): string | null {
  if (!candidate) return null;
  try {
    return fs.statSync(candidate).isFile() ? path.resolve(candidate) : null;
  } catch {
    return null;
  }
}

function firstFile(candidates: readonly (string | undefined | null)[]): string | null {
  for (const candidate of candidates) {
    const resolved = regularFile(candidate);
    if (resolved) return resolved;
  }
  return null;
}

function executableNames(base: string, platform: NodeJS.Platform): string[] {
  return platform === "win32" ? [`${base}.exe`, base] : [base];
}

function lookupSystemBinary(name: string, platform: NodeJS.Platform, homeDir: string): string | null {
  const names = executableNames(name, platform);
  const fixedDirs = platform === "win32"
    ? []
    : ["/opt/homebrew/bin", "/usr/local/bin", path.join(homeDir, ".homebrew", "bin"), "/usr/bin", "/bin"];
  for (const dir of fixedDirs) {
    const found = firstFile(names.map((entry) => path.join(dir, entry)));
    if (found) return found;
  }
  const command = platform === "win32" ? "where.exe" : "which";
  for (const entry of names) {
    const result = spawnSync(command, [entry], { encoding: "utf8", windowsHide: true });
    if (result.status !== 0) continue;
    const found = result.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
      .map((value) => regularFile(value)).find((value): value is string => Boolean(value));
    if (found) return found;
  }
  return null;
}

function rootCandidates(input: {
  env: NodeJS.ProcessEnv;
  dataDir: string;
  resourcesPath: string | null;
}): Array<{ root: string; source: Exclude<P12VoiceAssetSource, "legacy_data" | "system" | null> }> {
  const roots: Array<{ root: string; source: Exclude<P12VoiceAssetSource, "legacy_data" | "system" | null> }> = [];
  if (input.env.LIOS_VOICE_PACK_DIR?.trim()) {
    roots.push({ root: path.resolve(input.env.LIOS_VOICE_PACK_DIR), source: "environment" });
  }
  roots.push({ root: path.join(input.dataDir, MANAGED_RELATIVE_ROOT), source: "managed_pack" });
  if (input.resourcesPath) {
    roots.push({ root: path.join(input.resourcesPath, MANAGED_RELATIVE_ROOT), source: "packaged_resources" });
  }
  return roots;
}

function findRootAsset(
  roots: ReturnType<typeof rootCandidates>,
  relativeCandidates: string[],
): { path: string; source: P12VoiceAssetSource } | null {
  for (const root of roots) {
    const found = firstFile(relativeCandidates.map((relative) => path.join(root.root, relative)));
    if (found) return { path: found, source: root.source };
  }
  return null;
}

export function resolveP12VoiceRuntime(options: ResolveOptions = {}): P12VoiceRuntimeResolution {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  const dataDir = options.dataDir ? path.resolve(options.dataDir) : dataRoot({ env, homedir: options.homeDir });
  const resourcesPath = options.resourcesPath === undefined
    ? ((process as typeof process & { resourcesPath?: string }).resourcesPath ?? null)
    : options.resourcesPath;
  const roots = rootCandidates({ env, dataDir, resourcesPath });
  const explicitPaths = options.explicitPaths ?? {};
  const systemLookup = options.systemLookup ?? ((name: string) => lookupSystemBinary(name, platform, homeDir));

  const whisperEnv = regularFile(env.LIOS_WHISPER_CPP_BIN);
  const whisperConfigured = !whisperEnv ? regularFile(explicitPaths.whisperExecutable) : null;
  const whisperPack = findRootAsset(
    roots,
    executableNames("whisper-cli", platform).flatMap((name) => [path.join("bin", name), name]),
  );
  const whisperSystem = !whisperEnv && !whisperConfigured && !whisperPack
    ? systemLookup("whisper-cli")
    : null;
  const whisperExecutable = whisperEnv ?? whisperConfigured ?? whisperPack?.path ?? whisperSystem;
  const whisperSource: P12VoiceAssetSource = whisperEnv
    ? "environment"
    : whisperConfigured
      ? "user_config"
      : whisperPack?.source ?? (whisperSystem ? "system" : null);

  const modelEnv = regularFile(env.LIOS_WHISPER_MODEL);
  const modelConfigured = !modelEnv ? regularFile(explicitPaths.model) : null;
  const modelPack = findRootAsset(roots, [
    path.join("models", "ggml-tiny.en.bin"),
    path.join("models", "ggml-base.en.bin"),
    path.join("models", "ggml-tiny.bin"),
    path.join("models", "ggml-base.bin"),
  ]);
  const legacyModel = !modelEnv && !modelConfigured && !modelPack
    ? firstFile([
        path.join(dataDir, "models", "ggml-tiny.en.bin"),
        path.join(dataDir, "models", "ggml-base.en.bin"),
        path.join(dataDir, "models", "ggml-tiny.bin"),
        path.join(dataDir, "models", "ggml-base.bin"),
      ])
    : null;
  const modelPath = modelEnv ?? modelConfigured ?? modelPack?.path ?? legacyModel;
  const modelSource: P12VoiceAssetSource = modelEnv
    ? "environment"
    : modelConfigured
      ? "user_config"
      : modelPack?.source ?? (legacyModel ? "legacy_data" : null);

  const ffmpegEnv = regularFile(env.LIOS_FFMPEG_BIN);
  const ffmpegConfigured = !ffmpegEnv ? regularFile(explicitPaths.ffmpeg) : null;
  const ffmpegPack = findRootAsset(
    roots,
    executableNames("ffmpeg", platform).flatMap((name) => [path.join("bin", name), name]),
  );
  const ffmpegSystem = !ffmpegEnv && !ffmpegConfigured && !ffmpegPack ? systemLookup("ffmpeg") : null;
  const ffmpegPath = ffmpegEnv ?? ffmpegConfigured ?? ffmpegPack?.path ?? ffmpegSystem;
  const ffmpegSource: P12VoiceAssetSource = ffmpegEnv
    ? "environment"
    : ffmpegConfigured
      ? "user_config"
      : ffmpegPack?.source ?? (ffmpegSystem ? "system" : null);

  const transcriptionReady = Boolean(whisperExecutable && modelPath);
  return {
    packId: "lios.voice",
    managedPackRelativeRoot: MANAGED_RELATIVE_ROOT,
    whisperExecutable,
    modelPath,
    ffmpegPath,
    sources: { whisper: whisperSource, model: modelSource, ffmpeg: ffmpegSource },
    transcriptionReady,
    browserRecordingReady: transcriptionReady && Boolean(ffmpegPath),
    installPolicy: "user_or_release_provisioned_no_silent_download",
  };
}

export function p12VoiceRuntimePublicStatus(
  resolution = resolveP12VoiceRuntime(),
): P12VoiceRuntimePublicStatus {
  const missing = [
    !resolution.whisperExecutable ? "whisper.cpp binary" : null,
    !resolution.modelPath ? "Whisper model" : null,
    !resolution.ffmpegPath ? "ffmpeg" : null,
  ].filter((value): value is string => Boolean(value));
  const guidance = resolution.browserRecordingReady
    ? "Local voice input is ready."
    : missing.length
      ? `Local voice input needs ${missing.join(", ")}. Provision the optional lios.voice pack under runtime-packs/lios.voice/current or configure the explicit local runtime paths.`
      : "Local voice input is not ready.";
  return {
    packId: resolution.packId,
    managedPackRelativeRoot: resolution.managedPackRelativeRoot,
    whisperBinaryFound: Boolean(resolution.whisperExecutable),
    modelFound: Boolean(resolution.modelPath),
    ffmpegFound: Boolean(resolution.ffmpegPath),
    transcriptionReady: resolution.transcriptionReady,
    browserRecordingReady: resolution.browserRecordingReady,
    sources: resolution.sources,
    installPolicy: resolution.installPolicy,
    guidance,
  };
}
