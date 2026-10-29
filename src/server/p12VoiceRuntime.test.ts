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

test("P12 speech refuses pre-cancelled work without exposing its cancellation reason", async (t) => {
  const providerId = "test.cancelled-before-tts";
  let calls = 0;
  registerSpeechOutputProvider({
    id: providerId,
    label: "Cancelled TTS",
    local: true,
    async synthesize() {
      calls += 1;
      return { audio: Buffer.from("audio"), mimeType: "audio/wav" };
    },
  });
  t.after(() => unregisterSpeechOutputProvider(providerId));
  await assert.rejects(
    synthesizeSpeechOutput("hello", { enabled: true, providerId }, AbortSignal.abort(new Error("private-cancellation-secret"))),
    (error: unknown) => error instanceof Error && error.name === "AbortError"
      && error.message === "Speech synthesis was cancelled.",
  );
  assert.equal(calls, 0);
});

test("P12 speech cancellation joins provider cleanup and refuses late audio or private errors", async (t) => {
  for (const ending of ["audio", "error"] as const) {
    const providerId = `test.cancelled-during-tts-${ending}`;
    const controller = new AbortController();
    const started = Promise.withResolvers<void>();
    const cleanup = Promise.withResolvers<void>();
    let receivedSignal: AbortSignal | undefined;
    let cleaned = false;
    let settled = false;
    registerSpeechOutputProvider({
      id: providerId,
      label: "Delayed TTS",
      local: true,
      async synthesize(input) {
        receivedSignal = input.signal;
        started.resolve();
        await cleanup.promise;
        cleaned = true;
        if (ending === "error") throw new Error("private-provider-secret");
        return { audio: Buffer.from("late audio"), mimeType: "audio/wav" };
      },
    });
    t.after(() => {
      cleanup.resolve();
      unregisterSpeechOutputProvider(providerId);
    });
    const pending = synthesizeSpeechOutput("hello", { enabled: true, providerId }, controller.signal);
    const rejected = assert.rejects(pending, (error: unknown) => error instanceof Error
      && error.name === "AbortError" && error.message === "Speech synthesis was cancelled.");
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await started.promise;
    assert.equal(receivedSignal, controller.signal);
    controller.abort(new Error("private-cancellation-secret"));
    await Promise.resolve();
    assert.equal(settled, false, "cancellation must join the provider rather than abandon its cleanup");
    assert.equal(cleaned, false);
    cleanup.resolve();
    await rejected;
    assert.equal(cleaned, true);
  }
});

test("P12 speech checks cancellation again after a provider produces audio", async (t) => {
  const providerId = "test.cancelled-after-tts";
  const controller = new AbortController();
  registerSpeechOutputProvider({
    id: providerId,
    label: "Late-cancelled TTS",
    local: true,
    async synthesize() {
      controller.abort(new Error("private-cancellation-secret"));
      return { audio: Buffer.from("must not publish"), mimeType: "audio/wav" };
    },
  });
  t.after(() => unregisterSpeechOutputProvider(providerId));
  await assert.rejects(synthesizeSpeechOutput("hello", { enabled: true, providerId }, controller.signal), {
    name: "AbortError",
    message: "Speech synthesis was cancelled.",
  });
});

test("P12 local-only speech never calls a remote provider or falls back to another provider", async (t) => {
  const calls: string[] = [];
  for (const local of [false, true]) {
    const providerId = local ? "test.local-only-local" : "test.local-only-remote";
    registerSpeechOutputProvider({
      id: providerId,
      label: providerId,
      local,
      async synthesize() {
        calls.push(providerId);
        return { audio: Buffer.from("audio"), mimeType: "audio/wav" };
      },
    });
    t.after(() => unregisterSpeechOutputProvider(providerId));
  }
  await assert.rejects(synthesizeSpeechOutput("hello", {
    enabled: true,
    providerId: "test.local-only-remote",
    localOnly: true,
  }), /requires a local provider/);
  assert.deepEqual(calls, []);
});
