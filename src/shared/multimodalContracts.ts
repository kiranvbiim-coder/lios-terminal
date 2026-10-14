import { z } from "zod";
import { conversationRequestSchema, type ConversationRequest } from "./conversationRuntime";

export const conversationInputModalitySchema = z.enum([
  "text",
  "voice",
  "document",
  "image",
  "screenshot",
]);
export type ConversationInputModality = z.infer<typeof conversationInputModalitySchema>;

export const multimodalAttachmentKindSchema = z.enum(["document", "image", "screenshot"]);
export type MultimodalAttachmentKind = z.infer<typeof multimodalAttachmentKindSchema>;

export const multimodalAttachmentSchema = z.object({
  id: z.string().uuid(),
  kind: multimodalAttachmentKindSchema,
  fileName: z.string().trim().min(1).max(240),
  mimeType: z.string().trim().min(1).max(200),
  byteLength: z.number().int().positive().max(100 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceRef: z.string().trim().min(1).max(1_000),
  localPath: z.string().trim().max(2_000).nullable().default(null),
  textPreview: z.string().max(20_000).nullable().default(null),
  width: z.number().int().positive().max(100_000).nullable().default(null),
  height: z.number().int().positive().max(100_000).nullable().default(null),
}).strict();
export type MultimodalAttachment = z.infer<typeof multimodalAttachmentSchema>;

export const voiceTranscriptSchema = z.object({
  schemaVersion: z.literal("1"),
  transcriptId: z.string().uuid(),
  text: z.string().trim().min(1).max(50_000),
  language: z.string().trim().min(2).max(50).nullable().default(null),
  durationMs: z.number().int().positive().max(4 * 60 * 60 * 1000).nullable().default(null),
  providerId: z.string().trim().min(1).max(200),
  local: z.boolean(),
  confidence: z.number().min(0).max(1).nullable().default(null),
  audioSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceRef: z.string().trim().min(1).max(1_000),
}).strict();
export type VoiceTranscript = z.infer<typeof voiceTranscriptSchema>;

export const voiceConversationRequestSchema = z.object({
  modality: z.literal("voice"),
  request: conversationRequestSchema,
  transcripts: z.array(voiceTranscriptSchema).min(1).max(5),
  transcriptEdited: z.boolean().default(false),
  transcriptReviewRequired: z.boolean(),
  transcriptReviewReason: z.string().trim().max(1_000).nullable().default(null),
}).strict();
export type VoiceConversationRequest = z.infer<typeof voiceConversationRequestSchema>;

export const voiceExecutionReviewSchema = z.object({
  transcripts: z.array(voiceTranscriptSchema).min(1).max(5),
  transcriptReviewed: z.boolean(),
}).strict();
export type VoiceExecutionReview = z.infer<typeof voiceExecutionReviewSchema>;

export const speechOutputPreferenceSchema = z.object({
  enabled: z.boolean().default(false),
  providerId: z.string().trim().min(1).max(200).nullable().default(null),
  voiceId: z.string().trim().min(1).max(200).nullable().default(null),
  rate: z.number().min(0.5).max(2).default(1),
  localOnly: z.boolean().default(false),
}).strict();
export type SpeechOutputPreference = z.infer<typeof speechOutputPreferenceSchema>;

export const speechOutputResultSchema = z.object({
  providerId: z.string().trim().min(1).max(200),
  voiceId: z.string().trim().max(200).nullable().default(null),
  mimeType: z.string().trim().min(1).max(200),
  byteLength: z.number().int().nonnegative(),
  audio: z.instanceof(Uint8Array),
  local: z.boolean(),
}).strict();
export type SpeechOutputResult = z.infer<typeof speechOutputResultSchema>;

export const transcriptionProviderDescriptorSchema = z.object({
  id: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(240),
  local: z.boolean(),
  languages: z.array(z.string().trim().min(2).max(50)).max(500).default([]),
  maxAudioBytes: z.number().int().positive(),
  acceptedMimeTypes: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
  optionalRuntimePackId: z.string().trim().max(200).nullable().default(null),
}).strict();
export type TranscriptionProviderDescriptor = z.infer<typeof transcriptionProviderDescriptorSchema>;

export const whisperCppBenchmarkSchema = z.object({
  schemaVersion: z.literal("1"),
  engine: z.literal("whisper.cpp"),
  executable: z.string().trim().min(1).max(2_000),
  model: z.string().trim().min(1).max(2_000),
  platform: z.string().trim().min(1).max(100),
  audioDurationMs: z.number().int().positive(),
  wallDurationMs: z.number().int().positive(),
  realtimeFactor: z.number().positive(),
  peakRssMb: z.number().positive().nullable().default(null),
  executableBytes: z.number().int().nonnegative().nullable().default(null),
  modelBytes: z.number().int().nonnegative().nullable().default(null),
  transcriptChars: z.number().int().nonnegative(),
  passed: z.boolean(),
  failures: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
}).strict();
export type WhisperCppBenchmark = z.infer<typeof whisperCppBenchmarkSchema>;

export const P12_WHISPER_CPP_BUDGET = Object.freeze({
  maxRealtimeFactor: 1.5,
  maxPeakRssMb: 2_048,
  maxExecutableBytes: 100 * 1024 * 1024,
  maxModelBytes: 1_600 * 1024 * 1024,
});

export function cloneConversationRequestWithTranscript(
  request: ConversationRequest,
  transcript: string,
): ConversationRequest {
  return conversationRequestSchema.parse({ ...request, message: transcript });
}
