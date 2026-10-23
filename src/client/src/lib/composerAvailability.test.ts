import test from "node:test";
import assert from "node:assert/strict";
import { sourceAvailability, SOURCE_AVAILABILITY_COPY, voiceAvailability, voiceFailureCopy } from "./composerAvailability";

const source = (connected: boolean, operational: boolean, lastCheckedAt: string | null = null) => ({
  connected, operational, lastCheckedAt,
});
const provider = (id: string, local = true) => ({ id, local });

test("WS-21 a configured source is not automatically operational", () => {
  assert.equal(sourceAvailability(source(true, false, null)), "configured_unverified");
  assert.equal(sourceAvailability(source(true, false, "2026-10-20T12:00:00Z")), "needs_attention");
  assert.match(SOURCE_AVAILABILITY_COPY.needs_attention, /not operational/);
});
test("WS-21 only a checked, operational source reports operational at last check", () => {
  assert.equal(sourceAvailability(source(true, true, "2026-10-20T12:00:00Z")), "operational");
  assert.equal(sourceAvailability(source(true, true, null)), "configured_unverified");
  assert.match(SOURCE_AVAILABILITY_COPY.operational, /last check/);
});
test("WS-21 catalogue-only provider is never presented as connected", () => {
  assert.equal(sourceAvailability(source(false, true, "2026-10-20T12:00:00Z")), "catalog_only");
});
test("WS-21 unknown and failed voice-provider queries fail closed", () => {
  const base = { transcription: undefined, speech: undefined, browserRecordingReady: undefined };
  assert.equal(voiceAvailability({ ...base, loading: true, error: false }).transcriptionReady, false);
  const error = voiceAvailability({ ...base, loading: false, error: true });
  assert.equal(error.speechReady, false);
  assert.match(error.label, /Could not verify/);
});
test("WS-21 absent transcription provider cannot be advertised as microphone ready", () => {
  const state = voiceAvailability({ loading: false, error: false, transcription: [], speech: [], browserRecordingReady: true });
  assert.equal(state.transcriptionReady, false);
  assert.equal(state.speechReady, false);
});
test("WS-21 local Whisper provider requires observed browser recording readiness", () => {
  const options = { loading: false, error: false, transcription: [provider("lios.voice.whisper-cpp")], speech: [] };
  assert.equal(voiceAvailability({ ...options, browserRecordingReady: false }).transcriptionReady, false);
  const state = voiceAvailability({ ...options, browserRecordingReady: true });
  assert.equal(state.transcriptionReady, true);
  assert.equal(state.transcriptionIsLocal, true);
});
test("WS-21 another registered transcription provider remains distinct from local Whisper pack", () => {
  const state = voiceAvailability({ loading: false, error: false, transcription: [provider("configured.service", false)], speech: [], browserRecordingReady: false, ffmpegFound: true });
  assert.equal(state.transcriptionReady, true);
  assert.equal(state.transcriptionIsLocal, false);
});
test("WS-21 browser-compressed audio cannot be advertised ready without ffmpeg", () => {
  const state = voiceAvailability({ loading: false, error: false,
    transcription: [provider("configured.service", false)], speech: [],
    browserRecordingReady: false, ffmpegFound: false });
  assert.equal(state.transcriptionReady, false);
});

test("WS-21 presence of speech output is not confused with transcription availability", () => {
  const state = voiceAvailability({ loading: false, error: false, transcription: [], speech: [provider("lios.voice.mac-say")], browserRecordingReady: false });
  assert.equal(state.transcriptionReady, false);
  assert.equal(state.speechReady, true);
  assert.equal(state.speechIsLocal, true);
});
test("WS-21 remote speech provider is not mislabeled as local", () => {
  const state = voiceAvailability({ loading: false, error: false, transcription: [], speech: [provider("cloud.tts", false)], browserRecordingReady: false });
  assert.equal(state.speechReady, true);
  assert.equal(state.speechIsLocal, false);
});
test("WS-21 authentication, rate limits and oversized audio have safe clear messages", () => {
  assert.match(voiceFailureCopy(401), /session may have expired/);
  assert.match(voiceFailureCopy(403), /not permitted/);
  assert.match(voiceFailureCopy(413), /too large/);
  assert.match(voiceFailureCopy(429), /rate-limited/);
});
test("WS-21 unknown backend status and network errors never contain raw diagnostics", () => {
  assert.match(voiceFailureCopy("network"), /service unavailable/);
  assert.match(voiceFailureCopy("invalid"), /invalid response/);
  assert.match(voiceFailureCopy("microphone"), /permissions/);
  assert.match(voiceFailureCopy(422), /not completed/);
  assert.doesNotMatch(voiceFailureCopy(503), /stack trace|secret|provider token/);
});
