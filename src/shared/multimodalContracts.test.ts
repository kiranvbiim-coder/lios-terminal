import assert from "node:assert/strict";
import test from "node:test";
import {
  P12_WHISPER_CPP_BUDGET,
  cloneConversationRequestWithTranscript,
  multimodalAttachmentSchema,
  speechOutputPreferenceSchema,
  voiceTranscriptSchema,
} from "./multimodalContracts";

test("P12 transcript becomes a normal ConversationRequest without a parallel command schema", () => {
  const request = cloneConversationRequestWithTranscript({
    requestId: "ba5e9fab-f160-4f19-a0b1-a8c3d0a0d501",
    continuationOf: null,
    message: "typed placeholder",
    executionMode: "deterministic_first",
    aiDirectApproved: false,
    approvals: [],
    transmissionPolicy: {
      mode: "configured",
      providerAllow: [],
      providerDeny: [],
      allowProjectInstructions: true,
      allowResourceReferences: true,
      allowSelection: true,
      allowToolCalling: true,
      dataClassification: "private",
    },
    context: { symbol: "AAPL", view: "valuation" },
  }, "run a DCF for AAPL");
  assert.equal(request.message, "run a DCF for AAPL");
  assert.equal(request.context?.symbol, "AAPL");
});

test("P12 multimodal attachment contract keeps files as governed references", () => {
  const attachment = multimodalAttachmentSchema.parse({
    id: "00000000-0000-4000-8000-000000001212",
    kind: "screenshot",
    fileName: "terminal.png",
    mimeType: "image/png",
    byteLength: 1024,
    sha256: "a".repeat(64),
    sourceRef: "attachment:terminal",
    localPath: null,
    textPreview: null,
    width: 1200,
    height: 800,
  });
  assert.equal(attachment.kind, "screenshot");
});

test("P12 speech output is opt-in and Whisper.cpp budgets are bounded", () => {
  assert.equal(speechOutputPreferenceSchema.parse({}).enabled, false);
  assert.ok(P12_WHISPER_CPP_BUDGET.maxRealtimeFactor <= 1.5);
  assert.ok(P12_WHISPER_CPP_BUDGET.maxModelBytes <= 1_600 * 1024 * 1024);
});

test("P12 transcript requires evidence metadata and local/provider identity", () => {
  const parsed = voiceTranscriptSchema.parse({
    schemaVersion: "1",
    transcriptId: "00000000-0000-4000-8000-000000001213",
    text: "compare my portfolio risk",
    language: "en",
    durationMs: 2000,
    providerId: "lios.voice.whisper-cpp",
    local: true,
    confidence: null,
    audioSha256: "b".repeat(64),
    sourceRef: "audio:b",
  });
  assert.equal(parsed.local, true);
});
