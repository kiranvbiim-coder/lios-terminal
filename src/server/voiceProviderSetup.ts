// Best-effort registration of real P12 voice providers against the local
// machine. Everything here is optional and additive: if a binary or model
// is missing, we log once and skip -- the app must never fail to start
// because a voice pack is absent (matches the existing pattern for
// FINNHUB_API_KEY/LSE_API_KEY optional integrations in server/index.ts).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runCommand } from "./exec/run-command";
import {
  createWhisperCppProvider,
  listSpeechOutputProviders,
  listTranscriptionProviders,
  registerSpeechOutputProvider,
  registerTranscriptionProvider,
  unregisterSpeechOutputProvider,
  unregisterTranscriptionProvider,
  type SpeechOutputProvider,
} from "./p12VoiceRuntime";
import { log } from "./logger";
import { p12VoiceRuntimePublicStatus, resolveP12VoiceRuntime } from "./p12VoicePack";
import { dataPath } from "./dataRoot";

let bootstrapped = false;

interface VoiceRuntimeConfig {
  whisperExecutable?: string;
  model?: string;
  ffmpeg?: string;
}

function voiceRuntimeConfigPath(): string {
  return dataPath("voice-runtime.json");
}

function readVoiceRuntimeConfig(): VoiceRuntimeConfig {
  try {
    if (!fs.existsSync(voiceRuntimeConfigPath())) return {};
    const parsed = JSON.parse(fs.readFileSync(voiceRuntimeConfigPath(), "utf8")) as Record<string, unknown>;
    return {
      whisperExecutable: typeof parsed.whisperExecutable === "string" ? parsed.whisperExecutable : undefined,
      model: typeof parsed.model === "string" ? parsed.model : undefined,
      ffmpeg: typeof parsed.ffmpeg === "string" ? parsed.ffmpeg : undefined,
    };
  } catch {
    return {};
  }
}

function resolveConfiguredVoiceRuntime() {
  const config = readVoiceRuntimeConfig();
  return resolveP12VoiceRuntime({
    explicitPaths: {
      whisperExecutable: config.whisperExecutable,
      model: config.model,
      ffmpeg: config.ffmpeg,
    },
  });
}

function resolveWhisperExecutable(): string | null {
  return resolveConfiguredVoiceRuntime().whisperExecutable;
}

function resolveVoiceModelPath(): string | null {
  return resolveConfiguredVoiceRuntime().modelPath;
}

export function resolveVoiceFfmpegPath(): string | null {
  return resolveConfiguredVoiceRuntime().ffmpegPath;
}

export function inspectVoiceRuntimePublicStatus() {
  return p12VoiceRuntimePublicStatus(resolveConfiguredVoiceRuntime());
}

export function inspectVoiceRuntimeSetup(): {
  transcriptionProviderReady: boolean;
  recordingReady: boolean;
  whisperExecutable: { available: boolean; name: string | null };
  model: { available: boolean; name: string | null };
  ffmpeg: { available: boolean; name: string | null };
  transcriptionProviders: string[];
  speechProviders: string[];
} {
  const runtime = resolveConfiguredVoiceRuntime();
  const executable = runtime.whisperExecutable;
  const model = runtime.modelPath;
  const ffmpeg = runtime.ffmpegPath;
  return {
    transcriptionProviderReady: Boolean(executable && model),
    recordingReady: Boolean(executable && model && ffmpeg),
    whisperExecutable: { available: Boolean(executable), name: executable ? path.basename(executable) : null },
    model: { available: Boolean(model), name: model ? path.basename(model) : null },
    ffmpeg: { available: Boolean(ffmpeg), name: ffmpeg ? path.basename(ffmpeg) : null },
    transcriptionProviders: listTranscriptionProviders().map((item) => item.id),
    speechProviders: listSpeechOutputProviders().map((item) => item.id),
  };
}

function registerLocalWhisperCpp(): void {
  const runtime = resolveConfiguredVoiceRuntime();
  if (!runtime.whisperExecutable || !runtime.modelPath) {
    log("Local voice transcription disabled: the optional lios.voice runtime is incomplete. No model or binary is downloaded automatically.");
    return;
  }
  registerTranscriptionProvider(
    createWhisperCppProvider({
      executable: runtime.whisperExecutable,
      model: runtime.modelPath,
      maxAudioBytes: 25 * 1024 * 1024,
    }),
  );
  log(`Local voice transcription enabled from ${runtime.sources.whisper ?? "local"} runtime (${path.basename(runtime.modelPath)}).`);
}

// macOS ships `say` (text-to-speech) and `afconvert` (format conversion)
// as system binaries at fixed paths -- no install required on this
// platform, so this is the natural zero-dependency default speech-output
// provider for the primary desktop target.
function registerMacSayProvider(): void {
  if (process.platform !== "darwin") return;
  const sayBin = "/usr/bin/say";
  const afconvertBin = "/usr/bin/afconvert";
  if (!fs.existsSync(sayBin) || !fs.existsSync(afconvertBin)) return;

  const provider: SpeechOutputProvider = {
    id: "lios.voice.mac-say",
    label: "LiOS Local Voice (macOS)",
    local: true,
    async synthesize(input) {
      input.signal?.throwIfAborted();
      const stamp = `${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
      const aiffPath = path.join(os.tmpdir(), `lios-speak-${stamp}.aiff`);
      const wavPath = path.join(os.tmpdir(), `lios-speak-${stamp}.wav`);
      try {
        const rateWpm = Math.round(175 * Math.min(2, Math.max(0.5, input.rate || 1)));
        const sayArgs = ["-o", aiffPath, "-r", String(rateWpm)];
        if (input.voiceId) sayArgs.push("-v", input.voiceId);
        sayArgs.push(input.text);
        await runCommand({
          argv: [sayBin, ...sayArgs],
          timeoutMs: 30_000,
          maxOutputChars: 64 * 1024,
          signal: input.signal,
        });
        input.signal?.throwIfAborted();
        await runCommand({
          argv: [afconvertBin, "-f", "WAVE", "-d", "LEI16@22050", "-c", "1", aiffPath, wavPath],
          timeoutMs: 30_000,
          maxOutputChars: 64 * 1024,
          signal: input.signal,
        });
        input.signal?.throwIfAborted();
        const audio = fs.readFileSync(wavPath);
        return { audio, mimeType: "audio/wav", voiceId: input.voiceId ?? null };
      } finally {
        // runCommand joins native extinction before this owned-file cleanup.
        try {
          fs.rmSync(aiffPath, { force: true });
        } finally {
          fs.rmSync(wavPath, { force: true });
        }
      }
    },
  };
  registerSpeechOutputProvider(provider);
  log(`Local speech output enabled: macOS "say" (${sayBin}).`);
}

export function refreshVoiceProviders(): ReturnType<typeof inspectVoiceRuntimeSetup> {
  unregisterTranscriptionProvider("lios.voice.whisper-cpp");
  unregisterSpeechOutputProvider("lios.voice.mac-say");
  bootstrapped = false;
  bootstrapVoiceProviders();
  return inspectVoiceRuntimeSetup();
}

export function bootstrapVoiceProviders(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  try {
    registerLocalWhisperCpp();
  } catch (error) {
    log(`Local voice transcription setup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    registerMacSayProvider();
  } catch (error) {
    log(`Local speech output setup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
