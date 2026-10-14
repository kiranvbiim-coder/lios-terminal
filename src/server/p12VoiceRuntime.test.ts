import assert from "node:assert/strict";
import test from "node:test";
import {
  assertVoiceTranscriptReviewed,
  listSpeechOutputProviders,
  listTranscriptionProviders,
  prepareVoiceConversationRequest,
  registerSpeechOutputProvider,
  registerTranscriptionProvider,
  synthesizeSpeechOutput,
  transcribeVoiceInput,
  unregisterSpeechOutputProvider,
  unregisterTranscriptionProvider,
} from "./p12VoiceRuntime";
import { planConversationWorkflow } from "./conversationRuntime";

const baseRequest = {
  requestId: "00000000-0000-4000-8000-000000001201",
  continuationOf: null,
  message: "placeholder",
  executionMode: "deterministic_first" as const,
  aiDirectApproved: false,
  approvals: [],
  transmissionPolicy: {
    mode: "configured" as const,
    providerAllow: [],
    providerDeny: [],
    allowProjectInstructions: true,
    allowResourceReferences: true,
    allowSelection: true,
    allowToolCalling: true,
    dataClassification: "private" as const,
  },
  context: { symbol: "AAPL", view: "valuation", sessionId: "session-1", activeObjectRefs: ["security:AAPL"] },
};

test("P12 voice adapter produces the same canonical ConversationRequest/context as typed input", async () => {
  registerTranscriptionProvider({
    descriptor: {
      id: "test.local-stt",
      label: "Test STT",
      local: true,
      languages: ["en"],
      maxAudioBytes: 1024,
      acceptedMimeTypes: ["audio/wav"],
      optionalRuntimePackId: null,
    },
    async transcribe() {
      return { text: "technical analysis AAPL with RSI and MACD", language: "en", confidence: 0.99 };
    },
  });
  try {
    const transcript = await transcribeVoiceInput("test.local-stt", {
      bytes: Buffer.from("fake-audio"),
      mimeType: "audio/wav",
      durationMs: 1000,
    });
    const voice = prepareVoiceConversationRequest({ baseRequest, transcript });
    assert.equal(voice.request.message, transcript.text);
    assert.deepEqual(voice.request.context, baseRequest.context);
    assert.equal(voice.transcriptReviewRequired, false);
  } finally {
    unregisterTranscriptionProvider("test.local-stt");
  }
});

test("P12 high-impact spoken command requires transcript review before execution", () => {
  const voice = prepareVoiceConversationRequest({
    baseRequest,
    transcript: {
      schemaVersion: "1",
      transcriptId: "00000000-0000-4000-8000-000000001202",
      text: "backtest AAPL with moving average strategy",
      language: "en",
      durationMs: 2000,
      providerId: "test.local-stt",
      local: true,
      confidence: 0.98,
      audioSha256: "a".repeat(64),
      sourceRef: "audio:a",
    },
  });
  assert.equal(voice.transcriptReviewRequired, true);
  assert.throws(() => assertVoiceTranscriptReviewed(voice, false), /requires transcript review/i);
  assert.doesNotThrow(() => assertVoiceTranscriptReviewed(voice, true));
});

test("P12 transcript can be edited before entering the canonical runtime", () => {
  const voice = prepareVoiceConversationRequest({
    baseRequest,
    transcript: {
      schemaVersion: "1",
      transcriptId: "00000000-0000-4000-8000-000000001203",
      text: "technical analysis apple",
      language: "en",
      durationMs: 1000,
      providerId: "test.local-stt",
      local: true,
      confidence: null,
      audioSha256: "b".repeat(64),
      sourceRef: "audio:b",
    },
    editedText: "technical analysis AAPL with RSI and MACD",
  });
  assert.equal(voice.transcriptEdited, true);
  assert.equal(voice.request.message, "technical analysis AAPL with RSI and MACD");
});

test("P12 speech output is opt-in, provider-neutral and local-only aware", async () => {
  registerSpeechOutputProvider({
    id: "test.local-tts",
    label: "Test Local TTS",
    local: true,
    async synthesize({ text }) {
      return { audio: Buffer.from(text), mimeType: "audio/wav", voiceId: "voice-1" };
    },
  });
  try {
    assert.equal(await synthesizeSpeechOutput("hello", { enabled: false }), null);
    const spoken = await synthesizeSpeechOutput("hello", {
      enabled: true,
      providerId: "test.local-tts",
      voiceId: "voice-1",
      rate: 1,
      localOnly: true,
    });
    assert.equal(spoken?.providerId, "test.local-tts");
    assert.equal(spoken?.local, true);
    assert.ok((spoken?.byteLength ?? 0) > 0);
    assert.ok(listSpeechOutputProviders().some((item) => item.id === "test.local-tts"));
  } finally {
    unregisterSpeechOutputProvider("test.local-tts");
  }
});

test("P12 transcription registry exposes provider descriptors without provider-owned state", () => {
  registerTranscriptionProvider({
    descriptor: {
      id: "test.registry-stt",
      label: "Registry STT",
      local: false,
      languages: [],
      maxAudioBytes: 2048,
      acceptedMimeTypes: ["audio/webm"],
      optionalRuntimePackId: null,
    },
    async transcribe() { return { text: "hello" }; },
  });
  try {
    assert.ok(listTranscriptionProviders().some((item) => item.id === "test.registry-stt"));
  } finally {
    unregisterTranscriptionProvider("test.registry-stt");
  }
});


test("P12 typed and spoken versions produce equivalent governed plans and context", () => {
  const transcript = {
    schemaVersion: "1" as const,
    transcriptId: "00000000-0000-4000-8000-000000001204",
    text: "technical analysis AAPL with RSI and MACD",
    language: "en",
    durationMs: 1800,
    providerId: "test.local-stt",
    local: true,
    confidence: 0.99,
    audioSha256: "c".repeat(64),
    sourceRef: "audio:c",
  };
  const voice = prepareVoiceConversationRequest({ baseRequest, transcript });
  const typed = { ...baseRequest, message: transcript.text };
  const typedPlan = planConversationWorkflow(typed);
  const spokenPlan = planConversationWorkflow(voice.request);

  assert.deepEqual(spokenPlan.intent, typedPlan.intent);
  assert.deepEqual(spokenPlan.steps, typedPlan.steps);
  assert.deepEqual(voice.request.context, typed.context);
  assert.deepEqual(voice.request.approvals, typed.approvals);
  assert.deepEqual(voice.request.transmissionPolicy, typed.transmissionPolicy);
});
