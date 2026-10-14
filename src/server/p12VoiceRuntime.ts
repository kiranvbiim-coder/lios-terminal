import crypto from "node:crypto";
import fs from "node:fs";
import { CommandExecutionError, runCommand } from "./exec/run-command";
import {
  P12_WHISPER_CPP_BUDGET,
  cloneConversationRequestWithTranscript,
  speechOutputPreferenceSchema,
  speechOutputResultSchema,
  transcriptionProviderDescriptorSchema,
  voiceConversationRequestSchema,
  voiceTranscriptSchema,
  whisperCppBenchmarkSchema,
  type SpeechOutputPreference,
  type SpeechOutputResult,
  type TranscriptionProviderDescriptor,
  type VoiceConversationRequest,
  type VoiceTranscript,
  type WhisperCppBenchmark,
} from "@shared/multimodalContracts";
import type { ConversationRequest } from "@shared/conversationRuntime";
import { planConversationWorkflow } from "./conversationRuntime";

export interface VoiceAudioInput {
  bytes: Uint8Array;
  mimeType: string;
  fileName?: string | null;
  language?: string | null;
  durationMs?: number | null;
}

export interface TranscriptionProvider {
  descriptor: TranscriptionProviderDescriptor;
  transcribe(input: VoiceAudioInput): Promise<{
    text: string;
    language?: string | null;
    durationMs?: number | null;
    confidence?: number | null;
  }>;
}

export interface SpeechOutputProvider {
  id: string;
  label: string;
  local: boolean;
  synthesize(input: { text: string; voiceId: string | null; rate: number }): Promise<{
    audio: Uint8Array;
    mimeType: string;
    voiceId?: string | null;
  }>;
}

const transcriptionProviders = new Map<string, TranscriptionProvider>();
const speechProviders = new Map<string, SpeechOutputProvider>();

export function registerTranscriptionProvider(provider: TranscriptionProvider): void {
  const descriptor = transcriptionProviderDescriptorSchema.parse(provider.descriptor);
  transcriptionProviders.set(descriptor.id, { ...provider, descriptor });
}

export function unregisterTranscriptionProvider(providerId: string): boolean {
  return transcriptionProviders.delete(providerId);
}

export function listTranscriptionProviders(): TranscriptionProviderDescriptor[] {
  return [...transcriptionProviders.values()]
    .map((provider) => provider.descriptor)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function transcribeVoiceInput(providerId: string, audio: VoiceAudioInput): Promise<VoiceTranscript> {
  const provider = transcriptionProviders.get(providerId);
  if (!provider) throw new Error(`Voice transcription provider "${providerId}" is not registered.`);
  if (!provider.descriptor.acceptedMimeTypes.includes(audio.mimeType)) {
    throw new Error(`Voice transcription provider "${providerId}" does not accept ${audio.mimeType}.`);
  }
  if (audio.bytes.byteLength <= 0) throw new Error("Voice input is empty.");
  if (audio.bytes.byteLength > provider.descriptor.maxAudioBytes) {
    throw new Error("Voice input exceeds the transcription provider size limit.");
  }
  const output = await provider.transcribe(audio);
  const text = output.text.trim();
  if (!text) throw new Error("Voice transcription returned an empty transcript.");
  const hash = crypto.createHash("sha256").update(audio.bytes).digest("hex");
  return voiceTranscriptSchema.parse({
    schemaVersion: "1",
    transcriptId: crypto.randomUUID(),
    text,
    language: output.language ?? audio.language ?? null,
    durationMs: output.durationMs ?? audio.durationMs ?? null,
    providerId: provider.descriptor.id,
    local: provider.descriptor.local,
    confidence: output.confidence ?? null,
    audioSha256: hash,
    sourceRef: `audio-sha256:${hash}`,
  });
}

export function prepareVoiceConversationRequest(input: {
  baseRequest: ConversationRequest;
  transcript?: VoiceTranscript;
  transcripts?: VoiceTranscript[];
  editedText?: string | null;
}): VoiceConversationRequest {
  const transcripts = input.transcripts ?? (input.transcript ? [input.transcript] : []);
  if (!transcripts.length || transcripts.length > 5) throw new Error("Voice requests require between one and five verified transcripts.");
  const originalText = transcripts.map((transcript) => transcript.text).join(" ").trim();
  const text = (input.editedText ?? originalText).trim();
  const request = cloneConversationRequestWithTranscript(input.baseRequest, text);
  const plan = planConversationWorkflow(request);
  const highImpact = plan.steps.some((step) => step.permissionClass !== "safe_auto");
  return voiceConversationRequestSchema.parse({
    modality: "voice",
    request,
    transcripts,
    transcriptEdited: text !== originalText,
    transcriptReviewRequired: highImpact,
    transcriptReviewReason: highImpact
      ? "Review the transcript before executing an action that requires confirmation or has material state impact."
      : null,
  });
}

export function assertVoiceTranscriptReviewed(input: VoiceConversationRequest, reviewed: boolean): void {
  if (input.transcriptReviewRequired && !reviewed) {
    throw new Error("High-impact voice command requires transcript review before execution.");
  }
}

export function registerSpeechOutputProvider(provider: SpeechOutputProvider): void {
  if (!provider.id.trim()) throw new Error("Speech output provider id is required.");
  speechProviders.set(provider.id, provider);
}

export function unregisterSpeechOutputProvider(providerId: string): boolean {
  return speechProviders.delete(providerId);
}

export function listSpeechOutputProviders(): Array<{ id: string; label: string; local: boolean }> {
  return [...speechProviders.values()]
    .map(({ id, label, local }) => ({ id, label, local }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function synthesizeSpeechOutput(
  text: string,
  preferenceInput: SpeechOutputPreference,
): Promise<SpeechOutputResult | null> {
  const preference = speechOutputPreferenceSchema.parse(preferenceInput);
  if (!preference.enabled) return null;
  if (!preference.providerId) throw new Error("Speech output is enabled but no provider is selected.");
  const provider = speechProviders.get(preference.providerId);
  if (!provider) throw new Error(`Speech output provider "${preference.providerId}" is not registered.`);
  if (preference.localOnly && !provider.local) {
    throw new Error("Speech output preference requires a local provider.");
  }
  const normalized = text.trim();
  if (!normalized) return null;
  if (normalized.length > 50_000) throw new Error("Speech output text exceeds the P12 safety limit.");
  const result = await provider.synthesize({
    text: normalized,
    voiceId: preference.voiceId,
    rate: preference.rate,
  });
  return speechOutputResultSchema.parse({
    providerId: provider.id,
    voiceId: result.voiceId ?? preference.voiceId,
    mimeType: result.mimeType,
    byteLength: result.audio.byteLength,
    audio: result.audio,
    local: provider.local,
  });
}

function rethrowWhisperCppError(error: unknown): never {
  if (error instanceof CommandExecutionError) {
    if (error.result.timedOut) {
      throw new Error("whisper.cpp transcription timed out.", { cause: error });
    }
    if (error.result.reason === "exit" && error.result.exitCode !== 0) {
      throw new Error(`whisper.cpp exited with code ${error.result.exitCode}: ${error.result.stderr.slice(-1000)}`, { cause: error });
    }
  }
  throw error;
}

export function createWhisperCppProvider(input: {
  executable: string;
  model: string;
  maxAudioBytes?: number;
  extraArgs?: string[];
}): TranscriptionProvider {
  return {
    descriptor: {
      id: "lios.voice.whisper-cpp",
      label: "LiOS Local Voice",
      local: true,
      languages: [],
      maxAudioBytes: input.maxAudioBytes ?? 100 * 1024 * 1024,
      acceptedMimeTypes: [
        "audio/wav",
        "audio/x-wav",
        "audio/mpeg",
        "audio/mp4",
        "audio/webm",
        "audio/ogg",
      ],
      optionalRuntimePackId: "lios.voice",
    },
    async transcribe(audio) {
      const temporary = `${process.cwd()}/.lios-whisper-${crypto.randomUUID()}.audio`;
      try {
        fs.writeFileSync(temporary, audio.bytes, { mode: 0o600 });
        const args = [
          "-m", input.model,
          "-f", temporary,
          "-nt",
          ...(audio.language ? ["-l", audio.language] : []),
          ...(input.extraArgs ?? []),
        ];
        const result = await runCommand({
          argv: [input.executable, ...args],
          timeoutMs: 15 * 60 * 1000,
          maxOutputChars: 2 * 1024 * 1024,
        }).catch(rethrowWhisperCppError);
        return {
          text: result.stdout.trim(),
          language: audio.language ?? null,
          durationMs: audio.durationMs ?? null,
          confidence: null,
        };
      } finally {
        fs.rmSync(temporary, { force: true });
      }
    },
  };
}

export async function benchmarkWhisperCpp(input: {
  executable: string;
  model: string;
  audioFile: string;
  audioDurationMs: number;
  language?: string | null;
  timeoutMs?: number;
  peakRssMb?: number | null;
}): Promise<WhisperCppBenchmark> {
  const executableStat = fs.statSync(input.executable);
  const modelStat = fs.statSync(input.model);
  const result = await runCommand({
    argv: [
      input.executable,
      "-m", input.model,
      "-f", input.audioFile,
      "-nt",
      ...(input.language ? ["-l", input.language] : []),
    ],
    timeoutMs: input.timeoutMs ?? 15 * 60 * 1000,
    maxOutputChars: 2 * 1024 * 1024,
  }).catch(rethrowWhisperCppError);
  const realtimeFactor = result.wallDurationMs / input.audioDurationMs;
  const failures: string[] = [];
  if (realtimeFactor > P12_WHISPER_CPP_BUDGET.maxRealtimeFactor) failures.push("Realtime factor exceeds the P12 voice budget.");
  if ((input.peakRssMb ?? 0) > P12_WHISPER_CPP_BUDGET.maxPeakRssMb) failures.push("Peak RSS exceeds the P12 voice budget.");
  if (executableStat.size > P12_WHISPER_CPP_BUDGET.maxExecutableBytes) failures.push("whisper.cpp executable exceeds the P12 packaging budget.");
  if (modelStat.size > P12_WHISPER_CPP_BUDGET.maxModelBytes) failures.push("whisper.cpp model exceeds the P12 optional-pack budget.");
  return whisperCppBenchmarkSchema.parse({
    schemaVersion: "1",
    engine: "whisper.cpp",
    executable: input.executable,
    model: input.model,
    platform: `${process.platform}-${process.arch}`,
    audioDurationMs: input.audioDurationMs,
    wallDurationMs: result.wallDurationMs,
    realtimeFactor,
    peakRssMb: input.peakRssMb ?? null,
    executableBytes: executableStat.size,
    modelBytes: modelStat.size,
    transcriptChars: result.stdout.trim().length,
    passed: failures.length === 0,
    failures,
  });
}
